import { applyTweaks } from './apply.js';
import { migrateConfig } from './params.js';

const api = globalThis.browser ?? globalThis.chrome;

async function reconcile() {
  const stored = await api.storage.local.get(null);
  await applyTweaks(migrateConfig(stored).tweaks);
}

api.runtime.onInstalled.addListener(reconcile);
api.runtime.onStartup.addListener(reconcile);
api.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') reconcile();
});

reconcile();
