import { getSettings, setFeatureEnabled } from '../lib/settings.js';

const statusEl = document.getElementById('status');
const lineEl = document.getElementById('status-line');
const detailEl = document.getElementById('status-detail');

async function renderToggles() {
  const { features } = await getSettings();
  for (const input of document.querySelectorAll('[data-feature]')) {
    input.checked = Boolean(features[input.dataset.feature]);
    input.addEventListener('change', () => {
      setFeatureEnabled(input.dataset.feature, input.checked);
    });
  }
}

function setStatus(state, line, detail = '', swatch = null) {
  statusEl.dataset.state = state;
  lineEl.textContent = line;
  detailEl.textContent = detail;
  if (swatch) statusEl.style.setProperty('--swatch', swatch);
}

/**
 * Ask the content script what it sees. A failed sendMessage means no content
 * script is running there, i.e. we're not on the portal — that's the normal
 * case, not an error worth surfacing as one.
 */
async function renderStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('off', 'No active tab');
    return;
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: 'getContext' });
  } catch {
    setStatus('off', 'Not on the WaaS portal', 'Open waas.barracudanetworks.com to use these features.');
    return;
  }

  if (!response?.ok) {
    setStatus('off', 'No response from page', 'Try reloading the tab.');
    return;
  }

  const { context, banner } = response;

  if (banner) {
    setStatus('banner', banner.label, 'Matched a banner rule.', banner.color);
    return;
  }

  // On the portal but no rule matched — point at the IDs we can see in the URL,
  // since those are the raw material for writing one.
  const ids = (context.idCandidates || []).map((c) => `${c.source}: ${c.value}`);
  setStatus(
    'portal',
    'On the WaaS portal',
    ids.length
      ? `No banner rule matched. Identifiers in URL — ${ids.join(', ')}`
      : 'No banner rule matched. Add one under "Banner rules & settings".',
  );
}

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById('open-shortcuts').addEventListener('click', () => {
  // chrome:// pages can't be opened with a plain link, and the shortcuts page
  // is where Chrome makes the user resolve key conflicts.
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

renderToggles();
renderStatus();
