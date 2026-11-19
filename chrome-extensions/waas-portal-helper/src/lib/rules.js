/**
 * Banner rule evaluation.
 *
 * A rule answers one question: "which tenant/environment am I looking at, and
 * how alarming should that be?" Because the portal's DOM is unknown to this
 * extension, rules are written by the user rather than inferred. Two kinds:
 *
 *   url      — regex tested against the full URL
 *   selector — CSS selector whose text content identifies the account,
 *              optionally narrowed by a second regex
 *
 * Labels support $0..$9 backreferences so one rule can cover many accounts,
 * e.g. selector `.account-name` with label `$0 — PRODUCTION`.
 */

/** Compile a regex source, returning null instead of throwing on bad input. */
export function safeRegex(source, flags = '') {
  if (!source) return null;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/** Replace $0..$9 in `template` with entries from a regex match array. */
export function expandLabel(template, groups) {
  if (!template) return '';
  return template.replace(/\$([0-9])/g, (whole, digit) => {
    const value = groups?.[Number(digit)];
    return value === undefined ? whole : value;
  });
}

/**
 * Evaluate one rule against the current page.
 * @returns {{label: string, color: string, rule: object}|null}
 */
export function matchRule(rule, { href, doc } = {}) {
  if (!rule || rule.enabled === false) return null;
  if (!rule.value) return null;

  if (rule.matchType === 'url') {
    const re = safeRegex(rule.value, 'i');
    if (!re) return null;
    const m = re.exec(href);
    if (!m) return null;
    return {
      rule,
      color: rule.color,
      label: expandLabel(rule.label, m) || m[0],
    };
  }

  if (rule.matchType === 'selector') {
    // Resolved here rather than as a default parameter so the matcher can be
    // exercised outside a browser with a stand-in document.
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return null;

    let el;
    try {
      el = root.querySelector(rule.value);
    } catch {
      return null; // invalid selector — treat as no match
    }
    if (!el) return null;

    const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!text) return null;

    // Without a textPattern the element's text *is* the match ($0).
    let groups = [text];
    if (rule.textPattern) {
      const re = safeRegex(rule.textPattern, 'i');
      if (!re) return null;
      const m = re.exec(text);
      if (!m) return null;
      groups = m;
    }

    return {
      rule,
      color: rule.color,
      label: expandLabel(rule.label, groups) || groups[0],
    };
  }

  return null;
}

/**
 * Evaluate rules in order; first match wins. Order is the user's priority, so
 * the options page keeps rules movable.
 */
export function matchRules(rules, context) {
  for (const rule of rules || []) {
    const hit = matchRule(rule, context);
    if (hit) return hit;
  }
  return null;
}
