/**
 * Logic tests for the parts of the extension that don't need a browser:
 * rule matching, URL parsing, link formatting, contrast, selector heuristics.
 *
 * No dependencies and no test runner. See README.md for how to run it.
 */

// Resolve the extension root from this file's own location, so the suite runs
// from any working directory.
const BASE = new URL('../', import.meta.url);
const imp = (p) => import(new URL(p, BASE).href);

const { matchRule, matchRules, expandLabel, safeRegex } = await imp('src/lib/rules.js');
const { findIdCandidates, isPortal, getContext } = await imp('src/lib/portal.js');
const { formatLink, cleanTitle } = await imp('src/features/deep-link.js');
const { readableTextColor } = await imp('src/features/account-banner.js');
const { isStableToken } = await imp('src/lib/dom.js');
const { parseSelectorList, formatSelectorList, isSafeSelector, findCloseControl } =
  await imp('src/lib/dialogs.js');
const {
  classifyString,
  isSensitiveKey,
  showsNumberValue,
  summarize,
  render,
  describeBody,
  redactUrl,
  entryLine,
  formatBytes,
} = await imp('src/lib/api-shape.js');
const { harvestDomains, indexDomains, parseDomainCell, looksLikeHostname } =
  await imp('src/lib/endpoints.js');

let pass = 0;
let fail = 0;

const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`);
  }
};

// Minimal stand-in for `document` so selector rules can be exercised in Node.
const fakeDoc = (map) => ({
  querySelector(sel) {
    if (sel === 'BAD[[') throw new Error('invalid selector');
    return map[sel] ? { textContent: map[sel] } : null;
  },
});

console.log('rules - url matching');
eq(
  'matched text is used when no label given',
  matchRule(
    { enabled: true, matchType: 'url', value: '/accounts/(\\d+)', label: '', color: '#f00' },
    { href: 'https://waas.barracudanetworks.com/accounts/4821/apps' },
  ).label,
  '/accounts/4821',
);
eq(
  'capture group expands in label',
  matchRule(
    { enabled: true, matchType: 'url', value: '/accounts/(\\d+)', label: 'ACCT $1 - PROD', color: '#f00' },
    { href: 'https://x/accounts/4821/apps' },
  ).label,
  'ACCT 4821 - PROD',
);
eq('no match returns null', matchRule({ enabled: true, matchType: 'url', value: '/nope/', label: '', color: '#f00' }, { href: 'https://x/accounts/1' }), null);
eq('disabled rule is skipped', matchRule({ enabled: false, matchType: 'url', value: '.*', label: 'x', color: '#f00' }, { href: 'https://x/' }), null);
eq('invalid regex does not throw', matchRule({ enabled: true, matchType: 'url', value: '([unclosed', label: '', color: '#f00' }, { href: 'https://x/' }), null);
eq('empty value is ignored', matchRule({ enabled: true, matchType: 'url', value: '', label: 'x', color: '#f00' }, { href: 'https://x/' }), null);

console.log('rules - selector matching');
const doc = fakeDoc({ '.acct': '  ACME   Corp \n (Production) ' });
eq(
  'element text is collapsed and used as $0',
  matchRule({ enabled: true, matchType: 'selector', value: '.acct', label: '', color: '#00f' }, { href: 'h', doc }).label,
  'ACME Corp (Production)',
);
eq(
  'label template uses $0',
  matchRule({ enabled: true, matchType: 'selector', value: '.acct', label: '$0 !!', color: '#00f' }, { href: 'h', doc }).label,
  'ACME Corp (Production) !!',
);
eq(
  'textPattern extracts a group',
  matchRule({ enabled: true, matchType: 'selector', value: '.acct', label: '$1', textPattern: '\\((\\w+)\\)', color: '#00f' }, { href: 'h', doc }).label,
  'Production',
);
eq(
  'textPattern that misses yields null',
  matchRule({ enabled: true, matchType: 'selector', value: '.acct', label: '$1', textPattern: '\\(Staging\\)', color: '#00f' }, { href: 'h', doc }),
  null,
);
eq('absent element yields null', matchRule({ enabled: true, matchType: 'selector', value: '.missing', label: 'x', color: '#00f' }, { href: 'h', doc }), null);
eq('invalid selector does not throw', matchRule({ enabled: true, matchType: 'selector', value: 'BAD[[', label: 'x', color: '#00f' }, { href: 'h', doc }), null);
eq(
  'whitespace-only text yields null',
  matchRule({ enabled: true, matchType: 'selector', value: '.blank', label: 'x', color: '#00f' }, { href: 'h', doc: fakeDoc({ '.blank': '   ' }) }),
  null,
);

console.log('rules - ordering');
const ordered = [
  { id: 'a', enabled: true, matchType: 'url', value: '/accounts/999', label: 'SPECIFIC', color: '#111' },
  { id: 'b', enabled: true, matchType: 'url', value: '/accounts/', label: 'GENERIC', color: '#222' },
];
eq('first match wins', matchRules(ordered, { href: 'https://x/accounts/999' }).label, 'SPECIFIC');
eq('falls through to the generic rule', matchRules(ordered, { href: 'https://x/accounts/555' }).label, 'GENERIC');
eq('empty rule list yields null', matchRules([], { href: 'https://x/' }), null);
eq('undefined rule list yields null', matchRules(undefined, { href: 'https://x/' }), null);

console.log('rules - helpers');
eq('expandLabel leaves unknown groups alone', expandLabel('a $1 b $7', ['full', 'one']), 'a one b $7');
eq('safeRegex returns null on garbage', safeRegex('(['), null);

console.log('portal - id candidates');
eq(
  'finds numeric and uuid path segments',
  findIdCandidates('https://waas.barracudanetworks.com/accounts/4821/apps/3f2504e0-4f89-11d3-9a0c-0305e82c3301'),
  [
    { source: 'path', kind: 'numeric', value: '4821' },
    { source: 'path', kind: 'uuid', value: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' },
  ],
);
eq(
  'finds query and hash-route ids',
  findIdCandidates('https://waas.barracudanetworks.com/x?account=98765#/apps/55512/settings').map((c) => `${c.source}=${c.value}`),
  ['query:account=98765', 'hash=55512'],
);
eq('ignores ordinary path words', findIdCandidates('https://waas.barracudanetworks.com/apps/settings/general'), []);
eq('malformed url does not throw', findIdCandidates('::::'), []);

console.log('portal - origin checks');
eq('portal origin recognised', isPortal('https://waas.barracudanetworks.com/anything'), true);
eq('api host is not the portal', isPortal('https://api.waas.barracudanetworks.com/v4/'), false);
eq('lookalike suffix host rejected', isPortal('https://waas.barracudanetworks.com.evil.test/'), false);
eq('http scheme rejected', isPortal('http://waas.barracudanetworks.com/'), false);
eq('getContext flags a bad url', getContext('::::').valid, false);

console.log('deep link formatting');
eq('plain', formatLink('plain', { title: 'Apps', url: 'https://x/y' }), 'Apps\nhttps://x/y');
eq('markdown', formatLink('markdown', { title: 'Apps', url: 'https://x/y' }), '[Apps](https://x/y)');
eq('markdown escapes a closing bracket', formatLink('markdown', { title: 'A ] B', url: 'https://x' }), '[A \\] B](https://x)');
eq('url only', formatLink('url', { title: 'Apps', url: 'https://x/y' }), 'https://x/y');
eq('unknown format falls back to plain', formatLink('bogus', { title: 'A', url: 'u' }), 'A\nu');
eq('blank title gets a placeholder', cleanTitle('   '), 'WaaS portal');
eq('title whitespace is collapsed', cleanTitle(' Apps \n  list '), 'Apps list');

console.log('banner contrast');
eq('dark red gets white text', readableTextColor('#b00020'), '#ffffff');
eq('pale yellow gets dark text', readableTextColor('#ffe066'), '#101010');
eq('shorthand hex handled', readableTextColor('#fff'), '#101010');
eq('rgb() handled', readableTextColor('rgb(255, 255, 255)'), '#101010');
eq('unparseable color falls back to white', readableTextColor('chartreuse'), '#ffffff');

console.log('selector token stability');
eq('plain class is stable', isStableToken('account-name'), true);
eq('css-modules hash rejected', isStableToken('Header__title__a1b2c3'), false);
eq('emotion class rejected', isStableToken('css-1q2w3e'), false);
eq('long digit run rejected', isStableToken('col-12345'), false);
eq('short digit suffix allowed', isStableToken('col-12'), true);

console.log('dismiss list parsing');
eq(
  'lines are trimmed and blanks dropped',
  parseSelectorList('  [data-testid="a"]  \n\n   \n.b\n'),
  ['[data-testid="a"]', '.b'],
);
eq('an already-stored array passes through', parseSelectorList(['.a', '.b']), ['.a', '.b']);
eq('non-string, non-array yields empty', parseSelectorList(undefined), []);
eq('formats back to one per line', formatSelectorList(['.a', '.b']), '.a\n.b');
eq('formats a missing list as empty text', formatSelectorList(undefined), '');

console.log('dismiss selector safety');
eq('a data-testid selector is safe', isSafeSelector('[data-testid="fup-violation-dialog"]'), true);
eq('a brace is refused', isSafeSelector('.a { color: red }'), false);
eq('an at-rule is refused', isSafeSelector('@media print'), false);
eq('an angle bracket is refused', isSafeSelector('.a <script'), false);
eq('a comment close is refused', isSafeSelector('.a */'), false);
eq('empty is refused', isSafeSelector(''), false);
eq('whitespace only is refused', isSafeSelector('   '), false);
eq('non-string is refused', isSafeSelector(null), false);

console.log('close control discovery');
// Stand-in for a dialog root: only querySelector/querySelectorAll/textContent.
const fakeDialog = ({ attrs = {}, buttons = [] } = {}) => ({
  querySelector(sel) {
    if (sel === 'BAD[[') throw new Error('invalid selector');
    return attrs[sel] || null;
  },
  querySelectorAll(sel) {
    return sel === 'button' ? buttons : [];
  },
});
const TESTID = '[data-testid*="close" i]';
const ARIA = '[aria-label="Close" i]';

eq(
  'data-testid wins over aria-label',
  findCloseControl(
    fakeDialog({ attrs: { [TESTID]: { name: 'icon' }, [ARIA]: { name: 'aria' } } }),
  ).name,
  'icon',
);
eq(
  'falls back to aria-label',
  findCloseControl(fakeDialog({ attrs: { [ARIA]: { name: 'aria' } } })).name,
  'aria',
);
eq(
  'falls back to a button labelled Close',
  findCloseControl(
    fakeDialog({ buttons: [{ textContent: 'View Reports' }, { textContent: ' Close ' }] }),
  ).textContent,
  ' Close ',
);
eq(
  'button text match is case-insensitive',
  findCloseControl(fakeDialog({ buttons: [{ textContent: 'CLOSE' }] })).textContent,
  'CLOSE',
);
eq(
  'a dialog with no close control yields null',
  findCloseControl(fakeDialog({ buttons: [{ textContent: 'View Reports' }] })),
  null,
);
eq('a button with no text does not throw', findCloseControl(fakeDialog({ buttons: [{}] })), null);
eq('a root without querySelector yields null', findCloseControl({}), null);
eq('a missing root yields null', findCloseControl(null), null);

console.log('api capture - string classification');
eq('hostname recognised', classifyString('marketing.example.com'), 'hostname');
eq('wildcard hostname recognised', classifyString('*.example.com'), 'hostname');
eq('email beats hostname', classifyString('someone@example.com'), 'email');
eq('uuid recognised', classifyString('3f2504e0-4f89-11d3-9a0c-0305e82c3301'), 'uuid');
eq('url recognised', classifyString('https://example.com/a'), 'url');
eq('ipv4 recognised', classifyString('10.0.0.1'), 'ipv4');
eq('iso date recognised', classifyString('2026-01-01T00:00:00Z'), 'date');
eq('all-caps constant recognised', classifyString('ACTIVE'), 'constant');
eq('protocol word recognised', classifyString('https'), 'constant');
eq('an ordinary word is text', classifyString('Marketing Site'), 'text');
eq('a long opaque run is not text', classifyString('abcdef0123456789abcdef0123456789'), 'opaque');

console.log('api capture - key classification');
eq('camelCase key is split', isSensitiveKey('maxHostnames'), true);
eq('snake_case key is split', isSensitiveKey('backend_ip'), true);
eq('a neutral key is not sensitive', isSensitiveKey('createdAt'), false);
eq('count keys show their value', showsNumberValue('hostnameCount'), true);
eq('limit keys show their value', showsNumberValue('maxEndpoints'), true);
eq('a plain count shows', showsNumberValue('count'), true);
eq('an id never shows', showsNumberValue('accountId'), false);
eq('a serial number is not a count', showsNumberValue('serialNumber'), false);
eq('a case number is not a count', showsNumberValue('caseNumber'), false);
eq('an identifying word vetoes a count', showsNumberValue('userCount'), false);
eq('a limit keeps its value despite a sensitive word', showsNumberValue('maxHostnames'), true);
eq('a bound is recognised by its container', showsNumberValue('endpoint_domain', 'licensed_features'), true);
eq('the same key alone stays hidden', showsNumberValue('endpoint_domain'), false);
eq('the veto still applies inside a limit container', showsNumberValue('account_id', 'licensed_features'), false);
eq(
  'plan limits are shown, ids beside them are not',
  describeBody({ licensed_features: { endpoint_domain: 30, account: 12345 } }),
  '{\n  licensed_features: {\n    endpoint_domain: number(30),\n    account: number\n  }\n}',
);

console.log('api capture - value redaction');
eq('a hostname becomes a class and length', describeBody({ hostname: 'app.example.com' }), '{\n  hostname: string:hostname(15)\n}');
eq('an id number is hidden', describeBody({ accountId: 4821 }), '{\n  accountId: number\n}');
eq('a limit number is shown', describeBody({ maxDomains: 30 }), '{\n  maxDomains: number(30)\n}');
eq('a boolean is shown', describeBody({ enabled: true }), '{\n  enabled: boolean(true)\n}');
eq('null is shown', describeBody({ next: null }), '{\n  next: null\n}');
eq('a constant is shown verbatim', describeBody({ status: 'ACTIVE' }), '{\n  status: "ACTIVE"\n}');
eq(
  'a constant under a naming key is withheld',
  describeBody({ name: 'ACME' }),
  '{\n  name: string:text(4)\n}',
);
eq('an empty object renders inline', describeBody({}), '{}');
eq('an empty array renders inline', describeBody({ items: [] }), '{\n  items: []\n}');

console.log('api capture - arrays');
eq(
  'a string array reports count and a length range',
  describeBody({ hostnames: ['a.example.com', 'much-longer.example.com'] }),
  '{\n  hostnames: [ ×2 string:hostname(13..23) ]\n}',
);
eq(
  'object array items are merged into one shape',
  describeBody({ results: [{ id: 1, port: 80 }, { id: 2, port: 443, extra: true }] }),
  '{\n  results: [ ×2\n    {\n      id: number,\n      port: number(80|443),\n      extra: boolean(true)\n    }\n  ]\n}',
);
eq(
  'array items inherit the array key, so domains stay withheld',
  describeBody({ domains: ['ACTIVE'] }),
  '{\n  domains: [ ×1 string:text(6) ]\n}',
);

console.log('api capture - url redaction');
const ORIGIN = 'https://waas.barracudanetworks.com';
eq(
  'numeric and uuid path segments are replaced',
  redactUrl(`${ORIGIN}/v4/waasapi/applications/12345/endpoints/3f2504e0-4f89-11d3-9a0c-0305e82c3301`, ORIGIN),
  '/v4/waasapi/applications/{id}/endpoints/{uuid}',
);
eq(
  'a cross-origin call keeps its host',
  redactUrl('https://api.waas.barracudanetworks.com/v4/waasapi/applications/', ORIGIN),
  'https://api.waas.barracudanetworks.com/v4/waasapi/applications/',
);
eq(
  'query keys survive, values are classified',
  redactUrl(`${ORIGIN}/x?account=98765&page=2&status=ACTIVE`, ORIGIN),
  '/x?account={redacted}&page=2&status=ACTIVE',
);
eq(
  'a hash route is redacted too',
  redactUrl(`${ORIGIN}/x#/apps/55512/settings`, ORIGIN),
  '/x#/apps/{id}/settings',
);
eq(
  'a filename is kept, not mistaken for a hostname',
  redactUrl(`${ORIGIN}/assets/config.html`, ORIGIN),
  '/assets/config.html',
);
eq(
  'route words survive',
  redactUrl(`${ORIGIN}/v4/waasapi/applications_id_name/json_security/access-token`, ORIGIN),
  '/v4/waasapi/applications_id_name/json_security/access-token',
);
eq(
  'an application name in a path is replaced',
  redactUrl(`${ORIGIN}/v4/waasapi/applications/Customer%20App%2001/cdn/`, ORIGIN),
  '/v4/waasapi/applications/{name}/cdn/',
);
eq(
  'a bare capitalised name is replaced too',
  redactUrl(`${ORIGIN}/apps/AcmeCorp/edit`, ORIGIN),
  '/apps/{name}/edit',
);
eq(
  'a hostname in a path is still replaced',
  redactUrl(`${ORIGIN}/apps/marketing.example.com/edit`, ORIGIN),
  '/apps/{host}/edit',
);
eq('a malformed url does not throw', redactUrl('::::'), '(unparseable url)');

console.log('api capture - entry lines');
eq(
  'entry line carries method, redacted url, status and size',
  entryLine(
    { method: 'GET', url: `${ORIGIN}/v4/waasapi/applications/12345/`, status: 200, durationMs: 412, bytes: 2048 },
    ORIGIN,
  ),
  'GET /v4/waasapi/applications/{id}/ → 200 · 412 ms · 2.0 KB',
);
eq(
  'a failed request says so',
  entryLine({ method: 'POST', url: `${ORIGIN}/x`, error: 'NetworkError' }, ORIGIN),
  'POST /x → failed (NetworkError)',
);
eq('bytes format under a kilobyte', formatBytes(512), '512 B');
eq('bytes format over a megabyte', formatBytes(2 * 1024 * 1024), '2.0 MB');

console.log('api capture - depth and width limits');
eq(
  'deep nesting is cut off',
  describeBody({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } }),
  '{\n  a: {\n    b: {\n      c: {\n        d: {\n          e: {\n            f: {\n              g: …\n            }\n          }\n        }\n      }\n    }\n  }\n}',
);
const wide = (n) => render(summarize(Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, true]))));
eq('an object inside the key cap is not truncated', wide(50).includes('more key'), false);
eq('a wider object still closes cleanly', wide(82).split('\n').pop(), '}');
eq('the truncation note names how many were dropped', wide(82).includes('… 2 more keys'), true);

console.log('endpoint domains - harvesting');
// The shape the live portal actually returns, from a capture of
// GET /v2/waasapi/applications/{id}/endpoints/?searchPhrase=
const endpointsResponse = {
  count: 2,
  next: null,
  results: [
    { id: 11, dps_service: { port: 443, domains: ['a.example.com', 'b.example.com'] } },
    { id: 12, dps_service: { port: 80, domains: ['c.example.com'] } },
  ],
};
eq(
  'domain lists are found whatever their depth',
  harvestDomains(endpointsResponse),
  [['a.example.com', 'b.example.com'], ['c.example.com']],
);
eq(
  'the nested copy inside an application object is found too',
  harvestDomains({ application: { endpoints: [{ dps_service: { domains: ['x.example.com'] } }] } }),
  [['x.example.com']],
);
eq('hostnames key is accepted as well', harvestDomains({ hostnames: ['y.example.com'] }), [['y.example.com']]);
eq('non-hostname strings are dropped', harvestDomains({ domains: ['not a domain', 'z.example.com'] }), [['z.example.com']]);
eq('an empty domain list is skipped', harvestDomains({ domains: [] }), []);
eq('a null body does not throw', harvestDomains(null), []);
eq('a wildcard domain counts', looksLikeHostname('*.example.com'), true);
eq('a bare word is not a domain', looksLikeHostname('marketing'), false);

console.log('endpoint domains - indexing');
const domainIndex = indexDomains(harvestDomains(endpointsResponse));
eq('every domain maps to its own list', domainIndex.get('b.example.com'), ['a.example.com', 'b.example.com']);
eq('lookups are case-insensitive by key', domainIndex.get('c.example.com'), ['c.example.com']);
eq('an unknown domain is absent', domainIndex.has('nope.example.com'), false);
eq('a later response replaces an earlier one', indexDomains([['a.example.com', 'new.example.com']], domainIndex).get('a.example.com'), ['a.example.com', 'new.example.com']);

console.log('endpoint domains - cell text');
eq(
  'the portal cell format is parsed',
  parseDomainCell('marketing.example.com (7 of 30 Domains)'),
  { domain: 'marketing.example.com', shown: 7, total: 30 },
);
eq(
  'split elements and ragged whitespace still parse',
  parseDomainCell('\n  marketing.example.com\n   (7 of 30 Domains)  '),
  { domain: 'marketing.example.com', shown: 7, total: 30 },
);
eq(
  'a singular domain is handled',
  parseDomainCell('solo.example.com (1 of 30 Domain)'),
  { domain: 'solo.example.com', shown: 1, total: 30 },
);
eq('case does not matter', parseDomainCell('a.example.com (2 of 5 DOMAINS)').shown, 2);
eq('a cell without the count phrase is ignored', parseDomainCell('marketing.example.com'), null);
eq('an unrelated cell is ignored', parseDomainCell('Enabled'), null);
eq('a whole table of text is refused', parseDomainCell('x '.repeat(300) + '(1 of 2 Domains)'), null);
eq('a count with no hostname still parses', parseDomainCell('(3 of 30 Domains)').domain, null);
eq('non-string input is ignored', parseDomainCell(undefined), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
