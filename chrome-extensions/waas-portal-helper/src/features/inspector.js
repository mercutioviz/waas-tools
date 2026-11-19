/**
 * DOM inspector overlay (Alt+Shift+I).
 *
 * This exists because the portal sits behind SSO, so the extension ships with
 * no knowledge of its markup. Hover an element to see a selector that should
 * survive a redeploy, click to copy it, then paste it into a banner rule on
 * the options page. Esc or Alt+Shift+I again exits.
 */

import { cssPath, describeElement, copyText, showToast } from '../lib/dom.js';
import { log } from '../lib/log.js';

export const id = 'inspector';

const COMMAND = 'toggle-inspector';
const OWN_UI = '.wph-banner, .wph-inspect-box, .wph-inspect-panel, .wph-toast';

let active = false;
let boxEl = null;
let panelEl = null;
let target = null;

export function isActive() {
  return active;
}

export function apply(settings) {
  // Turning the feature off in the popup should also drop an active overlay.
  if (!settings.features.inspector && active) stop();
}

export function onCommand(command, settings) {
  if (command !== COMMAND) return;

  if (!settings.features.inspector) {
    showToast('Inspector is disabled in settings', { variant: 'error' });
    return;
  }

  if (active) stop();
  else start();
}

// ---------------------------------------------------------------------------

function start() {
  if (active) return;
  active = true;

  boxEl = document.createElement('div');
  boxEl.className = 'wph-inspect-box';

  panelEl = document.createElement('div');
  panelEl.className = 'wph-inspect-panel';
  panelEl.innerHTML = `
    <div class="wph-inspect-panel__hint">Click an element to copy its selector &middot; Esc to exit</div>
    <div class="wph-inspect-panel__body"><em>Hover an element&hellip;</em></div>
  `;

  document.documentElement.append(boxEl, panelEl);

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('mousedown', swallow, true);
  document.addEventListener('mouseup', swallow, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition, true);

  log('inspector: on');
  showToast('Inspector on — click an element to copy its selector');
}

function stop() {
  if (!active) return;
  active = false;

  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('mousedown', swallow, true);
  document.removeEventListener('mouseup', swallow, true);
  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('scroll', reposition, true);
  window.removeEventListener('resize', reposition, true);

  boxEl?.remove();
  panelEl?.remove();
  boxEl = panelEl = target = null;

  log('inspector: off');
  showToast('Inspector off');
}

// ---------------------------------------------------------------------------

function isOwnUi(el) {
  return !!(el && el.closest && el.closest(OWN_UI));
}

function onMouseMove(event) {
  const el = event.target;
  if (!(el instanceof Element) || isOwnUi(el)) return;
  if (el === target) return;

  target = el;
  reposition();
  describe(el);
}

function reposition() {
  if (!active || !target || !boxEl) return;
  const rect = target.getBoundingClientRect();
  boxEl.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  boxEl.style.width = `${rect.width}px`;
  boxEl.style.height = `${rect.height}px`;
}

function describe(el) {
  const info = describeElement(el);

  const rows = [
    ['selector', info.selector],
    ['tag', info.tag],
    info.id ? ['id', info.id] : null,
    info.classes.length ? ['class', info.classes.join(' ')] : null,
    info.dataAttrs.length ? ['data', info.dataAttrs.join(' ')] : null,
    info.text ? ['text', info.text] : null,
  ].filter(Boolean);

  panelEl.querySelector('.wph-inspect-panel__body').innerHTML = rows
    .map(
      ([key, value]) =>
        `<div class="wph-inspect-row"><span class="wph-inspect-key">${key}</span>` +
        `<span class="wph-inspect-val">${escapeHtml(value)}</span></div>`,
    )
    .join('');
}

function onClick(event) {
  const el = event.target;
  if (isOwnUi(el)) return;

  // The portal is a live app — a stray click could submit or navigate.
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (!(el instanceof Element)) return;
  const selector = cssPath(el);
  copyText(selector).then((ok) => {
    showToast(ok ? `Copied: ${selector}` : 'Copy failed', {
      variant: ok ? 'success' : 'error',
      duration: 3200,
    });
  });
}

/** Block mousedown/mouseup so the page can't react before our click handler. */
function swallow(event) {
  if (isOwnUi(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    stop();
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
