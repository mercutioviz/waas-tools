# waas-tools

Barracuda WAF-as-a-Service tools, tricks, and fun stuff.

A grab-bag repo. Each tool here is small, self-contained, and independent of the
others — browser extensions, scripts, API helpers, and whatever else turns out to
be useful.

## Tools

| Tool | What it does | Path |
|---|---|---|
| WaaS Portal Helper | Chrome extension (MV3) adding quality-of-life features to the WAF-as-a-Service portal: a tenant safety banner, copy-deep-link shortcut, DOM inspector, dialog dismisser, full endpoint domain lists on hover, and a redacting API capture. | [chrome-extensions/waas-portal-helper/](chrome-extensions/waas-portal-helper/) |

## Layout

```
chrome-extensions/   Browser extensions, one directory each
scripts/             Standalone Python utilities
docs/                Reference notes (API endpoints, auth flows, etc.)
```

Each tool owns its directory and carries its own `README.md`. Nothing at the repo
root belongs to a single tool.

## Heads up

This repository is **public**. Never commit credentials, API tokens, customer
hostnames, account IDs, or support-case data. See [CLAUDE.md](CLAUDE.md) for the
full rules and the `.gitignore` entries that back them up.

## License

See [LICENSE](LICENSE).
