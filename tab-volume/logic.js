export const FULL_VOLUME = 1;

export const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));

export function hostOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.hostname
      : null;
  } catch {
    return null;
  }
}

/** A volume set on the tab alone wins over the one saved for its domain. */
export function pickVolume(tabVolume, domainVolume) {
  if (typeof tabVolume === 'number') return tabVolume;
  if (typeof domainVolume === 'number') return domainVolume;
  return FULL_VOLUME;
}

export function levelFor(percent) {
  if (percent === 0) return 'muted';
  if (percent < 34) return 'low';
  if (percent < 67) return 'mid';
  return 'high';
}
