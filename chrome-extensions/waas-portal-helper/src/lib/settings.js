/**
 * Settings storage, shared by the content script, popup, options page, and
 * service worker.
 *
 * Uses chrome.storage.sync so rules follow the signed-in Chrome profile across
 * machines. Note sync's limits: ~8KB per item, ~100KB total. Banner rules are
 * tiny, but a few hundred of them would hit the per-item cap — if that ever
 * happens, move `bannerRules` to chrome.storage.local.
 */

export const DEFAULTS = {
  features: {
    accountBanner: true,
    deepLink: true,
    inspector: true,
    dialogDismisser: true,
    // Off by default: it logs every portal API call to the console, which is
    // noise unless you're actively working out what an endpoint returns.
    apiCapture: false,
    endpointDomains: true,
  },

  /** @type {BannerRule[]} */
  bannerRules: [],

  /**
   * Dialogs closed automatically, as CSS selectors matching the dialog's root.
   *
   * The default is the portal's Fair Usage Policy modal, which reappears on
   * every fresh page load with no way to silence it from the UI. Its
   * `data-testid` was read off the live DOM — unlike the MUI emotion classes
   * beside it (`css-19bfmdu`), it survives a portal redeploy.
   */
  dismissSelectors: ['[data-testid="fup-violation-dialog"]'],

  /** Push page content down by the banner height instead of overlapping it. */
  bannerOffsetsPage: true,

  /** 'plain' | 'markdown' | 'url' */
  deepLinkFormat: 'plain',

  /** Verbose console logging, off by default. */
  debug: false,
};

/**
 * @typedef {Object} BannerRule
 * @property {string}  id          Stable identifier.
 * @property {boolean} enabled
 * @property {string}  label       Display text. Supports $0..$9 backreferences.
 * @property {string}  color       Background color, any CSS color string.
 * @property {'url'|'selector'} matchType
 * @property {string}  value       Regex source (url) or CSS selector (selector).
 * @property {string} [textPattern] Optional regex applied to selector text.
 */

/** Read all settings, with defaults filled in. */
export async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  return {
    ...DEFAULTS,
    ...stored,
    // `features` is nested, so a shallow spread would drop newly-added flags
    // for users whose stored object predates them.
    features: { ...DEFAULTS.features, ...(stored.features || {}) },
  };
}

/** Merge a partial update into storage. */
export async function saveSettings(patch) {
  await chrome.storage.sync.set(patch);
}

/** Toggle a single feature flag without clobbering the others. */
export async function setFeatureEnabled(name, enabled) {
  const { features } = await getSettings();
  await saveSettings({ features: { ...features, [name]: Boolean(enabled) } });
}

/**
 * Subscribe to settings changes. Invokes `callback` with the full merged
 * settings object. Returns an unsubscribe function.
 */
export function onSettingsChanged(callback) {
  const listener = (_changes, area) => {
    if (area !== 'sync') return;
    getSettings().then(callback);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Create a blank rule with a unique id. */
export function newRule() {
  return {
    id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    enabled: true,
    label: '',
    color: '#b00020',
    matchType: 'url',
    value: '',
    textPattern: '',
  };
}
