import { getSettings, saveSettings, newRule } from '../lib/settings.js';
import { safeRegex } from '../lib/rules.js';
import { parseSelectorList, formatSelectorList, isSafeSelector } from '../lib/dialogs.js';

const rulesEl = document.getElementById('rules');
const savedEl = document.getElementById('saved');

let settings = null;
let saveTimer = null;
let savedTimer = null;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveSettings({
      bannerRules: settings.bannerRules,
      bannerOffsetsPage: settings.bannerOffsetsPage,
      deepLinkFormat: settings.deepLinkFormat,
      dismissSelectors: settings.dismissSelectors,
      debug: settings.debug,
    });
    flashSaved();
  }, 300);
}

function flashSaved() {
  savedEl.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedEl.hidden = true;
  }, 1400);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** @returns {string} an error message, or '' when the rule is usable */
function validate(rule) {
  if (!rule.value) return 'Needs a URL pattern or a CSS selector.';

  if (rule.matchType === 'url') {
    if (!safeRegex(rule.value)) return 'Not a valid regular expression.';
  } else {
    try {
      document.querySelector(rule.value);
    } catch {
      return 'Not a valid CSS selector.';
    }
  }

  if (rule.textPattern && !safeRegex(rule.textPattern)) {
    return 'Text pattern is not a valid regular expression.';
  }

  return '';
}

/**
 * Check every selector in the dismiss list.
 * @returns {string} an error message naming the first bad line, or ''
 */
function validateSelectors(list) {
  for (const selector of list) {
    if (!isSafeSelector(selector)) {
      return `"${selector}" can't be used — remove any { } < > @ characters.`;
    }
    try {
      document.querySelector(selector);
    } catch {
      return `"${selector}" is not a valid CSS selector.`;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

function renderRule(rule) {
  const row = el('div', { className: 'rule' });
  row.dataset.id = rule.id;
  row.dataset.enabled = String(rule.enabled !== false);
  row.style.setProperty('--swatch', rule.color || '#b00020');

  const enabled = el('input', { type: 'checkbox', checked: rule.enabled !== false, title: 'Enable this rule' });
  enabled.dataset.k = 'enabled';

  const color = el('input', { type: 'color', value: normalizeHex(rule.color), title: 'Banner color' });
  color.dataset.k = 'color';

  const label = el('input', {
    type: 'text',
    className: 'rule__label',
    value: rule.label || '',
    placeholder: 'Label — blank uses the matched text. Supports $0–$9',
  });
  label.dataset.k = 'label';

  const up = el('button', { type: 'button', className: 'icon-btn', textContent: '↑', title: 'Move up' });
  up.dataset.act = 'up';
  const down = el('button', { type: 'button', className: 'icon-btn', textContent: '↓', title: 'Move down' });
  down.dataset.act = 'down';
  const del = el('button', { type: 'button', className: 'icon-btn icon-btn--danger', textContent: 'Delete' });
  del.dataset.act = 'del';

  row.append(el('div', { className: 'rule__top' }, [enabled, color, label, up, down, del]));

  const isSelector = rule.matchType === 'selector';

  const type = el('select');
  type.dataset.k = 'matchType';
  type.append(
    el('option', { value: 'url', textContent: 'URL match', selected: !isSelector }),
    el('option', { value: 'selector', textContent: 'Element text', selected: isSelector }),
  );

  const value = el('input', {
    type: 'text',
    className: 'mono',
    value: rule.value || '',
    placeholder: isSelector ? '.account-name, [data-account]' : '/accounts/12345\\b',
  });
  value.dataset.k = 'value';

  const grid = el('div', { className: `rule__grid${isSelector ? ' rule__grid--three' : ''}` }, [type, value]);

  if (isSelector) {
    const textPattern = el('input', {
      type: 'text',
      className: 'mono',
      value: rule.textPattern || '',
      placeholder: 'Optional: regex to extract from text',
    });
    textPattern.dataset.k = 'textPattern';
    grid.append(textPattern);
  }

  row.append(grid);

  const problem = validate(rule);
  if (problem) {
    value.classList.add('invalid');
    row.append(el('div', { className: 'rule__err', textContent: problem }));
  }

  return row;
}

function renderRules() {
  rulesEl.replaceChildren();

  if (!settings.bannerRules.length) {
    rulesEl.append(
      el('div', {
        className: 'empty',
        textContent:
          'No rules yet. Add one to get a banner naming the tenant you are working in.',
      }),
    );
    return;
  }

  for (const rule of settings.bannerRules) rulesEl.append(renderRule(rule));
}

function renderGlobals() {
  document.getElementById('bannerOffsetsPage').checked = settings.bannerOffsetsPage;
  document.getElementById('deepLinkFormat').value = settings.deepLinkFormat;
  document.getElementById('debug').checked = settings.debug;
  document.getElementById('dismissSelectors').value = formatSelectorList(
    settings.dismissSelectors,
  );
  showSelectorProblem(validateSelectors(settings.dismissSelectors));
}

function showSelectorProblem(problem) {
  const field = document.getElementById('dismissSelectors');
  const errEl = document.getElementById('dismissSelectors-err');
  field.classList.toggle('invalid', Boolean(problem));
  errEl.textContent = problem;
  errEl.hidden = !problem;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function findRule(node) {
  const row = node.closest('.rule');
  if (!row) return null;
  return settings.bannerRules.find((r) => r.id === row.dataset.id) || null;
}

/** Update state as the user types, without re-rendering (that would steal focus). */
rulesEl.addEventListener('input', (event) => {
  const key = event.target.dataset?.k;
  if (!key) return;
  const rule = findRule(event.target);
  if (!rule) return;

  rule[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;

  const row = event.target.closest('.rule');
  if (key === 'color') row.style.setProperty('--swatch', rule.color);
  if (key === 'enabled') row.dataset.enabled = String(rule.enabled);

  // Inline validation feedback on the pattern field only.
  if (key === 'value' || key === 'textPattern') {
    const problem = validate(rule);
    row.querySelector('[data-k="value"]').classList.toggle('invalid', Boolean(problem));
    let err = row.querySelector('.rule__err');
    if (problem) {
      if (!err) {
        err = el('div', { className: 'rule__err' });
        row.append(err);
      }
      err.textContent = problem;
    } else {
      err?.remove();
    }
  }

  scheduleSave();
});

/** matchType changes the shape of the row, so that one needs a re-render. */
rulesEl.addEventListener('change', (event) => {
  if (event.target.dataset?.k !== 'matchType') return;
  const rule = findRule(event.target);
  if (!rule) return;
  rule.matchType = event.target.value;
  renderRules();
  scheduleSave();
});

rulesEl.addEventListener('click', (event) => {
  const action = event.target.dataset?.act;
  if (!action) return;

  const rule = findRule(event.target);
  if (!rule) return;
  const index = settings.bannerRules.indexOf(rule);

  if (action === 'del') {
    settings.bannerRules.splice(index, 1);
  } else if (action === 'up' && index > 0) {
    settings.bannerRules.splice(index - 1, 0, settings.bannerRules.splice(index, 1)[0]);
  } else if (action === 'down' && index < settings.bannerRules.length - 1) {
    settings.bannerRules.splice(index + 1, 0, settings.bannerRules.splice(index, 1)[0]);
  } else {
    return;
  }

  renderRules();
  scheduleSave();
});

document.getElementById('add-rule').addEventListener('click', () => {
  settings.bannerRules.push(newRule());
  renderRules();
  rulesEl.lastElementChild?.querySelector('[data-k="label"]')?.focus();
  scheduleSave();
});

for (const id of ['bannerOffsetsPage', 'debug']) {
  document.getElementById(id).addEventListener('change', (event) => {
    settings[id] = event.target.checked;
    scheduleSave();
  });
}

document.getElementById('deepLinkFormat').addEventListener('change', (event) => {
  settings.deepLinkFormat = event.target.value;
  scheduleSave();
});

document.getElementById('dismissSelectors').addEventListener('input', (event) => {
  settings.dismissSelectors = parseSelectorList(event.target.value);
  // Saved either way — the content script skips bad entries and keeps the rest,
  // so a half-typed selector doesn't block the others from taking effect.
  showSelectorProblem(validateSelectors(settings.dismissSelectors));
  scheduleSave();
});

// ---------------------------------------------------------------------------

/** <input type="color"> only accepts #rrggbb. */
function normalizeHex(color) {
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) return color;
  if (typeof color === 'string' && /^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split('').map((c) => c + c).join('')}`;
  }
  return '#b00020';
}

(async function init() {
  settings = await getSettings();
  renderGlobals();
  renderRules();
})();
