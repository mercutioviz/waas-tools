# WaaS API notes

Working notes on the Barracuda WAF-as-a-Service REST API. Sourced from Barracuda
documentation; verify against the live Swagger UI before relying on any detail.

## Endpoints

| | |
|---|---|
| Portal UI | `https://waas.barracudanetworks.com/` |
| API v4 base | `https://api.waas.barracudanetworks.com/v4/waasapi/` |
| API v2 base | `https://api.waas.barracudanetworks.com/v2/waasapi/` |
| Swagger v4 | `https://api.waas.barracudanetworks.com/v4/swagger/` |
| Swagger v2 | `https://api.waas.barracudanetworks.com/swagger/` |

Prefer **v4** for new work. v2 remains documented and some resources differ
between versions, so don't assume a v2 request body works against v4.

## Authentication

Two separate things, easy to conflate:

- **The portal UI** uses an interactive SSO session via Barracuda Cloud Control.
  A browser extension running on the portal rides this session automatically and
  needs no credentials of its own.
- **The REST API** uses its own token, obtained below. It is *not* the portal
  session cookie.

### Getting a token

```
POST {base}/api_login
Content-Type: application/x-www-form-urlencoded

email=USER@EXAMPLE.COM&password=PASSWORD_HERE
```

Response:

```json
{ "key": "TOKEN_HERE", "expiry": "2026-01-01T00:00:00Z" }
```

### Using the token

Send the `key` value in the **`auth-api`** request header:

```
auth-api: TOKEN_HERE
```

Not `Authorization`. Not `Bearer`. This is the single most common mistake when
starting out with this API.

The account used can be a full admin or a role-based administrator with reduced
permissions — worth using a scoped account for automation.

## Resource groups

Swagger organizes operations roughly as: `login`, `applications`, `application`,
`components`, `accounts`, `account_ips`, `certificate authority`, `report`.

### Example: create an application (v2)

```
POST https://api.waas.barracudanetworks.com/v2/waasapi/applications/
auth-api: TOKEN_HERE
Content-Type: application/json
```

Body fields include `applicationName`, `backendIp`, `backendPort`, `serviceIp`,
`httpsServicePort`, `backendType`, `serviceType`, `hostnames`.

## Reference

- Official examples: <https://github.com/barracudanetworks/waf-automation>
  (see `waf-as-a-service-api/`, including a Python login + list-applications sample)
- WaaS API v4 docs: <https://campus.barracuda.com/product/WAAS/doc/168434341/waas-api-version-4/>
- WaaS API v2 docs: <https://campus.barracuda.com/product/WAAS/doc/100369522/waas-api/>

---

**Reminder:** never paste a real token, password, customer hostname, or account ID
into this file. Use the placeholder style above.
