# Net Mock — API

The extension puts a `window.djauntMock` object on every page. It is how an agent
drives Net Mock: one `page.evaluate`, a console paste, or a line in a test harness —
no popup interaction, no clicking.

Every method returns a promise. Errors reject with the same message the popup shows.

```js
await djauntMock.add({
  url: '*/api/students/*',
  method: 'GET',
  json: { name: 'Test' },
  delayMs: 250,
});
```

That rule is live immediately, on every tab, and survives a browser restart until you
remove it.

## Methods

| Call | Does |
|---|---|
| `djauntMock.ready` | Promise that settles once the rule snapshot has loaded. |
| `add(rule)` | Appends one rule and returns it, with its generated `id`. Defaults to `enabled: true`. |
| `list()` | Every stored rule, in priority order. |
| `update(id, patch)` | Merges `patch` into the rule and returns the result. |
| `enable(id, enabled = true)` | Toggles one rule. |
| `remove(id)` | Deletes one rule and returns it. |
| `set(rules)` | Replaces the whole list. |
| `clear()` | Deletes every rule. |
| `import(json, { replace = true })` | Loads a ruleset. `replace: false` appends instead. |
| `export()` | The whole ruleset as a JSON string. |
| `log({ limit })` | Recent interception decisions, oldest first. |
| `clearLog()` | Empties the match log. |
| `active()` | The snapshot this page is actually running, for debugging a rule that will not fire. |

## Rule shape

Rules are stored in a nested canonical form:

```json
{
  "id": "6f1c…",
  "enabled": true,
  "label": "students 200",
  "match": {
    "url": "*/api/students/*",
    "method": "GET"
  },
  "respond": {
    "mode": "mock",
    "status": 200,
    "headers": { "content-type": "application/json" },
    "body": "{\"name\":\"Test\"}",
    "delayMs": 0
  },
  "times": 0
}
```

Anything that accepts a rule also accepts the flat shorthand, which is what you will
usually type:

```js
{ url: '*/api/x', method: 'GET', status: 503, json: { error: 'nope' }, delayMs: 100 }
```

`url`, `method` fold into `match`. `mode`, `status`, `headers`, `body`, `json`,
`delayMs` fold into `respond`. `label`, `enabled`, `times` stay where they are.

### Fields

| Field | Meaning |
|---|---|
| `match.url` | Required. A glob where `*` matches any run of characters, including `/`. Anchored at both ends and compared against the **full absolute URL**, so a relative `fetch('/api/x')` is resolved first. Prefix with `re:` for a regular expression. |
| `match.method` | `GET`, `POST`, … or `*` for any. Case-insensitive. |
| `respond.mode` | `mock` returns the response below. `fail` rejects the way a dropped connection does. `passthrough` lets the request go, which is how you carve an exception out of a broader rule below it. |
| `respond.status` | 200–599. |
| `respond.headers` | An object, or `Name: value` lines. |
| `respond.body` | A string. Use `json` instead to have an object serialised and the content type set for you. |
| `respond.delayMs` | Holds the response back, up to 600000. |
| `times` | How many matches before the rule stops firing, counted **per page load**. `0` means unlimited. |

**First match wins.** List order is priority: a `passthrough` rule above a broad mock
rule exempts whatever it matches.

## Match log

`log()` returns what the interceptor decided, so a rule that will not fire is
debuggable without guessing:

```js
await djauntMock.log({ limit: 20 });
// [{ time, page, url, method, ruleId, label, action, status }, …]
```

`action` is one of:

| Value | Meaning |
|---|---|
| `mocked` | Answered from the rule. |
| `failed` | Rejected by a `fail` rule. |
| `passed` | Went to the network — either nothing matched, or a `passthrough` rule did. |
| `skipped` | A rule matched but could not be applied. Today that only happens on a synchronous `XMLHttpRequest`. |

The log is a ring buffer of the last 500 entries and lives only for the browser
session.

## Ruleset files

`export()` and the popup's Export button both produce:

```json
{ "rules": [ … ] }
```

`import()` and the popup's Import button accept that, or a bare array. An import is
all-or-nothing: if any rule is invalid the whole import is refused, naming the rule
and the problem.

## What it cannot intercept

- Subresource loads — `<img>`, `<script>`, stylesheets, fonts. Only `fetch` and
  `XMLHttpRequest` are patched.
- Requests made from the site's **own** service worker, which runs in a separate
  context this extension does not enter.
- Synchronous `XMLHttpRequest`, which cannot wait for the rule snapshot. These are
  logged as `skipped` and go to the network.
- WebSocket traffic. Planned, not in this version.

The interceptor shares the page's world, so the page can replace `fetch` right back.
This is a development tool, not a security boundary.
