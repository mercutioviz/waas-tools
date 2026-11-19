# CLAUDE.md — WaaS Portal Helper

Extension-specific notes. The repo-wide rules in the root
[CLAUDE.md](../../CLAUDE.md) still apply.

## The constraint that shapes this extension

**The WaaS portal is behind SSO, so its DOM is not visible from here.** Never
write code against a guessed CSS selector and present it as working.

Everything shipped so far holds to this:

- The deep-link feature uses only `location.href` and `document.title`.
- The account banner matches on **user-written** rules, not inferred ones.
- The inspector exists precisely to discover real selectors.
- The dialog dismisser works off a user-editable selector list. Its one shipped
  default was read off the live DOM, not guessed — see below.

If a new feature genuinely needs portal markup, the honest sequence is: ask the
user to find the selector with the inspector, then build on what they report.

For portal **data** rather than markup, there's now a second route: API capture
(`features/api-capture.js`) logs the portal's own API calls with values
redacted, so the user can hand back a response shape that's safe to paste. Ask
for a capture before designing against a guessed payload.

## Portal markup verified from the live DOM

Everything here was read off a logged-in session. Treat anything *not* in this
list as unknown.

| | |
|---|---|
| App root | `#root` — gets `aria-hidden="true"` while a modal is open |
| UI framework | MUI v5. Emotion classes (`css-19bfmdu`) rehash every release — **never** match on them. `data-testid` attributes are stable. |
| Modals | Portaled as a **direct child of `<body>`**, outside `#root` |
| Scroll lock | MUI sets `<body style="overflow: hidden">` while a modal is open and removes it on close |
| FUP dialog | Root `[data-testid="fup-violation-dialog"]`; buttons `fup-dialog-close-icon`, `fup-dialog-close-button`, `fup-dialog-view-reports` |
| Endpoint grid cell | Renders `<hostname> (N of M Domains)`. Matched on that **text**, not a selector — see `lib/endpoints.js`. |

## Portal API verified from a live capture

Read off a capture of a logged-in session. Same rule as the markup table:
anything not listed is unknown.

| | |
|---|---|
| Auth | Portal → API calls carry `credentials: include` and no `auth-api` header. The session is **cookie-based**; the REST token in [docs/waas-api-notes.md](../../docs/waas-api-notes.md) is a separate thing the extension never needs. |
| Endpoint list | `GET /v2/waasapi/applications/{id}/endpoints/?searchPhrase=` → `{count, next, previous, results[]}` |
| Endpoint record | `{id, protocol, cname, dps_service: {port, domains[], …}, managed_service: {name, …}, …}` — **`dps_service.domains` holds every domain**, which is what makes the hover card possible. |
| Same data, nested | `GET /v2/waasapi/applications/{id}/` carries the same endpoint records. |
| Plan limits | `licensed_features: {endpoint, endpoint_domain, origin_server, sni_certificate, …}` on the application response. |
| Routing by name | Some v4 calls put the **application name** in the path: `/v4/waasapi/applications/Customer%20App%2001/cdn/`. Mind this when redacting a URL. |

Two consequences worth remembering:

- **Never remove a dialog node.** It lives in a React portal container; tearing
  it out produces a `removeChild` crash later. Click its close button and let
  MUI unmount it.
- **Hiding a modal is not closing it.** CSS alone leaves the scroll lock and
  `aria-hidden` in place forever, because MUI only reverses them on close.

## Architecture

A feature module in `src/features/` exports `id` plus any of:

| Export | Called |
|---|---|
| `apply(settings)` | At startup and on **every** settings change |
| `onCommand(command, settings)` | When a keyboard command fires |
| `onLocationChange(href, settings)` | On SPA navigation |

`apply` must be **idempotent** and must tear down its own DOM and listeners when
its feature flag is off — it runs repeatedly, not once.

`src/content/boot.js` wires these up and isolates failures, so one broken
feature can't take down the others. Register new features in its `FEATURES`
array.

## The page-world tap

`src/content/api-tap.js` is the one file that doesn't follow the rules above,
and the reasons are worth knowing before touching it:

| | |
|---|---|
| Runs in the **MAIN world** | The isolated world has its own `fetch`; it cannot observe the page's calls at all. Needs `"world": "MAIN"` in the manifest, which is why `minimum_chrome_version` is **111**. |
| Runs at **document_start** | The portal's first API calls land long before `document_idle`, when `content.js` boots. |
| Has **no `chrome.*`** | No storage, so it can't read settings and can't decide whether to be on. It buffers unconditionally and only sends anything when a client asks. |
| **No imports** | Same constraint as `content.js` — a classic IIFE. Keep logic out of it; `lib/api-shape.js` is where interpretation belongs. |

Consequences:

- **Entries from the tap are unredacted.** They're the page's own data. Anything
  that displays, logs, or copies one must go through `lib/api-shape.js` first.
- **Go through `lib/tap-client.js`.** A new feature needing API data subscribes;
  it does not patch `fetch` a second time.
- **A reloaded extension has no tap in open tabs.** Content scripts inject on
  navigation only, so the client has a handshake timeout and tells the user to
  reload rather than sitting there silently.
- **The redaction word lists are a safety mechanism, not configuration.**
  Widening `SAFE_WORDS` or `COUNT_WORDS` in `lib/api-shape.js` lets more real
  values reach a clipboard. Raise it with the user; don't do it to make output
  prettier.

## MV3 gotchas that bite here

- **Content scripts can't be ES modules.** `content.js` is a classic script that
  dynamically imports `boot.js`. Anything reachable from `boot.js` must be
  listed in `web_accessible_resources` in the manifest — add new `src/`
  subdirectories there or the import fails at runtime with an opaque error.
- **No inline scripts or handlers** in `popup.html` / `options.html`. Extension
  CSP blocks them. Use `<script src="..." type="module">`.
- **The service worker is not persistent.** Keep it stateless; it only relays
  commands. Don't cache anything in a module-level variable there.
- **Clipboard needs a fallback.** `navigator.clipboard.writeText` can reject
  when invoked from a keyboard command (no transient user activation), so
  `lib/dom.js` falls back to `execCommand`. Use `copyText()`, not the raw API.
- **No `tabs` permission.** `chrome.tabs.query` still returns tab *ids* without
  it, which is all the popup and service worker need. Don't add the permission
  to get `url`/`title` — ask the content script instead.

## Conventions

- All injected CSS lives in `src/content/content.css`, every class prefixed
  `wph-`, with `!important` on anything the portal might override. **One
  exception:** `features/dialog-dismisser.js` generates a `<style>` element at
  runtime, because its selectors come from user settings and can't be known
  ahead of time. Selectors are screened by `isSafeSelector()` before being
  interpolated, and emitted one rule each so a bad entry can't take out the set.
- The banner attaches to `document.documentElement`, not `body`, so a SPA
  re-render of the page body can't remove it.
- Never `innerHTML` anything derived from page content or user settings — the
  inspector escapes values, the banner uses `textContent`.
- Permissions stay minimal. Adding one is a decision to raise with the user.

## Verification

Run the logic tests after touching `lib/rules.js`, `lib/portal.js`,
`lib/dialogs.js`, `lib/api-shape.js`, `features/deep-link.js`, or the contrast
helper:

```bash
ELECTRON_RUN_AS_NODE=1 "$LOCALAPPDATA/Programs/Microsoft VS Code/Code.exe" test/logic.test.mjs
```

(Node isn't installed on this machine; VS Code bundles one. See the README.)

Anything touching the DOM, `chrome.*` APIs, popup, or options page can only be
verified by loading the extension and using it. Say plainly which parts you
tested and which you handed off.

## Reload workflow

| Changed | Needed |
|---|---|
| content script / feature / CSS | Reload on `chrome://extensions`, then refresh the page |
| service worker | Reload on `chrome://extensions` |
| popup / options | Just reopen them |
| manifest.json | Reload, and re-check for new warnings |
