/**
 * Copy a shareable link to the current portal page (Alt+Shift+C).
 *
 * Deliberately built on nothing but `location.href` and `document.title`, so
 * it cannot break when the portal's markup changes.
 */

import { copyText, showToast } from '../lib/dom.js';
import { log } from '../lib/log.js';

export const id = 'deepLink';

const COMMAND = 'copy-deep-link';

export function onCommand(command, settings) {
  if (command !== COMMAND) return;

  if (!settings.features.deepLink) {
    showToast('Copy deep link is disabled in settings', { variant: 'error' });
    return;
  }

  const text = formatLink(settings.deepLinkFormat, {
    title: cleanTitle(document.title),
    url: location.href,
  });

  copyText(text).then((ok) => {
    log('deep link copy', ok ? 'ok' : 'failed');
    showToast(ok ? 'Deep link copied' : 'Copy failed — try clicking the page first', {
      variant: ok ? 'success' : 'error',
    });
  });
}

/** Collapse whitespace and drop a trailing site-name suffix if present. */
export function cleanTitle(title) {
  const trimmed = (title || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'WaaS portal';
  return trimmed;
}

export function formatLink(format, { title, url }) {
  switch (format) {
    case 'url':
      return url;
    case 'markdown':
      return `[${title.replace(/\]/g, '\\]')}](${url})`;
    case 'plain':
    default:
      return `${title}\n${url}`;
  }
}
