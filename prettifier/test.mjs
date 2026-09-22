import { diffArrays } from './diff.js';
import {
  beautifyJson, diffJson, jsonDiffReport, minifyJson, parseJsonSafe, summarizeJsonDiff,
} from './json-tool.js';
import {
  beautifyMarkdown, diffMarkdown, groupSections, markdownDiffReport, parseMarkdownBlocks,
  summarizeMarkdownDiff,
} from './markdown-tool.js';

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass += 1; return; }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
}

function checkThrows(label, fn) {
  try {
    fn();
    failures.push(`${label}\n    expected a throw, got none`);
  } catch {
    pass += 1;
  }
}

// ---- diffArrays ----
check('diffArrays equal', diffArrays([1, 2, 3], [1, 2, 3]).map((o) => o.type), ['equal', 'equal', 'equal']);
check('diffArrays add', diffArrays([1, 3], [1, 2, 3]).map((o) => o.type), ['equal', 'add', 'equal']);
check('diffArrays remove', diffArrays([1, 2, 3], [1, 3]).map((o) => o.type), ['equal', 'remove', 'equal']);
check('diffArrays disjoint', diffArrays(['a'], ['b']).map((o) => o.type), ['remove', 'add']);
check('diffArrays empty vs empty', diffArrays([], []), []);

// ---- JSON: parse / beautify / minify ----
check('parseJsonSafe valid', parseJsonSafe('{"a":1}').value, { a: 1 });
check('parseJsonSafe invalid has message', typeof parseJsonSafe('{a:1}').error, 'string');
check('parseJsonSafe invalid reports a position or line', /position|line/i.test(parseJsonSafe('{"a": 1,}').error), true);

check('beautifyJson default indent', beautifyJson('{"a":1,"b":[1,2]}'), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n');
check('beautifyJson 4-space indent', beautifyJson('{"a":1}', 4), '{\n    "a": 1\n}\n');
checkThrows('beautifyJson throws on invalid input', () => beautifyJson('{bad'));

check('minifyJson', minifyJson('{\n  "a": 1,\n  "b": [1, 2]\n}'), '{"a":1,"b":[1,2]}');
checkThrows('minifyJson throws on invalid input', () => minifyJson('nope'));

// ---- JSON: structural diff ----
check('diffJson: added key', diffJson({ a: 1 }, { a: 1, b: 2 }), [{ path: 'b', kind: 'added', after: 2 }]);
check('diffJson: removed key', diffJson({ a: 1, b: 2 }, { a: 1 }), [{ path: 'b', kind: 'removed', before: 2 }]);
check('diffJson: changed value', diffJson({ a: 1 }, { a: 2 }), [{ path: 'a', kind: 'changed', before: 1, after: 2 }]);
check('diffJson: nested path', diffJson({ user: { name: 'a' } }, { user: { name: 'b' } }),
  [{ path: 'user.name', kind: 'changed', before: 'a', after: 'b' }]);
check('diffJson: type change', diffJson({ a: 1 }, { a: '1' }),
  [{ path: 'a', kind: 'type-changed', before: 1, after: '1', beforeType: 'number', afterType: 'string' }]);
check('diffJson: array element changed', diffJson({ tags: ['a', 'b'] }, { tags: ['a', 'c'] }),
  [{ path: 'tags[1]', kind: 'changed', before: 'b', after: 'c' }]);
check('diffJson: array grew', diffJson({ tags: ['a'] }, { tags: ['a', 'b'] }),
  [{ path: 'tags[1]', kind: 'added', after: 'b' }]);
check('diffJson: identical values produce no diff', diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), []);
check('diffJson: root type change', diffJson([1, 2], { a: 1 }),
  [{ path: '(root)', kind: 'type-changed', before: [1, 2], after: { a: 1 }, beforeType: 'array', afterType: 'object' }]);

check('summarizeJsonDiff', summarizeJsonDiff(diffJson({ a: 1, b: 2 }, { a: 9, c: 3 })), { added: 1, removed: 1, changed: 1, total: 3 });
check('jsonDiffReport: no differences', jsonDiffReport([]), 'No differences.\n');
check('jsonDiffReport: lists paths', jsonDiffReport(diffJson({ a: 1 }, { a: 2 })), '~ a: 1 -> 2\n');

// ---- Markdown: block parsing ----
check('parseMarkdownBlocks: heading', parseMarkdownBlocks('# Title').map((b) => b.type), ['heading']);
check('parseMarkdownBlocks: heading text/level', parseMarkdownBlocks('## Setup')[0], { type: 'heading', level: 2, text: 'Setup' });
check('parseMarkdownBlocks: paragraph merges wrapped lines', parseMarkdownBlocks('one\ntwo\n\nthree')[0], { type: 'paragraph', text: 'one two' });
check('parseMarkdownBlocks: unordered list', parseMarkdownBlocks('- a\n- b')[0], { type: 'list', ordered: false, items: ['a', 'b'] });
check('parseMarkdownBlocks: ordered list', parseMarkdownBlocks('1. a\n2. b')[0], { type: 'list', ordered: true, items: ['a', 'b'] });
check('parseMarkdownBlocks: hr', parseMarkdownBlocks('---')[0], { type: 'hr' });
check('parseMarkdownBlocks: blockquote', parseMarkdownBlocks('> hello\n> world')[0], { type: 'blockquote', text: 'hello world' });
check('parseMarkdownBlocks: fenced code preserved verbatim', parseMarkdownBlocks('```js\nconst x = 1;\n  y();\n```')[0],
  { type: 'code', lang: 'js', text: 'const x = 1;\n  y();' });
check('parseMarkdownBlocks: multiple blocks', parseMarkdownBlocks('# Title\n\nBody text\n\n- a\n- b').map((b) => b.type),
  ['heading', 'paragraph', 'list']);

// ---- Markdown: beautify ----
check('beautifyMarkdown: normalizes heading spacing', beautifyMarkdown('#Title'), '# Title\n');
check('beautifyMarkdown: normalizes bullet markers', beautifyMarkdown('* a\n+ b\n- c'), '- a\n- b\n- c\n');
check('beautifyMarkdown: collapses extra blank lines', beautifyMarkdown('# A\n\n\n\nBody'), '# A\n\nBody\n');
check('beautifyMarkdown: normalizes hr variants', beautifyMarkdown('***'), '---\n');
check('beautifyMarkdown: preserves fenced code verbatim', beautifyMarkdown('```\n  x = 1\n```'), '```\n  x = 1\n```\n');

// ---- Markdown: sectioning ----
const sections = groupSections(parseMarkdownBlocks('# A\n\nintro\n\n## B\n\nbody'));
check('groupSections: builds heading paths', sections.map((s) => s.path), [['A'], ['A', 'B']]);

// ---- Markdown: smart diff ----
check('diffMarkdown: no differences', diffMarkdown('# A\n\ntext', '# A\n\ntext'), []);

const listDiff = diffMarkdown('# A\n\n- a\n- b', '# A\n\n- a\n- b\n- c');
check('diffMarkdown: list addition is reported as an item, not a text rewrite', listDiff,
  [{ kind: 'section-changed', path: 'A', changes: [{ kind: 'list-changed', blockType: 'list', added: ['c'], removed: [] }] }]);

const sectionAdded = diffMarkdown('# A\n\ntext', '# A\n\ntext\n\n## B\n\nnew section');
check('diffMarkdown: added subsection', sectionAdded, [{ kind: 'section-added', path: 'A › B' }]);

const sectionRemoved = diffMarkdown('# A\n\n## B\n\ngone', '# A');
check('diffMarkdown: removed subsection', sectionRemoved, [{ kind: 'section-removed', path: 'A › B' }]);

const paraChange = diffMarkdown('# A\n\nthe quick fox', '# A\n\nthe slow fox');
check('diffMarkdown: paragraph change kind', paraChange[0].changes[0].kind, 'text-changed');
check('diffMarkdown: paragraph change captures word diff', paraChange[0].changes[0].words.some((op) => op.type === 'remove' && op.a === 'quick'), true);
check('diffMarkdown: paragraph change captures word diff (add)', paraChange[0].changes[0].words.some((op) => op.type === 'add' && op.b === 'slow'), true);

const headingRename = diffMarkdown('# A\n\ntext', '# A Renamed\n\ntext');
check('diffMarkdown: heading text change reported once', headingRename,
  [{ kind: 'section-changed', path: 'A', changes: [{ kind: 'text-changed', blockType: 'heading', before: 'A', after: 'A Renamed' }] }]);

check('summarizeMarkdownDiff', summarizeMarkdownDiff(listDiff), { added: 1, removed: 0, changed: 0, total: 1 });
check('markdownDiffReport: no differences', markdownDiffReport([]), 'No differences.\n');
check('markdownDiffReport: mentions section path', markdownDiffReport(sectionAdded).includes('A › B'), true);

check('beautifyMarkdown: renumbers ordered lists from 1', beautifyMarkdown('5. a\n7. b\n9. c'), '1. a\n2. b\n3. c\n');

const codeDiff = diffMarkdown('# A\n\n```js\nx = 1\n```', '# A\n\n```js\nx = 2\n```');
check('diffMarkdown: fenced code changes are reported, not silently ignored', codeDiff[0].changes[0].blockType, 'code');

check('diffMarkdown: code fence content never touched by word diff', diffMarkdown('# A\n\n```\nsame\n```', '# A\n\n```\nsame\n```'), []);

console.log(`${pass + failures.length} assertions, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
