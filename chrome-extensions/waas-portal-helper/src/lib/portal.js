/**
 * Facts about the WaaS portal page we're running on.
 *
 * Important: the portal is behind SSO, so none of this assumes knowledge of its
 * internal markup or URL scheme. Everything here works off `location` and
 * `document.title`, which are stable regardless of how the app is built.
 * Anything that needs real selectors is user-configured (see lib/rules.js) or
 * discovered with the inspector feature.
 */

export const PORTAL_ORIGIN = 'https://waas.barracudanetworks.com';

export function isPortal(href = location.href) {
  try {
    return new URL(href).origin === PORTAL_ORIGIN;
  } catch {
    return false;
  }
}

// Shapes that commonly identify an account/application in a URL. Used only to
// *suggest* values to the user when they're writing a banner rule — nothing
// depends on these being correct.
const ID_SHAPES = [
  { name: 'uuid', re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
  { name: 'numeric', re: /^\d{3,}$/ },
  { name: 'hex', re: /^[0-9a-f]{12,}$/i },
];

function classify(value) {
  for (const shape of ID_SHAPES) {
    if (shape.re.test(value)) return shape.name;
  }
  return null;
}

/**
 * Best-effort identifier candidates found in the current URL — path segments,
 * query values, and hash-route segments that look like IDs.
 * @returns {{source: string, kind: string, value: string}[]}
 */
export function findIdCandidates(href = location.href) {
  const out = [];
  const seen = new Set();

  const add = (source, value) => {
    if (!value || seen.has(value)) return;
    const kind = classify(value);
    if (!kind) return;
    seen.add(value);
    out.push({ source, kind, value });
  };

  let url;
  try {
    url = new URL(href);
  } catch {
    return out;
  }

  url.pathname.split('/').filter(Boolean).forEach((seg) => add('path', seg));
  url.searchParams.forEach((value, key) => add(`query:${key}`, value));

  // SPAs often keep their real route in the hash (e.g. #/apps/1234/settings).
  const hash = url.hash.replace(/^#\/?/, '');
  if (hash) {
    const [hashPath, hashQuery] = hash.split('?');
    hashPath.split('/').filter(Boolean).forEach((seg) => add('hash', seg));
    if (hashQuery) {
      new URLSearchParams(hashQuery).forEach((value, key) => add(`hash:${key}`, value));
    }
  }

  return out;
}

/** A snapshot of everything we know about the current page. */
export function getContext(href = location.href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return { href, valid: false };
  }

  return {
    valid: true,
    href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    title: typeof document !== 'undefined' ? document.title : '',
    idCandidates: findIdCandidates(href),
  };
}

/**
 * Call `callback(href)` whenever the URL changes.
 *
 * Polling rather than patching History/pushState: the portal is a SPA whose
 * router we can't see, and polling a string every 400ms costs nothing while
 * being immune to however it navigates.
 *
 * @returns {() => void} unsubscribe
 */
export function onLocationChange(callback, intervalMs = 400) {
  let last = location.href;

  const check = () => {
    if (location.href !== last) {
      last = location.href;
      callback(last);
    }
  };

  const timer = setInterval(check, intervalMs);
  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);

  return () => {
    clearInterval(timer);
    window.removeEventListener('popstate', check);
    window.removeEventListener('hashchange', check);
  };
}
