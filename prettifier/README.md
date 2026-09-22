# Djaunt Prettifier

A Chrome & Firefox extension (Manifest V3) that beautifies JSON and Markdown and runs a
structural comparison between two versions of either — with no host permissions at all.

It's built to replace pasting text into a random online "JSON diff" or "beautify" site: those
send whatever you paste to someone else's server, which is a bad habit for anything that might
contain a real API response, a config file, or an internal doc. Everything here runs in the
popup, on your machine, and nothing leaves it.

## Install

**Chrome:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension so the toolbar button is visible.

**Firefox** (121+, for this manifest's dual background key):

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select this folder's `manifest.json`.

This load is temporary — Firefox drops it on restart, so reload it the same way after a
`git pull`. For a load that survives restarts, package the folder with
[`web-ext`](https://github.com/mozilla/web-ext) and sign it, or run it in a channel that
allows unsigned extensions (Nightly/ESR with `xpinstall.signatures.required` off in
`about:config`).

## Use

Click the toolbar icon, pick **JSON** or **Markdown**, then pick a tab:

- **Beautify.** Paste into Input; the formatted result appears in Result as you type. JSON
  gets a 2- or 4-space indent (your choice); Markdown gets consistent heading spacing, a
  single bullet marker, renumbered ordered lists, normalized horizontal rules, and collapsed
  blank lines — fenced code blocks are left untouched either way. **Copy** or **Download** the
  result.
- **Compare.** Paste the original into A and the changed version into B (or click the swap
  button to flip them). Differences appear live below:
  - **JSON** is diffed structurally, by parsed value, not by text — reordering an object's
    keys or reformatting its whitespace produces no diff at all. Each entry names the exact
    property path (`user.address.city`, `tags[2]`) and whether it was added, removed, changed,
    or changed type.
  - **Markdown** is diffed by document structure: headings group the document into sections,
    and each section's paragraphs, lists, quotes and code blocks are compared individually. An
    unchanged heading with one new bullet reads as "1 item added to this list," not as a
    rewritten paragraph; a changed sentence shows which words were added or removed, not just
    that the line differs.

  **Download report** saves the same differences as a plain-text file.

## How it works

- **`diff.js`** is a small longest-common-subsequence algorithm shared by both formats — the
  same primitive that finds the minimal add/remove set between two arrays, whether those
  arrays are object keys, Markdown blocks, list items, or words in a sentence.
- **`json-tool.js`** parses and re-serializes with `JSON.parse`/`JSON.stringify`, and walks two
  parsed values recursively to build the structural diff (`diffJson`). A parse error is
  reported with the line and column it occurred at, when the engine's own error message
  provides one.
- **`markdown-tool.js`** parses Markdown into typed blocks (heading, paragraph, list, code
  fence, blockquote, horizontal rule) with `parseMarkdownBlocks`, groups them under their
  nearest heading with `groupSections`, and diffs matching sections' blocks with `diffMarkdown`
  — including a word-level diff for changed paragraphs and an item-level diff for changed
  lists, both built on `diff.js`.
- **Nothing is sent anywhere.** The manifest requests only `storage` (to remember what you last
  typed between popup opens) — no `host_permissions`, no content script, no network call.
  Download uses a `Blob` URL and an anchor's `download` attribute, not the `downloads` API.

## Limits

- **This is a heuristic comparator, not a Markdown renderer.** It understands ATX headings
  (`#`/`##`), bullet and numbered lists, fenced code, blockquotes, horizontal rules and
  paragraphs — not tables, nested lists, footnotes, or inline HTML. Anything else is treated as
  a plain paragraph.
- **Section matching is by heading text**, and a renamed heading is detected as a rename only
  when it sits at the same depth under the same parent as before; anything more drastic (a
  section moved to a different parent, or two unrelated same-depth sections swapping position)
  shows as a remove and an add instead.
- **List-item and paragraph matching is by content, not position** — reordering a list's items
  or a document's paragraphs can show fewer changes than you'd expect from a plain text diff,
  since the comparator is finding the smallest edit that explains the difference, not comparing
  line-by-line.
- Very large inputs (many thousands of lines) will diff slowly — the LCS algorithm is
  quadratic in the number of compared items. It's sized for pasting a response body or a
  document, not a whole repository.

## Permissions

`storage` only. No `host_permissions`, no `<all_urls>`, no content scripts, no background
script — the whole extension runs inside the popup.

## Tests

`test.mjs` covers `diff.js`, `json-tool.js` and `markdown-tool.js`: LCS behavior, JSON
beautify/minify/parse-error reporting, structural JSON diffing, Markdown block parsing,
beautification, sectioning, and the section/list/paragraph-level Markdown diff.

```
node test.mjs
```

No test runner needed — it exits non-zero on failure.
