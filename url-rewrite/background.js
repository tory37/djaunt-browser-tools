import { applyRewrites } from './apply.js';

const api = globalThis.browser ?? globalThis.chrome;

async function reconcile() {
  const { rewrites } = await api.storage.local.get('rewrites');
  await applyRewrites(Array.isArray(rewrites) ? rewrites : []);
}

api.runtime.onInstalled.addListener(reconcile);
api.runtime.onStartup.addListener(reconcile);
api.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') reconcile();
});

reconcile();
