/**
 * API capture — recon for features that need portal *data*.
 *
 * The portal is behind SSO, so this extension can't see its markup or its API
 * from here. The way out is to have the user capture what their own browser
 * already receives and hand back something safe to share. That's this feature:
 * turn it on, reload a portal page, and every API call shows up in the console
 * with its URL and response **shape** — key names kept, values redacted by
 * `lib/api-shape.js`.
 *
 * The toolbar popup copies the whole log, which is the intended way to get it
 * out: the console will also contain the portal's own logging, and that is not
 * redacted.
 *
 * Capture is a diagnostic, so unlike `lib/log.js` it prints whether or not
 * verbose logging is on — printing is the entire feature.
 */

import { subscribeTap, clearTap } from '../lib/tap-client.js';
import { formatCaptureLog, formatEntry, entryLine } from '../lib/api-shape.js';
import { showToast } from '../lib/dom.js';
import { log } from '../lib/log.js';

export const id = 'apiCapture';

const PREFIX = '[waas-helper]';

/** Plenty for a page load; keeps a long session from growing without bound. */
const MAX_ENTRIES = 200;

let active = false;
let unsubscribe = null;
const entries = [];

// ---------------------------------------------------------------------------

export function apply(settings) {
  const wanted = Boolean(settings.features.apiCapture);
  if (wanted === active) return; // idempotent: apply() runs on every change
  if (wanted) start();
  else stop();
}

function start() {
  active = true;
  entries.length = 0;

  unsubscribe = subscribeTap(onEntry, { onMissing });

  console.log(
    `${PREFIX} API capture on. Portal API calls will be logged here with values redacted.\n` +
      `${PREFIX} Reload the page to capture the calls made during page load.`,
  );
  showToast('API capture on — see the console');
}

function stop() {
  active = false;
  unsubscribe?.();
  unsubscribe = null;
  entries.length = 0;
  log('capture: off');
  showToast('API capture off');
}

function onMissing() {
  console.warn(
    `${PREFIX} API capture: the page-world tap isn't loaded. ` +
      `Reload this page — it only injects on navigation.`,
  );
  showToast('API capture needs a page reload', { variant: 'error', duration: 4000 });
}

function onEntry(entry) {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  // Collapsed so a busy page stays readable; the detail is one click away.
  console.groupCollapsed(`${PREFIX} ${entryLine(entry, location.origin)}`);
  console.log(formatEntry(entry, location.origin));
  console.groupEnd();
}

// ---------------------------------------------------------------------------
// Read by the popup, via boot.js
// ---------------------------------------------------------------------------

export function captureCount() {
  return entries.length;
}

export function captureLog() {
  return formatCaptureLog(entries, location.origin);
}

export function clearCaptures() {
  entries.length = 0;
  clearTap();
}

export function isCapturing() {
  return active;
}
