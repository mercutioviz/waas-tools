/**
 * Content script entry point.
 *
 * Manifest-declared content scripts cannot be ES modules, so this classic
 * script does nothing but dynamically import the real module graph. Everything
 * it loads is listed in `web_accessible_resources`.
 */
(() => {
  'use strict';

  // The isolated world persists across soft navigations; guard against the
  // (unlikely but cheap to prevent) case of being injected twice.
  if (window.__wphLoaded) return;
  window.__wphLoaded = true;

  import(chrome.runtime.getURL('src/content/boot.js'))
    .then((module) => module.boot())
    .catch((err) => console.error('[waas-helper] failed to load:', err));
})();
