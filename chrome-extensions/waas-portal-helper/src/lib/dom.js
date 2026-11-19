/** DOM utilities shared by the content-script features. */

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/**
 * Copy text to the clipboard.
 *
 * navigator.clipboard.writeText needs the document focused and, in some paths,
 * transient user activation. A keyboard *command* is dispatched from the
 * service worker, so the content script has neither guaranteed. The
 * execCommand fallback still works in that case, so we try both.
 *
 * @returns {Promise<boolean>} whether the copy succeeded
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
  document.body.appendChild(ta);

  // Preserve whatever the user had selected.
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }

  ta.remove();
  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;

export function showToast(message, { variant = 'info', duration = 2200 } = {}) {
  let el = document.querySelector('.wph-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'wph-toast';
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.dataset.variant = variant;
  // Restart the CSS entry animation even if a toast is already showing.
  el.classList.remove('wph-toast--visible');
  void el.offsetWidth;
  el.classList.add('wph-toast--visible');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('wph-toast--visible'), duration);
}

// ---------------------------------------------------------------------------
// Selector generation
// ---------------------------------------------------------------------------

/**
 * Tokens that look machine-generated and will change on the next deploy:
 * CSS-modules hashes, styled-components/emotion classes, JSS counters, and
 * anything carrying a long hex run or a 4+ digit number.
 */
const UNSTABLE_TOKEN = /(^|[-_])[0-9a-f]{6,}($|[-_])|\d{4,}|^css-|^sc-[A-Za-z]|^jss\d+$|^emotion-|__[A-Za-z0-9]{5,}$/i;

export function isStableToken(token) {
  if (!token || token.length > 60) return false;
  return !UNSTABLE_TOKEN.test(token);
}

function isUnique(selector, root = document) {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function stableClasses(el) {
  return Array.from(el.classList)
    .filter((c) => !c.startsWith('wph-') && isStableToken(c))
    .slice(0, 2);
}

function segmentFor(el) {
  let segment = el.localName;

  const classes = stableClasses(el);
  if (classes.length) {
    segment += classes.map((c) => `.${CSS.escape(c)}`).join('');
    return segment;
  }

  // No usable class — fall back to position among same-tag siblings.
  const parent = el.parentElement;
  if (parent) {
    const sameTag = Array.from(parent.children).filter((c) => c.localName === el.localName);
    if (sameTag.length > 1) {
      segment += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
    }
  }
  return segment;
}

/**
 * Build a CSS selector for `el`, preferring hooks that survive a redeploy:
 * stable id > data-* attribute > class path > structural path.
 *
 * This is the point of the inspector — these selectors become banner rules.
 */
export function cssPath(el, maxDepth = 6) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';

  if (el.id && isStableToken(el.id)) {
    const selector = `#${CSS.escape(el.id)}`;
    if (isUnique(selector)) return selector;
  }

  // data-* attributes are usually the most deliberate, most stable hooks.
  for (const attr of el.attributes) {
    if (!attr.name.startsWith('data-')) continue;
    if (!attr.value || !isStableToken(attr.value)) continue;
    const selector = `${el.localName}[${attr.name}="${attr.value.replace(/"/g, '\\"')}"]`;
    if (isUnique(selector)) return selector;
  }

  const parts = [];
  let node = el;
  let depth = 0;
  while (node && node.nodeType === Node.ELEMENT_NODE && depth < maxDepth) {
    parts.unshift(segmentFor(node));
    const selector = parts.join(' > ');
    if (isUnique(selector)) return selector;
    if (node.id && isStableToken(node.id)) {
      const anchored = `#${CSS.escape(node.id)} > ${parts.slice(1).join(' > ')}`;
      if (isUnique(anchored)) return anchored;
    }
    node = node.parentElement;
    depth += 1;
  }

  return parts.join(' > ');
}

/** Human-readable summary of an element, for the inspector overlay. */
export function describeElement(el) {
  const dataAttrs = Array.from(el.attributes)
    .filter((a) => a.name.startsWith('data-'))
    .map((a) => `${a.name}="${a.value}"`);

  const text = (el.textContent || '').trim().replace(/\s+/g, ' ');

  return {
    tag: el.localName,
    id: el.id || null,
    classes: Array.from(el.classList).filter((c) => !c.startsWith('wph-')),
    dataAttrs,
    text: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    selector: cssPath(el),
  };
}
