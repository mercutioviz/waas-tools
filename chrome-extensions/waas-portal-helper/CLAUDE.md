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
`lib/dialogs.js`, `features/deep-link.js`, or the contrast helper:

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
