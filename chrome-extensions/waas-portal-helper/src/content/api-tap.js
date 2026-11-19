/**
 * Page-world tap on fetch() and XMLHttpRequest.
 *
 * The portal is a React app that loads everything over its own API. This is how
 * the extension gets to see those responses — which is the only honest way to
 * build features on portal *data* rather than on guessed markup.
 *
 * Why this file is different from everything else in src/:
 *
 *   - It runs in the **MAIN world**, so it can see the page's `fetch`. The
 *     isolated world where the rest of the extension lives has its own copy and
 *     cannot observe the page's calls at all.
 *   - It runs at **document_start**, because the portal's first API calls
 *     happen long before `document_idle`, when the normal content script boots.
 *   - It therefore has **no access to `chrome.*`** — not storage, not runtime.
 *     It can't read settings, so it can't decide for itself whether to be on.
 *     It talks to the isolated world over `postMessage` only.
 *   - It's a **classic script with no imports**, for the same reason
 *     `content.js` is: content scripts can't be ES modules.
 *
 * How "off by default" works given it can't read settings: the tap always
 * patches, but only ever *buffers* — in the page's own memory, holding data the
 * page already has. Nothing is sent to the extension until a client in the
 * isolated world asks for it, which only happens when the user turns capture on.
 * The buffer is capped and nothing is persisted anywhere.
 *
 * One consequence worth knowing: patching `window.fetch` is visible to the page,
 * so the portal could in principle detect the extension. Acceptable for a
 * troubleshooting tool; don't build anything here that assumes stealth.
 */
(() => {
  'use strict';

  if (window.__wphApiTap) return;
  window.__wphApiTap = true;

  const OUT = 'wph-tap';
  const IN = 'wph-tap-client';

  /** Buffer caps. Entries hold parsed JSON, so bound both count and size. */
  const MAX_ENTRIES = 60;
  const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
  const MAX_BODY_BYTES = 1024 * 1024;

  // A sandboxed document reports origin "null", which postMessage rejects.
  const TARGET = location.origin && location.origin !== 'null' ? location.origin : '*';

  const ASSET = /\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|mp4)(?:$|\?)/i;
  const BARRACUDA = /(^|\.)(barracudanetworks|barracuda)\.com$/i;

  const buffer = [];
  let bufferBytes = 0;
  let streaming = false;
  let nextId = 1;

  // -------------------------------------------------------------------------

  /** Portal and API calls only — not analytics beacons, not static assets. */
  function interesting(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (!BARRACUDA.test(url.hostname)) return false;
    return !ASSET.test(url.pathname);
  }

  function post(kind, payload) {
    try {
      window.postMessage({ source: OUT, kind, ...payload }, TARGET);
    } catch {
      // A body that can't be structured-cloned shouldn't take down the tap.
    }
  }

  function record(entry) {
    entry.id = nextId++;
    buffer.push(entry);
    bufferBytes += entry.bytes || 0;

    while (buffer.length > MAX_ENTRIES || (bufferBytes > MAX_BUFFER_BYTES && buffer.length > 1)) {
      const dropped = buffer.shift();
      bufferBytes -= dropped.bytes || 0;
    }

    if (streaming) post('entry', { entry });
  }

  /**
   * Decide what to keep of a response body. JSON is parsed; anything else is
   * noted by type and size only, which is all a capture needs to say "that one
   * wasn't it".
   */
  function readBody(text, contentType) {
    const bytes = text ? text.length : 0;
    if (!text) return { bytes, bodyNote: 'empty' };
    if (!/json/i.test(contentType || '')) {
      return { bytes, bodyNote: `not json (${contentType || 'unknown type'})` };
    }
    if (bytes > MAX_BODY_BYTES) {
      return { bytes, bodyNote: `too large to parse (${bytes} bytes)` };
    }
    try {
      return { bytes, body: JSON.parse(text) };
    } catch {
      return { bytes, bodyNote: 'json parse failed' };
    }
  }

  function headerNamesOf(init, input) {
    const names = new Set();
    const collect = (headers) => {
      if (!headers) return;
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        headers.forEach((_value, name) => names.add(String(name).toLowerCase()));
      } else if (Array.isArray(headers)) {
        for (const pair of headers) if (pair?.[0]) names.add(String(pair[0]).toLowerCase());
      } else if (typeof headers === 'object') {
        for (const name of Object.keys(headers)) names.add(name.toLowerCase());
      }
    };
    collect(init?.headers);
    if (typeof Request !== 'undefined' && input instanceof Request) collect(input.headers);
    return [...names];
  }

  // -------------------------------------------------------------------------
  // fetch
  // -------------------------------------------------------------------------

  const nativeFetch = window.fetch;

  if (typeof nativeFetch === 'function') {
    window.fetch = function wphFetch(input, init) {
      let meta = null;
      try {
        const isRequest = typeof Request !== 'undefined' && input instanceof Request;
        const url = isRequest ? input.url : String(input);
        if (interesting(url)) {
          meta = {
            url,
            method: String((init && init.method) || (isRequest && input.method) || 'GET').toUpperCase(),
            reqHeaderNames: headerNamesOf(init, input),
            credentials: (init && init.credentials) || (isRequest ? input.credentials : undefined),
            started: Date.now(),
          };
        }
      } catch {
        meta = null;
      }

      const result = nativeFetch.apply(this, arguments);
      if (!meta) return result;

      return result.then(
        (response) => {
          try {
            // clone() so the page still gets an unread body. It can throw if the
            // body was already consumed somewhere exotic — never block on it.
            const copy = response.clone();
            const contentType = response.headers.get('content-type') || '';
            copy.text().then(
              (text) => {
                record({
                  ...meta,
                  status: response.status,
                  durationMs: Date.now() - meta.started,
                  resContentType: contentType,
                  ...readBody(text, contentType),
                });
              },
              () => {},
            );
          } catch {
            record({ ...meta, status: response.status, durationMs: Date.now() - meta.started });
          }
          return response;
        },
        (err) => {
          record({
            ...meta,
            status: 0,
            durationMs: Date.now() - meta.started,
            error: String((err && err.message) || err),
          });
          throw err;
        },
      );
    };
  }

  // -------------------------------------------------------------------------
  // XMLHttpRequest
  // -------------------------------------------------------------------------

  const XHR = window.XMLHttpRequest;

  if (XHR && XHR.prototype) {
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;
    const nativeSetHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function wphOpen(method, url) {
      try {
        this.__wphMeta = {
          method: String(method || 'GET').toUpperCase(),
          url: String(url),
          reqHeaderNames: [],
        };
      } catch {
        this.__wphMeta = null;
      }
      return nativeOpen.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function wphSetRequestHeader(name) {
      if (this.__wphMeta) this.__wphMeta.reqHeaderNames.push(String(name).toLowerCase());
      return nativeSetHeader.apply(this, arguments);
    };

    XHR.prototype.send = function wphSend() {
      const meta = this.__wphMeta;
      if (meta) {
        meta.started = Date.now();

        // Bind once per object, and read the metadata at event time: an XHR can
        // be reopened and sent again, and a per-send listener would then record
        // the second response twice, against the first one's URL.
        if (!this.__wphBound) {
          this.__wphBound = true;
          this.addEventListener('loadend', () => {
            const current = this.__wphMeta;
            if (!current || !interesting(current.url)) return;

            let text = '';
            let contentType = '';
            try {
              contentType = this.getResponseHeader('content-type') || '';
              // responseText throws when responseType is blob/arraybuffer.
              text =
                this.responseType === '' || this.responseType === 'text' ? this.responseText : '';
            } catch {
              text = '';
            }

            record({
              url: current.url,
              method: current.method,
              reqHeaderNames: current.reqHeaderNames,
              credentials: this.withCredentials ? 'include' : undefined,
              status: this.status,
              durationMs: Date.now() - current.started,
              resContentType: contentType,
              ...readBody(text, contentType),
            });
          });
        }
      }
      return nativeSend.apply(this, arguments);
    };
  }

  // -------------------------------------------------------------------------
  // Control channel
  // -------------------------------------------------------------------------

  window.addEventListener('message', (event) => {
    // Same-window messages only. The page can forge these, but the worst it
    // buys is making the tap emit the page's own data to the extension.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== IN) return;

    if (data.kind === 'start') {
      streaming = true;
      post('buffer', { entries: buffer.slice() });
    } else if (data.kind === 'stop') {
      streaming = false;
    } else if (data.kind === 'clear') {
      buffer.length = 0;
      bufferBytes = 0;
    }
  });

  post('hello', {});
})();
