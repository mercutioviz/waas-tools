/**
 * Show an endpoint's full domain list on hover.
 *
 * The endpoints grid renders one domain and a count — `app.example.com (7 of 30
 * Domains)` — and the only way to see the rest is to open the endpoint for
 * editing. The response that populated the grid already contains every domain,
 * so this watches that response go past (via the page-world tap) and puts the
 * list in a hover card.
 *
 * Two things make this robust in a way a selector-based feature wouldn't be:
 *
 *   - **No CSS selectors.** Cells are found by their own visible text, via
 *     `parseDomainCell`. MUI's emotion classes rehash every release; the
 *     portal's wording doesn't.
 *   - **No assumed JSON path.** `harvestDomains` looks for any domain array in
 *     the body, so the same code handles the `/endpoints/` response and the
 *     copy nested in `/applications/{id}/`.
 *
 * The card opens on hover and *stays* while the pointer is on either the cell
 * or the card, so its contents can be selected and copied. Esc closes it.
 */

import { subscribeTap } from '../lib/tap-client.js';
import { harvestDomains, indexDomains, parseDomainCell } from '../lib/endpoints.js';
import { copyText, showToast } from '../lib/dom.js';
import { log } from '../lib/log.js';

export const id = 'endpointDomains';

/** Long enough not to fire while scanning the grid, short enough to feel direct. */
const OPEN_DELAY_MS = 250;

/** Grace period for crossing the gap between the cell and the card. */
const CLOSE_DELAY_MS = 180;

/** How far up from the hovered node to look for the cell. */
const MAX_ANCESTORS = 5;

const OWN_UI = '.wph-domains-card, .wph-banner, .wph-toast, .wph-inspect-box, .wph-inspect-panel';

/** domain (lowercase) -> the full list it belongs to */
let index = new Map();

let unsubscribe = null;
let active = false;

let cardEl = null;
let anchorEl = null;
let openTimer = null;
let closeTimer = null;
let pointerInCard = false;

// ---------------------------------------------------------------------------

export function apply(settings) {
  const wanted = Boolean(settings.features.endpointDomains);
  if (wanted === active) return; // idempotent: apply() runs on every change
  if (wanted) start();
  else stop();
}

function start() {
  active = true;
  index = new Map();

  unsubscribe = subscribeTap(onEntry, { onMissing });

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onScroll, true);

  log('domains: watching for endpoint responses');
}

function stop() {
  active = false;

  unsubscribe?.();
  unsubscribe = null;

  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('scroll', onScroll, true);

  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  closeCard();
  index = new Map();
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function onEntry(entry) {
  if (!entry?.body) return;

  const lists = harvestDomains(entry.body);
  if (!lists.length) return;

  const before = index.size;
  indexDomains(lists, index);
  log(`domains: ${lists.length} list(s) from ${entry.method} ${entry.url} (+${index.size - before})`);
}

function onMissing() {
  log('domains: no page-world tap — a page reload is needed after an extension reload');
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

function isOwnUi(el) {
  return Boolean(el?.closest?.(OWN_UI));
}

/**
 * Walk up looking for the element whose text is the whole cell. Stopping at the
 * first match keeps the anchor tight: a row or the table would also contain the
 * phrase, and the card would then be positioned against the wrong box.
 */
function findCell(start) {
  let el = start;
  for (let i = 0; el && i < MAX_ANCESTORS; i += 1) {
    if (el.nodeType === Node.ELEMENT_NODE) {
      const parsed = parseDomainCell(el.textContent || '');
      if (parsed) return { el, parsed };
    }
    el = el.parentElement;
  }
  return null;
}

function onMouseOver(event) {
  if (!active) return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  if (isOwnUi(target)) {
    // Inside our own card: cancel any pending close.
    pointerInCard = true;
    clearTimeout(closeTimer);
    return;
  }
  pointerInCard = false;

  const hit = findCell(target);

  if (!hit) {
    clearTimeout(openTimer);
    scheduleClose();
    return;
  }

  if (hit.el === anchorEl && cardEl) {
    clearTimeout(closeTimer);
    return;
  }

  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  openTimer = setTimeout(() => openCard(hit.el, hit.parsed), OPEN_DELAY_MS);
}

function scheduleClose() {
  if (!cardEl) return;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (!pointerInCard) closeCard();
  }, CLOSE_DELAY_MS);
}

function onKeyDown(event) {
  if (event.key === 'Escape' && cardEl) {
    closeCard();
  }
}

function onScroll() {
  // Repositioning against a scrolling virtualized grid is more trouble than
  // it's worth; the card would drift off its row anyway.
  if (cardEl) closeCard();
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function lookup(parsed) {
  if (parsed.domain && index.has(parsed.domain)) return index.get(parsed.domain);

  // The cell showed something we haven't indexed — fall back to any indexed
  // list whose length matches what the cell claims, but only if it's the one.
  const matches = [...new Set(index.values())].filter((list) => list.length === parsed.shown);
  return matches.length === 1 ? matches[0] : null;
}

function openCard(cell, parsed) {
  const domains = lookup(parsed);
  closeCard();

  anchorEl = cell;
  cardEl = document.createElement('div');
  cardEl.className = 'wph-domains-card';

  const head = document.createElement('div');
  head.className = 'wph-domains-card__head';

  const title = document.createElement('span');
  title.className = 'wph-domains-card__title';
  title.textContent = domains
    ? `${domains.length} of ${parsed.total} domains`
    : `${parsed.shown} of ${parsed.total} domains`;
  head.append(title);

  if (domains) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'wph-domains-card__copy';
    copy.textContent = 'Copy all';
    copy.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyText(domains.join('\n')).then((ok) => {
        copy.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => {
          copy.textContent = 'Copy all';
        }, 1400);
        if (!ok) showToast('Copy failed', { variant: 'error' });
      });
    });
    head.append(copy);
  }

  cardEl.append(head);

  const body = document.createElement('div');
  body.className = 'wph-domains-card__body';

  if (!domains) {
    body.classList.add('wph-domains-card__body--empty');
    body.textContent =
      index.size === 0
        ? 'No endpoint data captured yet — reload the page to load the list.'
        : 'This endpoint was not in the captured response. Reload the page.';
  } else {
    for (const domain of domains) {
      const row = document.createElement('div');
      row.className = 'wph-domains-card__row';
      // textContent, never innerHTML: this string came off the wire.
      row.textContent = domain;
      if (parsed.domain && domain.toLowerCase() === parsed.domain) {
        row.classList.add('wph-domains-card__row--shown');
      }
      body.append(row);
    }

    // Say so rather than quietly disagreeing with the portal.
    if (domains.length !== parsed.shown) {
      const note = document.createElement('div');
      note.className = 'wph-domains-card__note';
      note.textContent = `The grid says ${parsed.shown}. This list may be out of date — reload the page.`;
      body.append(note);
    }
  }

  cardEl.append(body);

  cardEl.addEventListener('mouseenter', () => {
    pointerInCard = true;
    clearTimeout(closeTimer);
  });
  cardEl.addEventListener('mouseleave', () => {
    pointerInCard = false;
    scheduleClose();
  });

  // documentElement, not body: a SPA re-render of the body can't take it away.
  document.documentElement.append(cardEl);
  position(cell);
}

function position(cell) {
  const rect = cell.getBoundingClientRect();
  const card = cardEl.getBoundingClientRect();
  const margin = 8;

  let left = rect.left;
  if (left + card.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - card.width - margin);
  }

  // Prefer below; flip above when there isn't room.
  let top = rect.bottom + 6;
  if (top + card.height > window.innerHeight - margin) {
    const above = rect.top - card.height - 6;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - card.height - margin);
  }

  cardEl.style.left = `${Math.round(left)}px`;
  cardEl.style.top = `${Math.round(top)}px`;
}

function closeCard() {
  cardEl?.remove();
  cardEl = null;
  anchorEl = null;
  pointerInCard = false;
}
