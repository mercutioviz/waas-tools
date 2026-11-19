# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

`waas-tools` is a personal toolbox for Barracuda **WAF-as-a-Service (WaaS)** work,
maintained by a solutions architect. It is a deliberate grab-bag: many small,
unrelated tools accumulated over time, not one cohesive application.

Practical consequences:

- **Tools are independent.** Do not introduce shared frameworks, cross-tool
  abstractions, or a repo-wide build system. If two tools need the same helper,
  copying ~30 lines is preferable to coupling them.
- **Bias toward small and finished.** These are tinkering tools. A working thing
  with a short README beats a half-built architecture.
- **Expect new top-level tools regularly.** The layout must stay obvious as it grows.

## Repository layout

```
chrome-extensions/   Browser extensions, one self-contained directory each
scripts/             Standalone Python utilities
docs/                Reference notes (API endpoints, auth flows, portal behavior)
```

Rules:

- **A tool never reaches outside its own directory.** No `../` imports between tools.
- Every tool has a `README.md` covering what it is, how to install/run it, and its
  current limitations.
- A tool gets its own `CLAUDE.md` only when its conventions differ from this file's.
- Nothing at the repo root belongs to a single tool.

When adding a tool, put it under the right category directory and add a row to the
table in the root `README.md`.

## Security rules — read this one

**This repository is public** (`github.com/mercutioviz/waas-tools`), and the work it
supports routinely involves real customer environments. Treat every commit as
published to the world, because it is.

Never commit:

- Credentials of any kind — Barracuda Cloud Control logins, API passwords
- WaaS API tokens (the `auth-api` header value from `/api_login`)
- Customer hostnames, domain names, application names, or backend IPs
- Account IDs, tenant IDs, serial numbers, or support case numbers
- HAR files, request/response captures, or WAF logs (these are dense with PII and
  session tokens)
- Screenshots of the portal showing any of the above

Instead:

- Secrets go in `.env` or `*.local.json`, both gitignored. Commit a `.env.example`
  with empty placeholder keys.
- Use obviously fake placeholders in docs and code samples: `example.com`,
  `customer-app-01`, `ACCOUNT_ID_HERE`.
- Keep throwaway customer data in `scratch/` or `local/` — both gitignored.

**Before any commit, scan the diff for the items above.** If something questionable
is already staged, stop and say so rather than committing it.

### Gotcha: the secrets `.gitignore` rules are broad

`.gitignore` contains `*secret*`, `*token*`, `*apikey*`, and `*api_key*`. These are
intentionally aggressive and will also silently ignore legitimate source files —
a file named `tokenizer.py` or `token-parser.js` will not show up in `git status`.

If a file you just created doesn't appear in git, run
`git check-ignore -v <path>` to confirm that's why, then rename the file rather
than weakening the rule.

## Environment

This repo is developed on Windows. These are recurring sources of failure:

| Thing | Detail |
|---|---|
| **Shell** | Git Bash (POSIX `sh`), not cmd or PowerShell. Use Unix syntax. |
| **Paths contain spaces** | The repo lives under `OneDrive - Barracuda Networks, Inc`. **Always quote paths** in shell commands — unquoted paths fail in confusing ways. |
| **No Node.js / npm** | Not installed, not on PATH. Prefer no-build-step tooling. Do not scaffold anything requiring `npm install` without asking first. |
| **Python 3.12.10** | Available as `python`. **Pillow is not installed.** Stick to the standard library; ask before adding a dependency. |
| **OneDrive sync** | The repo is inside a synced folder. Files On-Demand can leave placeholder stubs on disk that tools read as empty or missing. If a directory needs to be reliably readable by an external program (e.g. Chrome loading an unpacked extension), mark it *"Always keep on this device."* |
| **git `safe.directory`** | The repo is owned by `BUILTIN\Administrators` while the shell runs as a normal user. An exception has already been added to the global gitconfig. If git ever reports *"dubious ownership"* again, that exception was lost — re-add it rather than working around it. |

## Conventions

- **Chrome extensions:** Manifest V3, vanilla JS/HTML/CSS, **no build step**. Load
  unpacked from `chrome://extensions`. Request the narrowest possible permissions
  and scope `host_permissions` to specific origins — never `<all_urls>`.
- **Python:** standard library first. Single-file scripts where practical. Run with
  `python -I` when the script touches downloaded or untrusted data.
- **Dependencies:** adding one is a decision, not a detail. Ask first.
- **Comments:** explain *why*, not *what*. Portal/API quirks discovered the hard way
  are worth a comment; obvious code is not.

## WaaS reference

Verified against Barracuda documentation.

| | |
|---|---|
| Portal UI | `https://waas.barracudanetworks.com/` (SSO via Barracuda Cloud Control) |
| API v4 base | `https://api.waas.barracudanetworks.com/v4/waasapi/` |
| API v2 base | `https://api.waas.barracudanetworks.com/v2/waasapi/` |
| Swagger (v4) | `https://api.waas.barracudanetworks.com/v4/swagger/` |

**Auth flow:**

1. `POST {base}/api_login` with `Content-Type: application/x-www-form-urlencoded`
   and body `email=<...>&password=<...>`
2. Response: `{"key": "<token>", "expiry": "<timestamp>"}`
3. Send `key` as the **`auth-api`** header on all subsequent calls (not
   `Authorization`, and not a bearer token — this trips people up)

Prefer **v4** for new work; v2 is still documented and some endpoints differ
between versions. Longer notes live in [docs/waas-api-notes.md](docs/waas-api-notes.md).

Official Barracuda automation examples:
`https://github.com/barracudanetworks/waf-automation`

## Working style

- The portal is behind SSO, so **Claude cannot see its DOM.** Do not write code
  against guessed CSS selectors and present it as working. Make selector-dependent
  behavior user-configurable, or build a tool to discover the real selectors first.
- Browser-based verification requires a logged-in session, so the user runs those
  steps. Say clearly which steps are verified and which are handed off untested.
