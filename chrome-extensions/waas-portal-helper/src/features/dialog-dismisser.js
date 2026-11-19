/**
 * Auto-dismiss portal dialogs.
 *
 * The portal pops a "Fair Usage Policy Limit Exceeded" modal on every fresh load
 * of /applications, with no way to stop it from the UI. This closes it before it
 * paints.
 *
 * Two steps, and both are needed:
 *
 *   1. A generated stylesheet hides the listed dialogs, so none of this is ever
 *      visible even for a frame.
 *   2. The dialog's own close button is clicked, so MUI runs its normal teardown.
 *
 * Step 2 is the important one. MUI locks scrolling (`body { overflow: hidden }`)
 * and sets `aria-hidden` on the app root while a modal is open, and only undoes
 * that when the modal closes. Hiding the dialog without closing it would leave
 * the page permanently unscrollable. Clicking its close button lets MUI clean up
 * after itself.
 *
 * We never remove the dialog node: it lives in a React-managed portal container,
 * and tearing that out from under React is what produces a `removeChild` crash
 * later in the page's life.
 *
 * Selectors are user-configurable (options page) because this extension cannot
 * see the portal's markup to infer them. The shipped default was read off the
 * live DOM with the inspector.
 */

import { parseSelectorList, isSafeSelector, findCloseControl } from '../lib/dialogs.js';
import { log, warn, error } from '../lib/log.js';

export const id = 'dialogDismisser';

const STYLE_ID = 'wph-dismiss-style';

/** Clicking can race React's render; give it a couple of tries before falling back. */
const MAX_ATTEMPTS = 3;
const RECHECK_MS = [50, 250];

let observer = null;
let styleEl = null;
let selectors = [];
const timers = new Set();

/** Per-element attempt count. Weak so a dismissed dialog can be collected. */
const attempts = new WeakMap();

/** Elements already resolved one way or the other, so we report each once. */
const settled = new WeakSet();

// ---------------------------------------------------------------------------

export function apply(settings) {
  if (!settings.features.dialogDismisser) {
    teardown();
    return;
  }

  selectors = parseSelectorList(settings.dismissSelectors).filter(usable);

  if (!selectors.length) {
    teardown();
    return;
  }

  installStyle();
  installObserver();
  scan();
}

export function onLocationChange() {
  // Cheap, and covers a dialog that appears as part of an in-app navigation.
  if (selectors.length) scan();
}

// ---------------------------------------------------------------------------

/** Reject selectors that are unsafe to interpolate into CSS, or simply invalid. */
function usable(selector) {
  if (!isSafeSelector(selector)) {
    // Always warn: this one is a misconfiguration worth noticing.
    warn(`dismisser: refusing unsafe selector ${JSON.stringify(selector)}`);
    return false;
  }
  try {
    document.querySelector(selector);
  } catch {
    // Debug-only — the options page flags invalid selectors inline, and a
    // half-typed selector shouldn't spray the portal's console.
    log(`dismisser: invalid selector ${JSON.stringify(selector)}`);
    return false;
  }
  return true;
}

/**
 * One rule per selector rather than a single grouped rule: if a selector slips
 * past `usable()`, the browser drops only its own rule instead of the whole set.
 */
function installStyle() {
  if (!styleEl || !styleEl.isConnected) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    document.documentElement.appendChild(styleEl);
  }
  styleEl.textContent = selectors
    .map((selector) => `${selector} { display: none !important; }`)
    .join('\n');
}

function installObserver() {
  if (observer) return;
  observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  log('dismisser: watching for', selectors);
}

function scan() {
  for (const selector of selectors) {
    let found;
    try {
      found = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    // Only first sightings start here. Retries are driven by verify()'s timers,
    // so they stay spaced out — the observer fires many times per render pass,
    // and letting it retry would spend every attempt before React has wired up
    // the dialog's buttons.
    for (const el of found) {
      if (!attempts.has(el)) handle(el, selector);
    }
  }
}

function handle(el, selector) {
  const tried = attempts.get(el) || 0;
  if (tried >= MAX_ATTEMPTS) return;
  attempts.set(el, tried + 1);

  // A dialog caught mid-render may not have its buttons yet, so a miss here is
  // not final — the rechecks below will try again.
  const closeEl = findCloseControl(el);
  if (closeEl) {
    try {
      closeEl.click();
    } catch (err) {
      error('dismisser: close click threw', err);
    }
  }

  for (const delay of RECHECK_MS) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      verify(el, selector);
    }, delay);
    timers.add(timer);
  }
}

/**
 * Did MUI actually unmount it? If not, retry; once the attempts are spent, leave
 * it hidden and undo the side effects by hand.
 */
function verify(el, selector) {
  if (settled.has(el)) return; // both rechecks fire; only report once
  if (!el.isConnected) {
    settled.add(el);
    log(`dismisser: dismissed ${describe(el, selector)}`);
    return;
  }
  if ((attempts.get(el) || 0) < MAX_ATTEMPTS) {
    handle(el, selector);
    return;
  }
  settled.add(el);
  releasePageLock();
  warn(`dismisser: ${describe(el, selector)} would not close — hidden, scroll lock released`);
}

/**
 * Undo the two things MUI does to the rest of the page while a modal is open.
 * Both were confirmed on the live portal: `body { overflow: hidden }` and
 * `aria-hidden="true"` on the app's `#root`. Only touched when they look like
 * MUI's lock, so this can't clobber an unrelated style.
 */
function releasePageLock() {
  const body = document.body;
  if (body && body.style.overflow === 'hidden') {
    body.style.removeProperty('overflow');
    body.style.removeProperty('padding-right'); // MUI's scrollbar compensation
  }

  const root = document.getElementById('root');
  if (root && root.getAttribute('aria-hidden') === 'true') {
    root.removeAttribute('aria-hidden');
  }
}

function describe(el, selector) {
  const testId = el.getAttribute?.('data-testid');
  return testId ? `${testId} (${selector})` : selector;
}

function teardown() {
  observer?.disconnect();
  observer = null;

  for (const timer of timers) clearTimeout(timer);
  timers.clear();

  styleEl?.remove();
  styleEl = null;
  selectors = [];
}
