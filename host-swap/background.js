import { applySwaps } from './apply.js';
import { migrateConfig } from './swap.js';

async function reconcile() {
  const stored = await chrome.storage.local.get(null);
  await applySwaps(migrateConfig(stored).swaps);
}

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') reconcile();
});

reconcile();
