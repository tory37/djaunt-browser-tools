import assert from 'node:assert/strict';
import {
  isRestrictedUrl, looksLikeJson, formatJsonPreview, byteLength, formatBytes,
  sortEntries, filterEntries, totalBytes, buildExport,
} from './storage.js';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

// ---- isRestrictedUrl ----

check('isRestrictedUrl: chrome:// is restricted', () => {
  assert.equal(isRestrictedUrl('chrome://extensions'), true);
});

check('isRestrictedUrl: about: is restricted', () => {
  assert.equal(isRestrictedUrl('about:debugging'), true);
});

check('isRestrictedUrl: moz-extension: is restricted', () => {
  assert.equal(isRestrictedUrl('moz-extension://abc/popup.html'), true);
});

check('isRestrictedUrl: chrome web store host is restricted', () => {
  assert.equal(isRestrictedUrl('https://chromewebstore.google.com/detail/x'), true);
});

check('isRestrictedUrl: addons.mozilla.org is restricted', () => {
  assert.equal(isRestrictedUrl('https://addons.mozilla.org/en-US/firefox/'), true);
});

check('isRestrictedUrl: ordinary https page is not restricted', () => {
  assert.equal(isRestrictedUrl('https://example.com/app'), false);
});

check('isRestrictedUrl: empty/undefined url is restricted', () => {
  assert.equal(isRestrictedUrl(''), true);
  assert.equal(isRestrictedUrl(undefined), true);
});

check('isRestrictedUrl: unparseable string is restricted', () => {
  assert.equal(isRestrictedUrl('not a url'), true);
});

// ---- looksLikeJson ----

check('looksLikeJson: object literal', () => {
  assert.equal(looksLikeJson('{"a":1}'), true);
});

check('looksLikeJson: array literal', () => {
  assert.equal(looksLikeJson('[1,2,3]'), true);
});

check('looksLikeJson: plain string is not JSON-object-like', () => {
  assert.equal(looksLikeJson('"hello"'), false);
});

check('looksLikeJson: bare number is not JSON-object-like', () => {
  assert.equal(looksLikeJson('42'), false);
});

check('looksLikeJson: plain text', () => {
  assert.equal(looksLikeJson('hello world'), false);
});

check('looksLikeJson: empty string', () => {
  assert.equal(looksLikeJson(''), false);
});

check('looksLikeJson: malformed object', () => {
  assert.equal(looksLikeJson('{a:1}'), false);
});

check('looksLikeJson: whitespace-padded object', () => {
  assert.equal(looksLikeJson('  {"a":1}  '), true);
});

// ---- formatJsonPreview ----

check('formatJsonPreview: pretty-prints valid JSON', () => {
  assert.equal(formatJsonPreview('{"a":1}'), '{\n  "a": 1\n}');
});

check('formatJsonPreview: custom indent', () => {
  assert.equal(formatJsonPreview('{"a":1}', 4), '{\n    "a": 1\n}');
});

check('formatJsonPreview: returns input unchanged when not JSON', () => {
  assert.equal(formatJsonPreview('not json'), 'not json');
});

// ---- byteLength / formatBytes ----

check('byteLength: ascii string', () => {
  assert.equal(byteLength('abc'), 3);
});

check('byteLength: multi-byte characters', () => {
  assert.equal(byteLength('é'), 2);
});

check('formatBytes: under 1KB', () => {
  assert.equal(formatBytes(500), '500 B');
});

check('formatBytes: kilobytes', () => {
  assert.equal(formatBytes(2048), '2.0 KB');
});

check('formatBytes: megabytes', () => {
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

// ---- sortEntries ----

check('sortEntries: alphabetical by key', () => {
  const sorted = sortEntries([{ key: 'b', value: '1' }, { key: 'a', value: '2' }]);
  assert.deepEqual(sorted.map((e) => e.key), ['a', 'b']);
});

check('sortEntries: does not mutate input', () => {
  const input = [{ key: 'b', value: '1' }, { key: 'a', value: '2' }];
  sortEntries(input);
  assert.equal(input[0].key, 'b');
});

// ---- filterEntries ----

check('filterEntries: matches by key', () => {
  const entries = [{ key: 'token', value: '1' }, { key: 'name', value: '2' }];
  assert.deepEqual(filterEntries(entries, 'tok').map((e) => e.key), ['token']);
});

check('filterEntries: matches by value', () => {
  const entries = [{ key: 'a', value: 'hello' }, { key: 'b', value: 'world' }];
  assert.deepEqual(filterEntries(entries, 'wor').map((e) => e.key), ['b']);
});

check('filterEntries: case-insensitive', () => {
  const entries = [{ key: 'Token', value: '1' }];
  assert.equal(filterEntries(entries, 'TOK').length, 1);
});

check('filterEntries: empty query returns all', () => {
  const entries = [{ key: 'a', value: '1' }, { key: 'b', value: '2' }];
  assert.equal(filterEntries(entries, '').length, 2);
});

check('filterEntries: no match returns empty', () => {
  const entries = [{ key: 'a', value: '1' }];
  assert.equal(filterEntries(entries, 'zzz').length, 0);
});

// ---- totalBytes ----

check('totalBytes: sums key + value bytes', () => {
  const entries = [{ key: 'ab', value: 'cd' }, { key: 'e', value: 'f' }];
  assert.equal(totalBytes(entries), 6);
});

check('totalBytes: empty list is zero', () => {
  assert.equal(totalBytes([]), 0);
});

// ---- buildExport ----

check('buildExport: builds a sorted JSON object', () => {
  const entries = [{ key: 'b', value: '2' }, { key: 'a', value: '1' }];
  assert.equal(buildExport(entries), '{\n  "a": "1",\n  "b": "2"\n}');
});

check('buildExport: empty list', () => {
  assert.equal(buildExport([]), '{}');
});

console.log(`${passed + failed} assertions, ${failed} failed`);
if (failed > 0) process.exit(1);
