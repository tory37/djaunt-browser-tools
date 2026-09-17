import { applyTweaks } from './apply.js';
import { migrateConfig } from './params.js';

async function reconcile() {
  const stored = await chrome.storage.local.get(null);
  await applyTweaks(migrateConfig(stored).tweaks);
}

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') reconcile();
});

reconcile();
