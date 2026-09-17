import { ALL_RULE_IDS, buildRules, resolveEnabledTweaks } from './params.js';

const BADGE_ACTIVE = '#7FD8F0'; // --dj-accent, frost
const BADGE_ERROR = '#E0492E'; // --dj-danger
const BADGE_ON_ACCENT = '#070F12'; // --dj-on-accent, frost

async function setBadge(state, count) {
  const text = { active: String(count), error: 'ERR', idle: '' }[state];
  await chrome.action.setBadgeText({ text });
  if (state === 'idle') return;
  await chrome.action.setBadgeBackgroundColor({
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
    const installed = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = [...new Set([...ALL_RULE_IDS, ...installed.map((rule) => rule.id)])];
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: buildRules(ready),
    });
    await setBadge(ready.length ? 'active' : (broken.length ? 'error' : 'idle'), ready.length);
  };
  inFlight = inFlight.then(run, run);
  await inFlight;
  return { ready, broken };
}
