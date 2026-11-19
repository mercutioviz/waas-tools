/**
 * Finding endpoint domain lists in captured API responses, and recognizing the
 * grid cell that summarizes one.
 *
 * The portal's endpoint grid renders a single domain plus a count —
 * `marketing.example.com (7 of 30 Domains)` — while the response behind it
 * carries the whole list. A capture of the live portal showed it arriving as:
 *
 *   GET /v2/waasapi/applications/{id}/endpoints/?searchPhrase=
 *   { count, next, previous, results: [ { id, dps_service: { domains: [...] } } ] }
 *
 * and again, same shape, nested inside `/v2/waasapi/applications/{id}/`.
 *
 * Rather than reach for `results[].dps_service.domains` by path, `harvestDomains`
 * walks the body for *any* array of hostnames under a domain-ish key. Both
 * shapes are then handled by one rule, and a path change in a future API
 * version doesn't silently empty the feature.
 *
 * No DOM here — the element-level work is in `features/endpoint-domains.js`, so
 * the matching rules stay covered by the Node logic suite.
 */

const MAX_DEPTH = 8;

/** Keys whose string array is a list of domains for one endpoint. */
const DOMAIN_KEYS = new Set(['domains', 'hostnames', 'domain_names', 'domainnames']);

/** Deliberately loose: it only has to beat "is this a string in an array". */
const HOSTNAME = /^(\*\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?$/i;

export function looksLikeHostname(value) {
  return typeof value === 'string' && value.length <= 253 && HOSTNAME.test(value.trim());
}

/**
 * Every domain list in a parsed response body, outermost first.
 * @returns {string[][]}
 */
export function harvestDomains(body, depth = 0) {
  if (!body || typeof body !== 'object' || depth > MAX_DEPTH) return [];

  const found = [];

  if (Array.isArray(body)) {
    for (const item of body) found.push(...harvestDomains(item, depth + 1));
    return found;
  }

  for (const [key, value] of Object.entries(body)) {
    if (DOMAIN_KEYS.has(key.toLowerCase()) && Array.isArray(value)) {
      const domains = value.filter(looksLikeHostname).map((d) => d.trim());
      // A single-entry list is still worth having: it means "no more to show",
      // which is a useful thing for the card to be able to say.
      if (domains.length) found.push(domains);
      continue;
    }
    if (value && typeof value === 'object') found.push(...harvestDomains(value, depth + 1));
  }

  return found;
}

/**
 * Index every domain to the list it belongs to, so a cell can be matched on
 * whichever of its domains the portal chose to display. Later responses win —
 * the newest capture of an endpoint is the truthful one.
 *
 * @param {string[][]} lists
 * @param {Map<string, string[]>} [into]
 * @returns {Map<string, string[]>}
 */
export function indexDomains(lists, into = new Map()) {
  for (const domains of lists) {
    for (const domain of domains) into.set(domain.toLowerCase(), domains);
  }
  return into;
}

/**
 * Read a grid cell's text.
 *
 * Tolerant on purpose: the count and the domain may sit in separate elements,
 * so the text arrives with arbitrary whitespace, and the wording is the one
 * thing here that a portal redesign could change. Matching the count phrase
 * loosely and picking the first hostname out of the text costs nothing and
 * survives more than an exact-format match would.
 *
 * @returns {{domain: string|null, shown: number, total: number}|null}
 */
export function parseDomainCell(text) {
  if (typeof text !== 'string' || text.length > 400) return null;

  const flat = text.replace(/\s+/g, ' ').trim();
  const counts = flat.match(/\((\d+)\s*of\s*(\d+)\s*domains?\)/i);
  if (!counts) return null;

  // The displayed domain is whatever hostname appears before the count.
  const before = flat.slice(0, counts.index);
  const domain = before
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .find(looksLikeHostname);

  return {
    domain: domain ? domain.toLowerCase() : null,
    shown: Number(counts[1]),
    total: Number(counts[2]),
  };
}
