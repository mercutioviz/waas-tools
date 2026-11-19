/**
 * Account safety banner.
 *
 * The problem this solves: the WaaS portal looks identical whichever tenant
 * you're in, and a config change in the wrong customer's account is expensive.
 * This paints an unmissable strip across the top naming the account.
 *
 * Rules are user-written (see the options page) because this extension cannot
 * see the portal's markup to infer them — use the inspector feature to find a
 * selector, then build a rule from it.
 */

import { matchRules } from '../lib/rules.js';
import { log } from '../lib/log.js';

export const id = 'accountBanner';

const BANNER_CLASS = 'wph-banner';
const HTML_FLAG = 'wph-has-banner';

let bannerEl = null;
let observer = null;
let debounceTimer = null;
let currentKey = '';
let current = null;
let dismissed = false; // reset on navigation / settings change
let settingsRef = null;

/** Exposed to the popup so it can show what was detected. */
export function currentMatch() {
  return current ? { label: current.label, color: current.color, ruleId: current.rule.id } : null;
}

// ---------------------------------------------------------------------------

export function apply(settings) {
  settingsRef = settings;

  if (!settings.features.accountBanner) {
    teardown();
    return;
  }

  dismissed = false;
  ensureObserver(settings);
  evaluate();
}

export function onLocationChange() {
  // A new page may belong to a different account, so an earlier dismissal
  // shouldn't suppress the warning here.
  dismissed = false;
  evaluate();
}

// ---------------------------------------------------------------------------

function ensureObserver(settings) {
  // Only selector rules need to watch the DOM; if every rule matches on URL we
  // can skip the MutationObserver entirely.
  const needsObserver = (settings.bannerRules || []).some(
    (r) => r.enabled !== false && r.matchType === 'selector',
  );

  if (!needsObserver) {
    stopObserver();
    return;
  }
  if (observer) return;

  observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(evaluate, 250);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  log('banner: watching DOM for selector rules');
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  clearTimeout(debounceTimer);
}

function evaluate() {
  if (!settingsRef || !settingsRef.features.accountBanner) return;

  const match = matchRules(settingsRef.bannerRules, { href: location.href });
  current = match;

  if (!match || dismissed) {
    removeBanner();
    currentKey = '';
    return;
  }

  // Avoid rebuilding (and re-animating) an identical banner on every mutation.
  const key = `${match.label}|${match.color}`;
  if (key === currentKey && bannerEl?.isConnected) return;
  currentKey = key;

  render(match);
}

function render(match) {
  if (!bannerEl || !bannerEl.isConnected) {
    bannerEl = document.createElement('div');
    bannerEl.className = BANNER_CLASS;
    bannerEl.setAttribute('role', 'status');
    bannerEl.innerHTML = `
      <span class="wph-banner__dot" aria-hidden="true"></span>
      <span class="wph-banner__label"></span>
      <button class="wph-banner__close" type="button" title="Hide until next navigation">&times;</button>
    `;
    bannerEl.querySelector('.wph-banner__close').addEventListener('click', () => {
      dismissed = true;
      removeBanner();
    });
    document.documentElement.appendChild(bannerEl);
  }

  bannerEl.querySelector('.wph-banner__label').textContent = match.label;
  bannerEl.style.setProperty('background-color', match.color || '#b00020', 'important');
  bannerEl.style.setProperty('color', readableTextColor(match.color), 'important');

  if (settingsRef.bannerOffsetsPage) {
    document.documentElement.classList.add(HTML_FLAG);
  } else {
    document.documentElement.classList.remove(HTML_FLAG);
  }

  log('banner:', match.label, `(rule ${match.rule.id})`);
}

function removeBanner() {
  bannerEl?.remove();
  bannerEl = null;
  document.documentElement.classList.remove(HTML_FLAG);
}

function teardown() {
  stopObserver();
  removeBanner();
  current = null;
  currentKey = '';
}

// ---------------------------------------------------------------------------

/**
 * Pick black or white text for a user-chosen background.
 * Handles #rgb, #rrggbb and rgb()/rgba(); anything else falls back to white,
 * which is correct for the dark colors these banners normally use.
 */
export function readableTextColor(color) {
  const rgb = parseColor(color);
  if (!rgb) return '#ffffff';
  // Perceived luminance (ITU-R BT.601).
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.6 ? '#101010' : '#ffffff';
}

function parseColor(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return short.slice(1, 4).map((h) => parseInt(h + h, 16));

  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (long) return long.slice(1, 4).map((h) => parseInt(h, 16));

  const fn = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
  if (fn) return fn.slice(1, 4).map(Number);

  return null;
}
