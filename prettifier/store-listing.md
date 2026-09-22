# Chrome Web Store listing — Djaunt Prettifier

Copy-paste source for the Developer Dashboard forms. Keep this in sync with
`README.md` and its `index.html` card when either changes.

## Store listing tab

- **Title**: Djaunt Prettifier
- **Summary** (132 char max): Beautify JSON and Markdown, and see a structural diff between two versions — no host permissions, nothing sent anywhere.
- **Category**: Developer Tools
- **Language**: English (United States)
- **Description**:

  Beautifies JSON and Markdown, and runs a structural comparison between two versions of
  either — right in the popup, with no host permissions and no network calls.

  Paste JSON to reformat it with a chosen indent, or paste Markdown to get consistent heading
  spacing, bullet markers and blank lines, without touching fenced code blocks. Paste an
  original and a changed version into Compare and get a real diff, not a wall of red and
  green text: JSON is compared by parsed property — which key was added, removed or changed,
  and its exact path — and Markdown is compared section by section, calling out which
  paragraphs, bullets and code blocks actually changed.

  - Structural JSON diff: reformatting or reordering keys produces no noise, only real
    changes.
  - Section-aware Markdown diff: changes are grouped under the heading they belong to, with
    word-level highlighting for changed sentences and item-level diffing for changed lists.
  - Download the beautified result or the diff report as a file.
  - No account, no network calls, no data collection. Source and full docs:
    https://github.com/tory37/djaunt-browser-tools/tree/main/prettifier

- **Icon**: `icons/icon128.png`
- **Screenshot(s)**: `store-assets/popup.png` (run `npm run store:screenshots`
  to generate).

## Privacy practices tab

- **Single purpose**: Beautifies and structurally compares JSON and Markdown text the user
  pastes into the popup.
- **Permission justifications**:
  - `storage` — saves the user's current input and settings locally so they persist across
    popup closes.
- **Are you using remote code?** No.
- **Data usage**: This item does not collect user data.
- **Privacy policy URL**: https://tory37.github.io/djaunt-browser-tools/privacy.html
