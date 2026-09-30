// Markdown → HTML for the live preview. CommonMark + GFM (tables, strikethrough, autolinks,
// task lists) via the vendored markdown-it, configured so the output is safe to assign to
// innerHTML and never makes a network request on its own:
//   - raw HTML in the source is escaped, not passed through (`html: false`);
//   - markdown-it's own link validator already refuses javascript:, vbscript: and file: URLs;
//   - images are never loaded — a remote <img> would phone home the moment you paste a doc
//     with a tracking pixel — so they render as a labelled link instead (inline data:image
//     URLs are the one exception, since they carry their own bytes).
import markdownit from './vendor/markdown-it.esm.min.js';

const md = markdownit({ html: false, linkify: true, typographer: false, breaks: false });

// GitHub-style heading slug, prefixed so a heading can never collide with the popup's own ids.
export const HEADING_ID_PREFIX = 'md-';

export function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

// ---- heading ids ----

md.core.ruler.push('heading_ids', (state) => {
  const seen = new Map();
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'heading_open') continue;
    const text = tokens[i + 1].children
      .filter((child) => child.type === 'text' || child.type === 'code_inline')
      .map((child) => child.content)
      .join('');
    const base = slugify(text) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    tokens[i].attrSet('id', HEADING_ID_PREFIX + (count ? `${base}-${count}` : base));
  }
});

// ---- task lists: "- [ ] todo" / "- [x] done" ----

md.core.ruler.after('inline', 'task_lists', (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'inline' || tokens[i - 1].type !== 'paragraph_open'
        || tokens[i - 2].type !== 'list_item_open') continue;
    const first = tokens[i].children[0];
    const match = first && first.type === 'text' && /^\[([ xX])\]\s+/.exec(first.content);
    if (!match) continue;

    first.content = first.content.slice(match[0].length);
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" class="md-task" disabled${match[1] === ' ' ? '' : ' checked'}> `;
    tokens[i].children.unshift(box);

    tokens[i - 2].attrJoin('class', 'md-task-item');
    for (let j = i - 3; j >= 0; j -= 1) {
      if (tokens[j].type === 'bullet_list_open' || tokens[j].type === 'ordered_list_open') {
        if (tokens[j].level === tokens[i - 2].level - 1) {
          if (!(tokens[j].attrGet('class') || '').includes('md-task-list')) {
            tokens[j].attrJoin('class', 'md-task-list');
          }
          break;
        }
      }
    }
  }
});

// ---- links open in a new tab; in-page anchors are handled by the popup ----

const defaultLinkOpen = md.renderer.rules.link_open
  || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (!href.startsWith('#')) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// ---- images ----

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet('src') || '';
  const alt = self.renderInlineAsText(token.children, options, env);
  if (/^data:image\//i.test(src)) {
    return `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}">`;
  }
  return `<a class="md-image-blocked" href="${md.utils.escapeHtml(src)}" target="_blank" `
    + `rel="noopener noreferrer" title="Images aren't loaded, to keep this preview offline — click to open it">`
    + `[image${alt ? `: ${md.utils.escapeHtml(alt)}` : ''}]</a>`;
};

// ---- tables scroll sideways instead of stretching the panel ----

md.renderer.rules.table_open = () => '<div class="md-table-wrap"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

export function renderMarkdown(text) {
  return md.render(text);
}
