/**
 * Redaction and shape summarizing for captured portal API traffic.
 *
 * The point of the capture feature is to answer "what does this endpoint
 * return?" without putting customer data on a clipboard. So nothing here ever
 * emits a value it can't argue is safe:
 *
 *   - **Key names are kept.** They're API schema, not customer data, and
 *     they're the whole reason to run a capture.
 *   - **Strings become a class and a length** — `string:hostname(21)`. That's
 *     enough to recognize a list of domains without reading one.
 *   - **Numbers are hidden** unless the key says it's a count or a limit
 *     (`maxHostnames`, `count`, `port`), because those are what make a response
 *     legible and they carry nothing identifying. An `accountId` stays hidden.
 *   - **Strings are shown verbatim only for all-caps constants** (`ACTIVE`) and
 *     a fixed list of protocol words (`https`), and not even then under a key
 *     that names something — `name`, `host`, `domain` and friends.
 *
 * The fixed lists below are the safety mechanism. Widening them is a decision,
 * not a tidy-up: every word added is a value that can reach a clipboard.
 *
 * No DOM, no chrome APIs — this file is covered by the Node logic suite.
 */

const MAX_DEPTH = 6;
// A real WaaS application object runs to ~50 keys, and the first capture lost
// 10 of them to this cap. Values are redacted, so width is cheap.
const MAX_KEYS = 80;
const ARRAY_SAMPLE = 8;
const MAX_SHOWN_VALUES = 5;

// ---------------------------------------------------------------------------
// Key classification
// ---------------------------------------------------------------------------

/** Keys whose value identifies a customer, an asset, or a secret. Never shown. */
const SENSITIVE_WORDS = new Set([
  'name', 'title', 'label', 'alias', 'description', 'comment', 'note',
  'host', 'hostname', 'domain', 'fqdn', 'cname', 'origin', 'endpoint',
  'url', 'uri', 'path', 'address', 'ip', 'cidr', 'subnet',
  'account', 'customer', 'tenant', 'org', 'organization', 'company',
  'app', 'application', 'site', 'service', 'cluster',
  'user', 'username', 'email', 'owner', 'contact',
  'key', 'secret', 'password', 'auth', 'credential', 'cert', 'certificate',
  'serial', 'case', 'ticket',
]);

/**
 * Keys whose number identifies something rather than measuring it.
 *
 * This is deliberately *not* the sensitive list above. "How many domains are
 * configured out of how many allowed" is exactly what a capture is for, and
 * `maxHostnames` contains a sensitive word while being a pure limit. A count is
 * never identifying — but `serialNumber` and `caseNumber` contain a count word
 * while being identifiers, so they need their own veto.
 */
const NUMBER_VETO_WORDS = new Set([
  'id', 'account', 'customer', 'tenant', 'org', 'organization', 'company',
  'user', 'owner', 'contact', 'serial', 'case', 'ticket',
  'key', 'secret', 'token', 'password', 'phone', 'zip', 'postal', 'card',
]);

/** Keys whose numeric value is a count, a bound, or a protocol detail. */
const COUNT_WORDS = new Set([
  'count', 'total', 'num', 'number', 'quantity',
  'limit', 'max', 'maximum', 'min', 'minimum', 'quota', 'threshold',
  'used', 'remaining', 'available', 'configured',
  'page', 'size', 'offset', 'index', 'length', 'depth', 'level',
  'port', 'version', 'priority', 'weight', 'percent', 'score',
  'ttl', 'timeout', 'interval', 'duration', 'retries',
  'second', 'minute', 'hour', 'day', 'ms',
]);

/** Split `maxHostnames` / `max_hostnames` / `MaxHostnames` into words. */
export function keyWords(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase().replace(/s$/, ''));
}

export function isSensitiveKey(key) {
  return keyWords(key).some((word) => SENSITIVE_WORDS.has(word));
}

/**
 * Objects whose numeric members are all bounds, whatever the member is called.
 *
 * The WaaS API returns plan caps as `licensed_features: { endpoint_domain: 30,
 * origin_server: 10, … }`. Judged on their own, those keys name a *thing* and
 * their values stayed hidden — which withheld the one number a capture of that
 * endpoint is for. The containing key settles it.
 */
const LIMIT_CONTAINER_WORDS = new Set([
  'limit', 'limits', 'quota', 'capacity', 'entitlement',
  'licensed', 'license', 'feature', 'plan', 'tier', 'allowance',
]);

export function isLimitContainer(key) {
  return keyWords(key).some((word) => LIMIT_CONTAINER_WORDS.has(word));
}

/**
 * Whether a number under this key may be printed: it has to measure something
 * and not identify anything. `maxHostnames` passes, `serialNumber` doesn't.
 *
 * `parentKey` is the key of the object this number sits in, so a bound can be
 * recognized by its container as well as by its own name. The veto list still
 * applies either way — `licensed_features.account_id` stays hidden.
 */
export function showsNumberValue(key, parentKey = '') {
  const words = keyWords(key);
  if (words.some((word) => NUMBER_VETO_WORDS.has(word))) return false;
  if (words.some((word) => COUNT_WORDS.has(word))) return true;
  return isLimitContainer(parentKey);
}

// ---------------------------------------------------------------------------
// String classification
// ---------------------------------------------------------------------------

/**
 * Lowercase words safe to print whatever they're attached to: protocol names,
 * states, and modes. Closed list by design — a customer name can't be in it.
 */
const SAFE_WORDS = new Set([
  'http', 'https', 'tcp', 'udp', 'ssl', 'tls', 'ws', 'wss', 'dns', 'icmp',
  'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace',
  'true', 'false', 'yes', 'no', 'on', 'off', 'none', 'null', 'all', 'any',
  'auto', 'default', 'custom', 'static', 'dynamic',
  'active', 'inactive', 'enabled', 'disabled', 'pending', 'paused', 'ready',
  'error', 'warning', 'info', 'ok', 'unknown', 'draft', 'deleted',
  'allow', 'block', 'deny', 'log', 'redirect', 'rewrite', 'monitor', 'passive',
  'asc', 'desc', 'up', 'down', 'high', 'medium', 'low', 'strict', 'loose',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;
const DIGITS = /^\d+$/;
const CONSTANT = /^[A-Z][A-Z0-9_]{0,31}$/;
const HOSTNAME = /^(\*\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?$/i;
const OPAQUE = /^[A-Za-z0-9._~+/=-]{24,}$/;

/**
 * Name the kind of thing a string is, without revealing it.
 * Order matters — an email also looks like a hostname.
 */
export function classifyString(value) {
  if (typeof value !== 'string') return 'text';
  if (value === '') return 'empty';
  if (UUID.test(value)) return 'uuid';
  if (EMAIL.test(value)) return 'email';
  if (URL_LIKE.test(value)) return 'url';
  if (IPV4.test(value)) return 'ipv4';
  if (IPV6.test(value) && value.includes(':')) return 'ipv6';
  if (DATE_LIKE.test(value)) return 'date';
  if (DIGITS.test(value)) return 'digits';
  if (CONSTANT.test(value)) return 'constant';
  if (SAFE_WORDS.has(value.toLowerCase()) && /^[a-z]+$/i.test(value)) return 'constant';
  if (HOSTNAME.test(value)) return 'hostname';
  if (OPAQUE.test(value)) return 'opaque';
  return 'text';
}

// ---------------------------------------------------------------------------
// Shape summarizing
//
// A shape is a plain object so it can be merged across array items and
// rendered separately. `render()` is the only thing that produces text.
// ---------------------------------------------------------------------------

export function summarize(value, key = '', depth = 0, parentKey = '') {
  if (depth > MAX_DEPTH) return { t: 'deep' };
  if (value === null || value === undefined) return { t: 'null' };

  if (Array.isArray(value)) {
    // Items carry the array's own key, so `hostnames: [...]` treats each entry
    // as a hostname field rather than a bare string.
    let item = null;
    for (const entry of value.slice(0, ARRAY_SAMPLE)) {
      const shape = summarize(entry, key, depth + 1, parentKey);
      item = item ? merge(item, shape) : shape;
    }
    return { t: 'arr', min: value.length, max: value.length, item };
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return {
      t: 'obj',
      // Members see this object's key as their parent, which is how a bound
      // inside `licensed_features` is recognized as a bound.
      entries: keys.slice(0, MAX_KEYS).map((k) => [k, summarize(value[k], k, depth + 1, key)]),
      extra: Math.max(0, keys.length - MAX_KEYS),
    };
  }

  if (typeof value === 'boolean') return { t: 'bool', values: new Set([value]) };

  if (typeof value === 'number') {
    return { t: 'num', values: showsNumberValue(key, parentKey) ? new Set([value]) : null };
  }

  if (typeof value === 'string') {
    const cls = classifyString(value);
    const printable = cls === 'constant' && !isSensitiveKey(key);
    return {
      t: 'str',
      cls: cls === 'constant' && !printable ? 'text' : cls,
      min: value.length,
      max: value.length,
      values: printable ? new Set([value]) : null,
    };
  }

  return { t: 'mixed' };
}

/** Union two shapes, so an array of objects renders as one merged item. */
export function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.t !== b.t) return { t: 'mixed' };

  switch (a.t) {
    case 'obj': {
      const map = new Map(a.entries);
      for (const [key, shape] of b.entries) {
        map.set(key, map.has(key) ? merge(map.get(key), shape) : shape);
      }
      return { t: 'obj', entries: [...map], extra: Math.max(a.extra || 0, b.extra || 0) };
    }
    case 'arr':
      return {
        t: 'arr',
        min: Math.min(a.min, b.min),
        max: Math.max(a.max, b.max),
        item: a.item && b.item ? merge(a.item, b.item) : a.item || b.item,
      };
    case 'str': {
      const min = Math.min(a.min, b.min);
      const max = Math.max(a.max, b.max);
      if (a.cls !== b.cls) return { t: 'str', cls: 'mixed', min, max, values: null };
      const values = a.values && b.values ? new Set([...a.values, ...b.values]) : null;
      return { t: 'str', cls: a.cls, min, max, values };
    }
    case 'num':
      return { t: 'num', values: a.values && b.values ? new Set([...a.values, ...b.values]) : null };
    case 'bool':
      return { t: 'bool', values: new Set([...a.values, ...b.values]) };
    default:
      return a;
  }
}

function range(min, max) {
  return min === max ? String(min) : `${min}..${max}`;
}

function listValues(values, quote) {
  const all = [...values];
  const shown = all.slice(0, MAX_SHOWN_VALUES).map((v) => (quote ? `"${v}"` : String(v)));
  return shown.join('|') + (all.length > MAX_SHOWN_VALUES ? '|…' : '');
}

export function render(shape, depth = 0) {
  const pad = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);

  switch (shape.t) {
    case 'obj': {
      if (!shape.entries.length && !shape.extra) return '{}';
      let body = shape.entries.map(([k, v]) => `${pad}${k}: ${render(v, depth + 1)}`).join(',\n');
      if (shape.extra) {
        body += `${body ? '\n' : ''}${pad}… ${shape.extra} more key${shape.extra === 1 ? '' : 's'}`;
      }
      return `{\n${body}\n${close}}`;
    }
    case 'arr': {
      if (!shape.item) return '[]';
      const inner = render(shape.item, depth + 1);
      const count = `×${range(shape.min, shape.max)}`;
      return inner.includes('\n')
        ? `[ ${count}\n${pad}${inner}\n${close}]`
        : `[ ${count} ${inner} ]`;
    }
    case 'str':
      if (shape.values && shape.values.size) return listValues(shape.values, true);
      if (shape.cls === 'empty') return 'string:empty';
      return `string:${shape.cls}(${range(shape.min, shape.max)})`;
    case 'num':
      return shape.values && shape.values.size ? `number(${listValues(shape.values, false)})` : 'number';
    case 'bool':
      return shape.values.size === 1 ? `boolean(${[...shape.values][0]})` : 'boolean';
    case 'null':
      return 'null';
    case 'deep':
      return '…';
    default:
      return 'mixed';
  }
}

/** Convenience: a parsed JSON body as redacted text. */
export function describeBody(body) {
  return render(summarize(body));
}

// ---------------------------------------------------------------------------
// URL redaction
// ---------------------------------------------------------------------------

function placeholder(cls) {
  switch (cls) {
    case 'uuid': return '{uuid}';
    case 'digits': return '{id}';
    case 'hostname': return '{host}';
    case 'ipv4':
    case 'ipv6': return '{ip}';
    case 'email': return '{email}';
    case 'url': return '{url}';
    case 'date': return '{date}';
    case 'opaque': return '{opaque}';
    case 'empty': return '';
    default: return '{string}';
  }
}

/** `config.html` parses as a hostname, so name the common case explicitly. */
const FILENAME = /\.(html?|js|mjs|css|json|xml|txt|csv|pdf|png|jpe?g|gif|svg|ico|map|woff2?|ttf|wasm)$/i;

/**
 * A route word: lowercase, with `_` or `-`. `waasapi`, `json_security`,
 * `access-token`, `v4` all qualify.
 *
 * Anything else in a path is data. The WaaS API routes some calls by
 * **application name** — `/v4/waasapi/applications/Customer%20App%2001/cdn/`
 * — and an early version of this kept that segment, because a percent-encoded
 * name classifies as ordinary text. An application name is exactly what must
 * not reach a clipboard, so the test is now "does it look like a route?" rather
 * than "does it look like an identifier?". Over-redacting an unusual route word
 * costs nothing; the other direction leaks a customer.
 */
const ROUTE_WORD = /^[a-z][a-z0-9_-]*$/;

function redactSegment(segment) {
  if (!segment) return segment;

  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Malformed escape — judge it as it came in.
  }

  if (FILENAME.test(decoded)) return segment;

  const cls = classifyString(decoded);
  // Short numbers are page indexes and API versions, not identifiers.
  if (cls === 'digits') return decoded.length <= 2 ? segment : '{id}';
  if (cls !== 'text' && cls !== 'constant') return placeholder(cls);

  return ROUTE_WORD.test(decoded) ? segment : '{name}';
}

function redactParam(key, value) {
  if (isSensitiveKey(key)) return '{redacted}';
  const cls = classifyString(value);
  if (cls === 'digits') return value.length <= 2 ? value : '{id}';
  if (cls === 'constant' || cls === 'text') return value;
  return placeholder(cls);
}

/**
 * Strip identifiers from a URL while keeping its shape.
 * Query *keys* survive — they describe the endpoint. Values are classified.
 */
export function redactUrl(raw, origin = '') {
  let url;
  try {
    url = new URL(raw, origin || undefined);
  } catch {
    return '(unparseable url)';
  }

  const path = url.pathname.split('/').map(redactSegment).join('/');
  const query = [...url.searchParams.entries()]
    .map(([key, value]) => `${key}=${redactParam(key, value)}`)
    .join('&');
  const hash = url.hash ? `#${url.hash.slice(1).split('/').map(redactSegment).join('/')}` : '';

  // Same-origin calls are shown path-only; the host adds nothing there.
  const base = origin && url.origin === origin ? '' : url.origin;
  return `${base}${path}${query ? `?${query}` : ''}${hash}`;
}

// ---------------------------------------------------------------------------
// Entry formatting
// ---------------------------------------------------------------------------

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One-line summary — the console's collapsed header. */
export function entryLine(entry, origin = '') {
  const status = entry.error ? `failed (${entry.error})` : entry.status;
  const bits = [];
  if (Number.isFinite(entry.durationMs)) bits.push(`${entry.durationMs} ms`);
  if (Number.isFinite(entry.bytes)) bits.push(formatBytes(entry.bytes));
  const tail = bits.length ? ` · ${bits.join(' · ')}` : '';
  return `${entry.method || 'GET'} ${redactUrl(entry.url, origin)} → ${status}${tail}`;
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

export function formatEntry(entry, origin = '') {
  const lines = [entryLine(entry, origin)];

  if (entry.reqHeaderNames?.length) {
    lines.push(`  request headers: ${entry.reqHeaderNames.join(', ')}`);
  }
  if (entry.credentials) lines.push(`  credentials: ${entry.credentials}`);
  if (entry.resContentType) lines.push(`  content-type: ${entry.resContentType}`);

  if (entry.body !== undefined && entry.body !== null) {
    lines.push('  response:');
    lines.push(indent(describeBody(entry.body), 2));
  } else {
    lines.push(`  response: ${entry.bodyNote || 'not captured'}`);
  }

  return lines.join('\n');
}

/** The whole capture, as the text the popup puts on the clipboard. */
export function formatCaptureLog(entries, origin = '') {
  const list = Array.isArray(entries) ? entries : [];
  const header = [
    'WaaS Portal Helper — API capture',
    `${list.length} call${list.length === 1 ? '' : 's'}`,
    '',
    'Redacted: key names kept; strings shown as class and length; numbers shown',
    'only where the key names a count or a limit. Read it over before pasting it',
    'anywhere public.',
  ].join('\n');

  if (!list.length) {
    return `${header}\n\nNothing captured yet — turn capture on, then reload the portal page.`;
  }

  return `${header}\n\n${list.map((entry) => formatEntry(entry, origin)).join('\n\n')}`;
}
