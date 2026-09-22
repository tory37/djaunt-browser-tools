import { diffArrays } from './diff.js';

const HEADING_RE = /^(#{1,6})\s*(.*)$/;
const HR_RE = /^([-*_])(?:\s*\1){2,}\s*$/;
const UL_RE = /^(\s*)([-*+])\s+(.*)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const FENCE_RE = /^(`{3,}|~{3,})/;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;

/**
 * Splits Markdown source into typed blocks (heading/paragraph/list/code/hr/
 * blockquote). Fenced code is captured verbatim and never re-flowed by
 * anything downstream — beautify and diff both treat it as opaque text.
 */
export function parseMarkdownBlocks(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i += 1; continue; }

    const fenceMatch = FENCE_RE.exec(line.trim());
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const lang = line.trim().slice(fenceMatch[1].length).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^${fenceChar}{3,}\\s*$`).test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    if (HR_RE.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (line.trim().startsWith('>')) {
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        body.push(BLOCKQUOTE_RE.exec(lines[i])[1]);
        i += 1;
      }
      blocks.push({ type: 'blockquote', text: body.join(' ').replace(/\s+/g, ' ').trim() });
      continue;
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line);
      const items = [];
      while (i < lines.length && lines[i].trim() !== '') {
        const m = ordered ? OL_RE.exec(lines[i]) : UL_RE.exec(lines[i]);
        if (!m) break;
        items.push(m[3].trim());
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length && lines[i].trim() !== ''
      && !HEADING_RE.test(lines[i]) && !HR_RE.test(lines[i].trim())
      && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i])
      && !FENCE_RE.test(lines[i].trim()) && !lines[i].trim().startsWith('>')
    ) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ').replace(/\s+/g, ' ').trim() });
  }

  return blocks;
}

/** Deterministically re-serializes normalized blocks: consistent markers, one blank line between blocks. */
export function beautifyMarkdown(text) {
  const blocks = parseMarkdownBlocks(text);
  const parts = blocks.map((block) => {
    if (block.type === 'heading') return `${'#'.repeat(block.level)} ${block.text}`;
    if (block.type === 'hr') return '---';
    if (block.type === 'blockquote') return `> ${block.text}`;
    if (block.type === 'code') return `\`\`\`${block.lang}\n${block.text}\n\`\`\``;
    if (block.type === 'list') {
      return block.items
        .map((item, index) => (block.ordered ? `${index + 1}. ${item}` : `- ${item}`))
        .join('\n');
    }
    return block.text;
  });
  return `${parts.join('\n\n')}\n`;
}

/** Groups blocks under the nearest heading path so diffs read section by section. */
export function groupSections(blocks) {
  const stack = [];
  const sections = [{ path: [], headingBlock: null, blocks: [] }];
  let current = sections[0];

  for (const block of blocks) {
    if (block.type === 'heading') {
      while (stack.length && stack[stack.length - 1].level >= block.level) stack.pop();
      stack.push({ level: block.level, text: block.text });
      current = { path: stack.map((s) => s.text), headingBlock: block, blocks: [block] };
      sections.push(current);
    } else {
      current.blocks.push(block);
    }
  }

  return sections.filter((s) => s.blocks.length > 0);
}

const SEP = ' › '; // "›"

function sectionKey(section) {
  return section.path.join(SEP) || '(intro)';
}

function blockMatchKey(block) {
  if (block.type === 'heading') return `heading:${block.level}`;
  if (block.type === 'list') return `list:${block.ordered ? 'ol' : 'ul'}`;
  return block.type;
}

function diffWords(a, b) {
  const wa = a.split(/\s+/).filter(Boolean);
  const wb = b.split(/\s+/).filter(Boolean);
  return diffArrays(wa, wb);
}

/** Content-level diff for a matched pair of same-kind blocks; null if unchanged. */
function diffBlockContent(a, b) {
  if (a.type === 'hr') return null;
  if (a.type === 'heading') {
    return a.text === b.text ? null : { kind: 'text-changed', blockType: 'heading', before: a.text, after: b.text };
  }
  if (a.type === 'blockquote' || a.type === 'paragraph') {
    if (a.text === b.text) return null;
    return { kind: 'text-changed', blockType: a.type, before: a.text, after: b.text, words: diffWords(a.text, b.text) };
  }
  if (a.type === 'code') {
    if (a.text === b.text && a.lang === b.lang) return null;
    return { kind: 'text-changed', blockType: 'code', before: a.text, after: b.text, lang: b.lang };
  }
  if (a.type === 'list') {
    const itemOps = diffArrays(a.items, b.items);
    const added = itemOps.filter((op) => op.type === 'add').map((op) => op.b);
    const removed = itemOps.filter((op) => op.type === 'remove').map((op) => op.a);
    if (!added.length && !removed.length) return null;
    return { kind: 'list-changed', blockType: 'list', added, removed };
  }
  return null;
}

function diffSectionBlocks(blocksA, blocksB) {
  const ops = diffArrays(blocksA, blocksB, (x, y) => blockMatchKey(x) === blockMatchKey(y));
  const entries = [];
  for (const op of ops) {
    if (op.type === 'add') { entries.push({ kind: 'block-added', blockType: op.b.type, block: op.b }); continue; }
    if (op.type === 'remove') { entries.push({ kind: 'block-removed', blockType: op.a.type, block: op.a }); continue; }
    const change = diffBlockContent(op.a, op.b);
    if (change) entries.push(change);
  }
  return entries;
}

/**
 * Section-aware Markdown diff: matches documents by heading path, then diffs
 * the blocks (paragraphs, lists, code, quotes) inside each matched section.
 * Not a string/line diff — a list added under an unchanged heading reads as
 * "2 items added to this list", not as N changed lines.
 */
function parentKey(path) {
  return path.slice(0, -1).join(SEP);
}

function sectionBodyChanges(a, b) {
  const blocksA = a.blocks.filter((block) => block !== a.headingBlock);
  const blocksB = b.blocks.filter((block) => block !== b.headingBlock);
  return diffSectionBlocks(blocksA, blocksB);
}

export function diffMarkdown(textA, textB) {
  const sectionsA = groupSections(parseMarkdownBlocks(textA));
  const sectionsB = groupSections(parseMarkdownBlocks(textB));
  const ops = diffArrays(sectionsA, sectionsB, (a, b) => sectionKey(a) === sectionKey(b));

  const result = [];
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    const next = ops[i + 1];

    // A remove immediately followed by an add at the same depth and the same
    // parent heading reads as a renamed section, not an unrelated swap.
    if (
      op.type === 'remove' && next && next.type === 'add'
      && op.a.path.length === next.b.path.length && parentKey(op.a.path) === parentKey(next.b.path)
    ) {
      const changes = sectionBodyChanges(op.a, next.b);
      changes.unshift({
        kind: 'text-changed',
        blockType: 'heading',
        before: op.a.headingBlock ? op.a.headingBlock.text : '',
        after: next.b.headingBlock ? next.b.headingBlock.text : '',
      });
      result.push({ kind: 'section-changed', path: sectionKey(op.a), changes });
      i += 1;
      continue;
    }

    if (op.type === 'add') { result.push({ kind: 'section-added', path: sectionKey(op.b) }); continue; }
    if (op.type === 'remove') { result.push({ kind: 'section-removed', path: sectionKey(op.a) }); continue; }

    const changes = sectionBodyChanges(op.a, op.b);
    if (changes.length) result.push({ kind: 'section-changed', path: sectionKey(op.a), changes });
  }
  return result;
}

export function summarizeMarkdownDiff(sections) {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const section of sections) {
    if (section.kind === 'section-added') { added += 1; continue; }
    if (section.kind === 'section-removed') { removed += 1; continue; }
    for (const change of section.changes) {
      if (change.kind === 'block-added') added += 1;
      else if (change.kind === 'block-removed') removed += 1;
      else if (change.kind === 'list-changed') { added += change.added.length; removed += change.removed.length; }
      else changed += 1;
    }
  }
  return { added, removed, changed, total: added + removed + changed };
}

function describeBlock(block) {
  if (block.type === 'heading') return `${'#'.repeat(block.level)} ${block.text}`;
  if (block.type === 'list') return block.items.map((item) => `  - ${item}`).join('\n');
  if (block.type === 'code') return `[code${block.lang ? `:${block.lang}` : ''}]`;
  if (block.type === 'hr') return '---';
  return block.text;
}

export function markdownDiffReport(sections) {
  if (!sections.length) return 'No differences.\n';
  const lines = [];
  for (const section of sections) {
    lines.push(`## ${section.path}`);
    if (section.kind === 'section-added') { lines.push('+ section added'); lines.push(''); continue; }
    if (section.kind === 'section-removed') { lines.push('- section removed'); lines.push(''); continue; }
    for (const change of section.changes) {
      if (change.kind === 'block-added') lines.push(`+ ${describeBlock(change.block)}`);
      else if (change.kind === 'block-removed') lines.push(`- ${describeBlock(change.block)}`);
      else if (change.kind === 'list-changed') {
        for (const item of change.added) lines.push(`  + ${item}`);
        for (const item of change.removed) lines.push(`  - ${item}`);
      } else {
        lines.push(`~ ${change.blockType}: "${change.before}" -> "${change.after}"`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}
