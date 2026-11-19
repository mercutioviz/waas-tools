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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
