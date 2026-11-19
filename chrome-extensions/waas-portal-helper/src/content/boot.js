/**
 * Wires features to settings, navigation, and commands.
 *
 * Each feature module exports an optional `apply(settings)`, `onCommand(cmd,
 * settings)`, and `onLocationChange(href, settings)`. `apply` is called on
 * startup and again on every settings change, so it must be idempotent and
 * must tear itself down when its flag is off.
 */

import { getSettings, onSettingsChanged } from '../lib/settings.js';
import { setDebug, log, error } from '../lib/log.js';
import { getContext, onLocationChange } from '../lib/portal.js';

import * as accountBanner from '../features/account-banner.js';
import * as deepLink from '../features/deep-link.js';
import * as inspector from '../features/inspector.js';
import * as dialogDismisser from '../features/dialog-dismisser.js';

const FEATURES = [accountBanner, deepLink, inspector, dialogDismisser];

let settings = null;

/** Never let one broken feature take down the others. */
function safe(label, fn) {
  try {
    fn();
  } catch (err) {
    error(`feature "${label}" threw:`, err);
  }
}

function applyAll() {
  for (const feature of FEATURES) {
    if (feature.apply) safe(feature.id, () => feature.apply(settings));
  }
}

export async function boot() {
  settings = await getSettings();
  setDebug(settings.debug);
  log('booting', { href: location.href, features: settings.features });

  applyAll();

  onSettingsChanged((next) => {
    settings = next;
    setDebug(next.debug);
    log('settings changed');
    applyAll();
  });

  onLocationChange((href) => {
    log('navigated', href);
    for (const feature of FEATURES) {
      if (feature.onLocationChange) {
        safe(feature.id, () => feature.onLocationChange(href, settings));
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'command') {
      log('command', message.command);
      for (const feature of FEATURES) {
        if (feature.onCommand) {
          safe(feature.id, () => feature.onCommand(message.command, settings));
        }
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'getContext') {
      sendResponse({
        ok: true,
        context: getContext(),
        banner: accountBanner.currentMatch(),
        inspectorActive: inspector.isActive(),
      });
      return false;
    }

    return false;
  });
}
