/**
 * Generic longest-common-subsequence diff over two arrays. Shared by the JSON
 * and Markdown comparators so "what changed" always means the same thing:
 * the smallest set of adds/removes that explains the difference, not a
 * position-by-position string compare.
 */

export function diffArrays(a, b, equals = (x, y) => x === y) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = equals(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (equals(a[i], b[j])) {
      ops.push({ type: 'equal', a: a[i], b: b[j], ai: i, bi: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', a: a[i], ai: i });
      i += 1;
    } else {
      ops.push({ type: 'add', b: b[j], bi: j });
      j += 1;
    }
  }
  while (i < n) { ops.push({ type: 'remove', a: a[i], ai: i }); i += 1; }
  while (j < m) { ops.push({ type: 'add', b: b[j], bi: j }); j += 1; }
  return ops;
}
