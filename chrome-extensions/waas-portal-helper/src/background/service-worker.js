/**
 * Service worker.
 *
 * Its only job is relaying keyboard commands to the content script in the
 * active tab. Note there is no `tabs` permission: chrome.tabs.query still
 * returns tab *ids* without it (just not urls/titles), and an id is all we
 * need to send a message.
 */

import { getSettings } from '../lib/settings.js';

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

chrome.commands.onCommand.addListener(async (command) => {
  const tabId = await activeTabId();
  if (tabId == null) return;

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'command', command });
  } catch {
    // Expected whenever the active tab isn't the WaaS portal: no content
    // script is listening there. Nothing to do.
    console.debug('[waas-helper] no content script in active tab for', command);
  }
});

// Open the options page on first install so the banner rules — the part that
// needs configuring before anything visible happens — are easy to find.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  const settings = await getSettings();
  if ((settings.bannerRules || []).length === 0) {
    chrome.runtime.openOptionsPage();
  }
});
