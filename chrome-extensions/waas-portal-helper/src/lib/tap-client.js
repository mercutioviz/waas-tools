/**
 * Isolated-world client for the page-world tap in `content/api-tap.js`.
 *
 * This is the half of the bridge the rest of the extension talks to. Any
 * feature that needs portal API data — not portal markup — subscribes here
 * rather than patching anything itself.
 *
 *   const stop = subscribeTap((entry) => { ... }, { onMissing() { ... } });
 *
 * An entry is `{ id, url, method, status, durationMs, bytes, resContentType,
 * reqHeaderNames, credentials, body?, bodyNote?, error? }`, where `body` is the
 * parsed JSON response. Entries arrive **unredacted** — they are the page's own
 * data. Anything that displays or copies one must run it through
 * `api-shape.js` first.
 *
 * Several features can subscribe at once. There is one window listener and one
 * conversation with the tap however many there are, and a subscriber that
 * arrives late is replayed everything seen so far — otherwise a feature enabled
 * after page load would never see the call that populated the page, which is
 * usually the only one it wanted.
 *
 * `onMissing` fires when the tap doesn't answer. In practice that means the
 * extension was reloaded while the tab stayed open: content scripts inject on
 * navigation, so the page world has no tap until the page is reloaded.
 */

import { log, warn } from './log.js';

const OUT = 'wph-tap';
const IN = 'wph-tap-client';

/** The tap replies to `start` immediately; this is slack, not a poll interval. */
const HANDSHAKE_MS = 750;

/** Replay cap for late subscribers. The tap's own buffer is smaller than this. */
const MAX_CACHE = 200;

const handlers = new Set();

/** id -> entry, insertion-ordered, so a late subscriber can be caught up. */
const cache = new Map();

let listener = null;
let handshakeTimer = null;
let answered = false;

function send(kind) {
  // A sandboxed document reports origin "null", which postMessage rejects.
  const target = location.origin && location.origin !== 'null' ? location.origin : '*';
  window.postMessage({ source: IN, kind }, target);
}

function call(handler, entry) {
  try {
    handler(entry);
  } catch (err) {
    warn('tap: subscriber threw', err);
  }
}

function receive(entry) {
  // The buffer snapshot and the live stream overlap by a request or two, and
  // every `start` re-sends the buffer, so dedupe by id rather than by arrival.
  if (!entry || cache.has(entry.id)) return;

  cache.set(entry.id, entry);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);

  for (const handler of handlers) call(handler, entry);
}

function listen(onMissing) {
  answered = false;

  listener = (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== OUT) return;

    if (data.kind === 'buffer' || data.kind === 'entry') {
      answered = true;
      clearTimeout(handshakeTimer);
      if (data.kind === 'buffer') for (const entry of data.entries || []) receive(entry);
      else receive(data.entry);
    } else if (data.kind === 'hello') {
      // A tap that booted after us. Ask again for whatever it has.
      send('start');
    }
  };

  window.addEventListener('message', listener);
  send('start');

  handshakeTimer = setTimeout(() => {
    if (answered) return;
    log('tap: no response from the page world');
    if (onMissing) call(onMissing, undefined);
  }, HANDSHAKE_MS);

  log('tap: listening');
}

function unlisten() {
  if (!listener) return;
  send('stop');
  window.removeEventListener('message', listener);
  clearTimeout(handshakeTimer);
  listener = null;
  log('tap: stopped');
}

/**
 * Receive every captured API call. Returns an unsubscribe function; the tap is
 * told to stop only once the last subscriber has gone.
 *
 * @param {(entry: object) => void} handler
 * @param {{ onMissing?: () => void }} [options]
 * @returns {() => void}
 */
export function subscribeTap(handler, { onMissing } = {}) {
  if (typeof handler !== 'function') return () => {};

  const first = handlers.size === 0;
  handlers.add(handler);

  if (first) {
    listen(onMissing);
  } else {
    // Catch the newcomer up without re-delivering to everyone else.
    for (const entry of cache.values()) call(handler, entry);
    if (!answered && onMissing) call(onMissing, undefined);
  }

  let done = false;
  return () => {
    if (done) return;
    done = true;
    handlers.delete(handler);
    if (!handlers.size) unlisten();
  };
}

export function isTapRunning() {
  return Boolean(listener);
}

/** Drop the page-world buffer and our replay cache. */
export function clearTap() {
  cache.clear();
  send('clear');
}
