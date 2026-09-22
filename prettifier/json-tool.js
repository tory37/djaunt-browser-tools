export const INDENT_OPTIONS = [2, 4];
export const DEFAULT_INDENT = 2;

function locateError(text, message) {
  // Recent V8 already appends "(line N column M)" for most position-bearing
  // errors; only compute it ourselves when the engine's message didn't.
  if (/\bline \d+\b/i.test(message)) return message;
  const match = /position (\d+)/.exec(message);
  if (!match) return message;
  const pos = Number(match[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return `${message} (line ${line}, column ${col})`;
}

/** Parses JSON without throwing, returning a location-annotated message on failure. */
export function parseJsonSafe(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    return { value: undefined, error: locateError(text, error.message) };
  }
}

export function beautifyJson(text, indent = DEFAULT_INDENT) {
  const { value, error } = parseJsonSafe(text);
  if (error) throw new Error(error);
  return `${JSON.stringify(value, null, indent)}\n`;
}

export function minifyJson(text) {
  const { value, error } = parseJsonSafe(text);
  if (error) throw new Error(error);
  return JSON.stringify(value);
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Structural diff between two parsed JSON values: which property paths were
 * added, removed, changed, or changed type — not a line-by-line text diff.
 */
export function diffJson(a, b) {
  const changes = [];

  function walk(path, av, bv) {
    const at = typeOf(av);
    const bt = typeOf(bv);
    if (at !== bt) {
      changes.push({ path: path || '(root)', kind: 'type-changed', before: av, after: bv, beforeType: at, afterType: bt });
      return;
    }
    if (at === 'object') {
      const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
      for (const key of keys) {
        const childPath = path ? `${path}.${key}` : key;
        if (!(key in av)) { changes.push({ path: childPath, kind: 'added', after: bv[key] }); continue; }
        if (!(key in bv)) { changes.push({ path: childPath, kind: 'removed', before: av[key] }); continue; }
        walk(childPath, av[key], bv[key]);
      }
      return;
    }
    if (at === 'array') {
      const max = Math.max(av.length, bv.length);
      for (let i = 0; i < max; i += 1) {
        const childPath = `${path || '(root)'}[${i}]`;
        if (i >= av.length) { changes.push({ path: childPath, kind: 'added', after: bv[i] }); continue; }
        if (i >= bv.length) { changes.push({ path: childPath, kind: 'removed', before: av[i] }); continue; }
        walk(childPath, av[i], bv[i]);
      }
      return;
    }
    if (av !== bv) changes.push({ path: path || '(root)', kind: 'changed', before: av, after: bv });
  }

  walk('', a, b);
  return changes;
}

export function summarizeJsonDiff(changes) {
  return {
    added: changes.filter((c) => c.kind === 'added').length,
    removed: changes.filter((c) => c.kind === 'removed').length,
    changed: changes.filter((c) => c.kind === 'changed' || c.kind === 'type-changed').length,
    total: changes.length,
  };
}

function renderValue(value) {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

export function jsonDiffReport(changes) {
  if (!changes.length) return 'No differences.\n';
  const lines = changes.map((change) => {
    if (change.kind === 'added') return `+ ${change.path} = ${renderValue(change.after)}`;
    if (change.kind === 'removed') return `- ${change.path} = ${renderValue(change.before)}`;
    if (change.kind === 'type-changed') {
      return `~ ${change.path}: ${change.beforeType} ${renderValue(change.before)} -> ${change.afterType} ${renderValue(change.after)}`;
    }
    return `~ ${change.path}: ${renderValue(change.before)} -> ${renderValue(change.after)}`;
  });
  return `${lines.join('\n')}\n`;
}
