/**
 * Helpers for the dialog dismisser.
 *
 * Kept free of real DOM dependencies (the element helpers take their root as a
 * parameter and touch only querySelector/querySelectorAll/textContent) so the
 * Node logic suite can exercise them with a stand-in element — same approach
 * lib/rules.js takes for selector rules.
 */

/** Split a textarea's contents into a list of selectors. */
export function parseSelectorList(text) {
  if (typeof text !== 'string') return Array.isArray(text) ? text.slice() : [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Render a stored list back into textarea contents. */
export function formatSelectorList(list) {
  return (Array.isArray(list) ? list : []).join('\n');
}

/**
 * Lexical guard, not a syntax check.
 *
 * These selectors get interpolated into a generated stylesheet, so a stray brace
 * would end the rule block early and let the rest of the line be parsed as CSS.
 * `@` is refused for the same reason — it could open an at-rule. Whether the
 * selector is actually *valid* is a separate question, answered at the call site
 * with a try/catch around querySelector, which needs a real DOM.
 */
export function isSafeSelector(selector) {
  if (typeof selector !== 'string') return false;
  const value = selector.trim();
  if (!value) return false;
  return !/[{}<>@]/.test(value) && !value.includes('*/');
}

/**
 * Find the control that closes a dialog, most reliable candidate first.
 *
 * The portal's dialogs are MUI, which gives its buttons a `data-testid` (the FUP
 * dialog has both `fup-dialog-close-icon` and `fup-dialog-close-button`) and an
 * `aria-label="Close"` on the × icon. The text match is the last resort, for a
 * dialog that has neither.
 *
 * @returns {Element|null}
 */
export function findCloseControl(root) {
  if (!root || typeof root.querySelector !== 'function') return null;

  const byAttr = ['[data-testid*="close" i]', '[aria-label="Close" i]'];
  for (const selector of byAttr) {
    let found;
    try {
      found = root.querySelector(selector);
    } catch {
      found = null; // querySelector in a stand-in may not support every selector
    }
    if (found) return found;
  }

  let buttons = [];
  try {
    buttons = Array.from(root.querySelectorAll('button') || []);
  } catch {
    return null;
  }

  for (const button of buttons) {
    if ((button.textContent || '').trim().toLowerCase() === 'close') return button;
  }

  return null;
}
