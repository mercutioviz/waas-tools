# WaaS Portal Helper

A Manifest V3 Chrome extension that adds quality-of-life features to the
Barracuda WAF-as-a-Service portal (`waas.barracudanetworks.com`).

No build step, no dependencies, no network requests.

## Features

| Feature | Shortcut | What it does |
|---|---|---|
| **Account banner** | — | Paints a colored strip across the top of the portal naming the tenant you're in, so a change never lands in the wrong customer's account. |
| **Copy deep link** | `Alt+Shift+C` | Copies the current page's title and URL, ready to paste into a ticket or chat. |
| **DOM inspector** | `Alt+Shift+I` | Hover to see a redeploy-resistant CSS selector for any element, click to copy it. Esc exits. |
| **Dismiss dialogs** | — | Closes listed popups as they appear, before they paint. Ships configured for the Fair Usage Policy modal that returns on every page load. |
| **Endpoint domains** | — | Hover the domain cell in an endpoints grid to see every domain on that endpoint, not just the first. Copy the lot with one click. |
| **API capture** | — | Logs the portal's own API calls with their response *shape* — key names kept, values redacted. For working out what an endpoint returns without putting customer data on a clipboard. Off by default. |

Each can be toggled from the toolbar popup.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this directory
   (`chrome-extensions/waas-portal-helper`)

> **OneDrive note.** This repo lives in a synced folder. If Chrome reports
> missing or empty files, right-click the extension folder → **Always keep on
> this device**, then hit Reload on the extension card. OneDrive's Files
> On-Demand can otherwise leave placeholder stubs where Chrome expects content.

If the keyboard shortcuts do nothing, another extension probably claimed them —
check `chrome://extensions/shortcuts` (the popup links straight there).

## Setting up the account banner

The banner is the reason this extension exists, but **it shows nothing until you
write a rule.** That's deliberate: the extension ships with no knowledge of the
portal's internal markup, so it doesn't guess at how your accounts are
identified.

Two ways to write a rule, in the options page (popup → *Banner rules & settings*):

### URL match

A regular expression tested against the full page URL. Use this when an account
identifier shows up in the address bar.

| Field | Example |
|---|---|
| Match type | URL match |
| Pattern | `/accounts/4821\b` |
| Label | `ACME CORP — PRODUCTION` |
| Color | dark red |

The popup tells you which identifier-shaped values it can see in the current
URL, which is a good starting point for writing the pattern.

### Element text

A CSS selector whose text names the account. Use this when the account name
appears on the page but not in the URL.

1. Open the portal and press `Alt+Shift+I`
2. Click the element showing the account name — its selector is copied
3. Paste it into the rule's selector field

Leave the label blank to display that element's text verbatim, or use `$0` for
the whole text and `$1`–`$9` for capture groups from the optional extraction
regex. For example, selector `.account-name`, extraction regex `\((\w+)\)`, and
label `$1 ENVIRONMENT`.

### Ordering

Rules are evaluated top to bottom and the first match wins, so put specific
rules above general ones. A catch-all like `waas\.barracudanetworks\.com` at the
bottom in a neutral color is a reasonable safety net.

## Dismissing dialogs

The portal pops a **Fair Usage Policy Limit Exceeded** modal on every fresh load
of the applications page, with no "don't show again" option. The dismiss feature
removes it, and the options page takes a list of any other dialogs you want gone
— one CSS selector per line, each matching a dialog's outermost element.

It works in two steps, and both matter:

1. A generated stylesheet hides the listed dialogs, so nothing flashes on screen.
2. The dialog's **own close button** is clicked, so the portal runs its normal
   teardown.

Step 2 is not optional. While a dialog is open the portal locks page scrolling
(`body { overflow: hidden }`) and hides the app from screen readers, and it only
undoes that when the dialog closes. Hiding a dialog without closing it would
leave the page permanently unscrollable. The extension never deletes the dialog
element — it belongs to a React portal, and removing it out from under React
causes a crash later in the page's life.

To add a dialog: press `Alt+Shift+I`, click the dialog's outer edge to copy its
selector, and paste it into the list. Prefer a `data-testid` where one exists —
the portal's other class names (`css-19bfmdu` and similar) are build hashes that
change on every release.

> The FUP dialog reports a real account condition. Suppressing it means you
> won't be told when that condition changes.

## Endpoint domains

An endpoint can carry many domains, but the grid shows one and a count:

```
marketing.example.com (7 of 30 Domains)
```

Seeing the other six normally means opening the endpoint for editing. Hover that
cell instead and a card lists all of them, with the one the grid was already
showing highlighted. **Copy all** puts the list on the clipboard, one per line.

The card opens after a short delay, and stays while the pointer is on either the
cell or the card, so you can select text out of it. Leave both, or press
<kbd>Esc</kbd>, to dismiss it.

### Where the list comes from

The response that fills the grid already contains every domain — the portal just
doesn't render them. The extension reads that response as it goes past, using
the same page-world tap that API capture uses. No extra API call, no credentials,
nothing leaves the tab.

Two consequences:

- **The data arrives with the page.** If a card says nothing was captured,
  reload the portal page.
- **A card can lag the grid.** If you add a domain and the grid updates without
  re-fetching, the card says so rather than quietly showing a stale list.

### Why it has no CSS selectors

Cells are found by their own visible text — anything matching
`<hostname> (N of M Domains)` — and endpoint records are found by looking for
any domain array in the response rather than by a fixed JSON path. Both choices
are deliberate: MUI's class names are build hashes that change on every portal
release, and the API has two different shapes that carry the same domain list.

The cost is that the portal's **wording** becomes the dependency. If that line
ever changes, the card stops appearing; turn on verbose logging to see whether
endpoint data is being indexed at all.

## API capture

The portal draws everything from its own REST API. Any feature that wants to
show you portal *data* — rather than rearrange portal markup — has to know what
those calls return, and this extension can't see them from the outside. So it
asks you to look.

Turn **API capture** on in the popup, then **reload the portal page**. Every API
call the page makes is logged to the DevTools console, and the popup's **Copy
capture** button puts the whole log on the clipboard.

### What a capture looks like

```
GET /v4/waasapi/applications/{id}/endpoints/?page=1&page_size=25 → 200 · 412 ms · 18.2 KB
  request headers: accept, auth-api, content-type
  credentials: include
  response:
  {
    count: number(2),
    results: [ ×2
      {
        id: string:uuid(36),
        name: string:text(14),
        hostnames: [ ×1..3 string:hostname(17..25) ],
        maxHostnames: number(30),
        hostnameCount: number(7|1),
        serviceIp: string:ipv4(12),
        backendPort: number(443|8443),
        status: "ACTIVE"|"PAUSED",
        accountId: number
      }
    ]
  }
```

That tells you an endpoint record carries all of its hostnames and a limit,
which is the thing you wanted to know — without naming a single customer domain.

### What gets redacted

| | |
|---|---|
| Key names | **Kept.** They're API schema, and they're the point. |
| Strings | Reduced to a kind and a length: `string:hostname(21)`, `string:uuid(36)`, `string:ipv4(12)`. |
| Strings, shown verbatim | Only all-caps constants (`"ACTIVE"`) and a fixed list of protocol words (`"https"`) — and not even those under a key like `name`, `host`, or `domain`. |
| Numbers | Hidden, **unless** the key names a count or a bound, or the containing object does: `maxHostnames: 30` and `licensed_features.endpoint_domain: 30` show, `accountId` doesn't. `serialNumber` and `caseNumber` don't either. |
| URLs | Route words kept; anything else in a path becomes `{id}`, `{uuid}`, `{host}`, `{ip}` or `{name}`. The WaaS API routes some calls by **application name** (`/applications/Customer%20App%2001/cdn/`), so a path segment is kept only if it looks like a route word — lowercase, `_` or `-`. |
| Request headers | **Names only**, never values — enough to see that a call carries `auth-api`, never enough to see the token. |

The word lists that drive this live at the top of
[`src/lib/api-shape.js`](src/lib/api-shape.js). Widening one is a decision, not
a tidy-up: every word added is a value that can reach a clipboard.

### Use the popup's copy button, not the console

The console also contains the portal's own logging, which is **not** redacted.
Copying a console transcript wholesale is how a hostname ends up in a ticket.

And treat the redaction as a safety net rather than a guarantee — it classifies
values by pattern, so an unusual field could still carry something identifying.
**Read a capture before you paste it anywhere**, and never commit one to this
repo.

## Settings

- **Offset page content** — pushes the page down so the banner doesn't cover the
  portal's own header. Turn it off if it leaves a gap, or if the portal's header
  is itself fixed-position and ignores the offset.
- **Dismiss dialogs** — the selector list described above.
- **Deep link format** — title + URL, markdown link, or bare URL.
- **Verbose logging** — logs to the page console prefixed `[waas-helper]`.

## Privacy

The extension makes no network requests and transmits nothing. Its only
permissions are `storage`, `clipboardWrite`, and host access to
`waas.barracudanetworks.com` — no `<all_urls>`, no `tabs`.

API capture observes calls the portal was making anyway. To do that it patches
`fetch` and `XMLHttpRequest` in the page, which means the most recent responses
(capped at 60 calls and 4 MB) sit in that tab's memory — data the page already
had. Nothing is written to disk, nothing is sent anywhere, and the buffer dies
with the tab. Patching `fetch` is also visible to the page, so the portal could
in principle tell the extension is installed.

One caveat: rules are stored in `chrome.storage.sync`, so they travel with your
Chrome profile. If customer names in a banner label are sensitive to you, use
internal shorthand instead.

## Known limitations

- **Selector rules can break.** The inspector prefers stable hooks (`id`,
  `data-*`, meaningful class names) over generated ones, but a portal redesign
  can still invalidate a rule. The banner simply stops showing — it never shows
  the *wrong* account, since a non-matching selector yields no match.
- **Page offset is approximate.** Body padding can't move a fixed-position
  portal header. Hence the toggle.
- **Top-level frames only.** The content script doesn't run in iframes.
- **A dialog that refuses to close stays hidden.** If its close button can't be
  found or clicking it doesn't unmount the dialog, the extension gives up after
  three tries, leaves the dialog hidden, and releases the scroll lock by hand.
  The page stays usable, but a hidden modal remains mounted.
- **API capture needs Chrome 111+ and a page reload.** The tap runs as a
  `world: "MAIN"` content script, which arrived in Chrome 111. Content scripts
  only inject on navigation, so after reloading the extension, a portal tab that
  stayed open has no tap until you reload the page — the feature says so in the
  console rather than failing quietly.
- **API capture only sees JSON over `fetch`/XHR.** A response delivered by
  WebSocket, EventSource, or `sendBeacon` is invisible to it.
- **Endpoint domains depends on the portal's wording.** Cells are matched on the
  text `(N of M Domains)`. A redesign that rephrases that line stops the card
  appearing — it fails silently rather than wrongly, and verbose logging says
  whether endpoint data was indexed.
- **The domain card closes on scroll.** Re-anchoring it against a virtualized
  grid mid-scroll isn't worth the complexity; hover the cell again.

## Ideas for later

Not built, noted so the structure leaves room:

- Quick-nav command palette over portal pages you've visited
- WaaS REST API explorer (see [`docs/waas-api-notes.md`](../../docs/waas-api-notes.md))
- Response-header inspector showing whether a site is behind WaaS, and surfacing
  block IDs for troubleshooting

## Development

```
manifest.json
icons/                      generated by scripts/make_icons.py
src/
  background/               service worker: relays keyboard commands
  content/
    content.js              classic loader (MV3 content scripts can't be modules)
    boot.js                 real entry point; wires features to settings
    api-tap.js              page-world fetch/XHR tap (MAIN world, document_start)
    content.css             all injected styles, namespaced wph-
  features/                 one module per feature
  lib/                      settings, rule matching, DOM helpers, logging,
                            tap client, capture redaction, endpoint matching
  options/                  rules editor
  popup/                    feature toggles + detected account
```

`src/content/api-tap.js` is the odd one out: it runs in the page's own world so
it can see the page's `fetch`, which means no `chrome.*` APIs and no imports. It
only buffers and posts messages; everything that interprets its output lives in
`lib/tap-client.js` and `lib/api-shape.js`. A feature that needs portal API data
should use the tap client rather than patching anything itself.

A feature module exports `id` plus any of `apply(settings)`,
`onCommand(command, settings)`, and `onLocationChange(href, settings)`. `apply`
runs at startup and on every settings change, so it must be idempotent and must
clean up after itself when its flag is off.

**Reloading:** edits to content scripts, features, and CSS need a Reload on the
`chrome://extensions` card plus a page refresh. Service worker changes need the
Reload too. Options and popup changes just need the page reopened.

### Tests

The pure logic (rule matching, URL parsing, link formatting, contrast, dismiss
selector handling, capture redaction) is covered by a dependency-free test
suite. Node isn't installed on this machine, but VS Code bundles one:

```bash
CODE="$LOCALAPPDATA/Programs/Microsoft VS Code/Code.exe"
ELECTRON_RUN_AS_NODE=1 "$CODE" test/logic.test.mjs
```

With a normal Node install: `node test/logic.test.mjs`. The suite locates the
source relative to itself, so it runs from any working directory. 143
assertions, no dependencies, exits non-zero on failure.

What it does *not* cover: anything needing a real DOM or the `chrome` APIs —
the banner rendering, inspector overlay, popup, and options page are verified by
hand in the browser.
