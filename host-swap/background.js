import { applySwaps } from './apply.js';
import { migrateConfig } from './swap.js';

const api = globalThis.browser ?? globalThis.chrome;

async function reconcile() {
  const stored = await api.storage.local.get(null);
  await applySwaps(migrateConfig(stored).swaps);
}

api.runtime.onInstalled.addListener(reconcile);
api.runtime.onStartup.addListener(reconcile);
api.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') reconcile();
});

reconcile();
