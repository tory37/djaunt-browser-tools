import { ALL_RULE_IDS, buildRules, resolveEnabledTweaks } from './headers.js';

const api = globalThis.browser ?? globalThis.chrome;

const BADGE_ACTIVE = '#2FB3C9'; // --dj-accent, deep
const BADGE_ERROR = '#E0492E'; // --dj-danger

async function setBadge(state, count) {
  const text = { active: String(count), error: 'ERR', idle: '' }[state];
  await api.action.setBadgeText({ text });
  if (state === 'idle') return;
  await api.action.setBadgeBackgroundColor({
    color: state === 'active' ? BADGE_ACTIVE : BADGE_ERROR,
  });
}

// Serialises calls made from this context; the id sweep below covers the rest.
let inFlight = Promise.resolve();

/**
 * Replaces every dynamic rule with the ones the given tweaks ask for. Callable from
 * the popup as well as the service worker, so a stale worker cannot leave the rules
 * out of step with the saved tweaks.
 *
 * Removes the whole id range the extension can own, not just the ids seen in a
 * snapshot: two overlapping calls would each miss the rules the other just added and
 * the update would fail with a duplicate id, installing nothing.
 */
export async function applyTweaks(tweaks) {
  const { ready, broken } = resolveEnabledTweaks(tweaks);
  const run = async () => {
    const installed = await api.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = [...new Set([...ALL_RULE_IDS, ...installed.map((rule) => rule.id)])];
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: buildRules(ready),
    });
    await setBadge(ready.length ? 'active' : (broken.length ? 'error' : 'idle'), ready.length);
  };
  inFlight = inFlight.then(run, run);
  await inFlight;
  return { ready, broken };
}
