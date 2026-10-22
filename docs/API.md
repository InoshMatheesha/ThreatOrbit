# ThreatOrbit API

Base URL: `https://<your-site>/api` (local: `http://127.0.0.1:4000/api`). All bodies are JSON unless noted.

**Authentication.** Every endpoint except `GET /api/health` and `POST /api/auth/login` requires a session.

- **The session cookie:** `POST /api/auth/login` sets it. Send it back with every request; browsers do this automatically.
- **Cross-site requests:** requests that change state from another origin are rejected.
- **Roles:**
  - **analyst:** can view everything except the audit log and the team list. Can change or delete only their own batches.
  - **admin:** can also manage users, view the audit log, test provider keys, and change or delete any batch or all history.


Successful responses wrap their payload in `data` (lists also include `meta`). Errors always use this shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [ ... ] } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body, query or path parameter failed validation. `details` lists `{ path, message }`. |
| `INVALID_JSON` | 400 | Body is not valid JSON. |
| `INVALID_FILE_CONTENT` | 400 | Upload is empty, binary, UTF-16, not valid UTF-8, or malformed CSV. |
| `ACKNOWLEDGEMENT_REQUIRED` | 400 | A batch needs `acknowledgeThirdPartySharing: true`. |
| `UNAUTHENTICATED` | 401 | No valid session. Sign in. |
| `INVALID_CREDENTIALS` | 401 / 400 | Wrong email or password, or a wrong current password when changing it. |
| `FORBIDDEN` | 403 | Signed in but not allowed: the role is too low, it is not your batch, or the request came from another site. |
| `CONFLICT` | 409 | Duplicate email, or the change would leave no active admin. |
| `ACCOUNT_LOCKED` | 429 | Five failed sign-ins: the account is locked for 15 minutes. |
| `NOTHING_TO_ENRICH` | 400 | The input has no provider-eligible indicators. |
| `NOT_FOUND` | 404 | Unknown route, batch, item or lookup. |
| `NO_PROVIDERS_CONFIGURED` | 409 | No provider has an API key configured on the server. |
| `BATCH_NOT_ACTIVE` | 409 | Cancel/retry on a batch that is finished or cancelled. |
| `NOT_RETRYABLE` / `NOTHING_TO_RETRY` | 409 | The lookup is not failed, or failed in a way retrying cannot fix. |
| `PAYLOAD_TOO_LARGE` / `FILE_TOO_LARGE` / `TOO_MANY_LINES` | 413 | Input over `MAX_UPLOAD_BYTES` / `MAX_INPUT_LINES`. |
| `BATCH_TOO_LARGE` | 413 | More eligible indicators than `MAX_BATCH_SIZE`. |
| `UNSUPPORTED_FILE_TYPE` | 415 | Not a `.txt`/`.csv` file. |
| `RATE_LIMITED` | 429 | Too many API requests or sign-in attempts, or a provider key test repeated within 15 s. |
| `DATABASE_UNAVAILABLE` | 503 | Enrichment endpoints while the database is not connected. |
| `AI_NOT_CONFIGURED` | 503 | An explanation was requested but `ANTHROPIC_API_KEY` is not set. |
| `AI_LIMIT_REACHED` | 429 | The team's `AI_DAILY_LIMIT` of new explanations is used up for today (UTC). |
| `AI_UNAVAILABLE` | 502 / 503 | The AI declined, was busy, was unreachable, rejected the key, or gave an unreadable answer. The message says which, in plain words. |
| `INTERNAL_ERROR` | 500 | Unexpected failure. No internals are leaked. |

---

## Authentication and team

### `POST /api/auth/login`

The body is `{ "email": "...", "password": "..." }`. On success it returns `{ id, email, name, role }` and sets the session cookie: `__Host-tih_session` over HTTPS, `tih_session` locally. Wrong credentials and unknown users get the same `401` response. Requests are limited to 20 per 15 minutes per IP.

### `POST /api/auth/logout`

Ends the current session and returns `204`.

### `GET /api/auth/me`

Returns the signed-in user.

### `POST /api/auth/password`

The body is `{ "currentPassword": "...", "newPassword": "..." }`, and the new password needs 12+ characters. It signs out every other session, issues a fresh cookie, and returns `204`.

### `GET /api/users` *(admin)*

The team list: `{ id, email, name, role, active, lastLoginAt, createdAt }`. Password hashes are never returned.

### `POST /api/users` *(admin)*

The body is `{ email, name, role: "admin" | "analyst", password }`. Returns `201`, or `409` if the email already exists.

### `PATCH /api/users/:id` *(admin)*

Accepts any of `{ name, role, active, password }`. Changing the role, deactivating, or resetting the password signs that user out everywhere. Returns `409` if the change would leave no active admin.

---

## Queue processing

### `POST /api/queue/tick`

Signed-in users. On serverless hosting (database queue) it processes due lookups for up to `TICK_BUDGET_MS`, respecting every provider's rate limit, and returns `{ mode, processed, pending }`. The dashboard calls it repeatedly while a batch is open. On self-hosted servers with their own workers it returns at once with `processed: 0`.

### `GET|POST /api/cron/tick`

Does the same for an external scheduler (e.g. cron-job.org). It needs the header `Authorization: Bearer <CRON_SECRET>`, and returns `404` when `CRON_SECRET` is not set.

---

## Health and providers

### `GET /api/health`

The public liveness probe. Signed-out callers get only `{ status, service }`; signed-in users also get the details below.

```json
{
  "data": {
    "status": "ok",
    "ai": { "enabled": true, "model": "claude-opus-5-5", "dailyLimit": 100 },
    "enrichment": {
      "database": { "connected": true, "mode": "external" },
      "queue": { "mode": "bullmq" },
      "settings": { "maxBatchSize": 500, "retentionDays": 30, "cacheTtlHours": 24 }
    }
  }
}
```

- `database.mode` is `embedded` when the built-in development MongoDB is in use.
- `queue.mode` is `memory` when the in-process development queue is in use.

### `GET /api/providers`

Lists each provider's `id`, `name`, `description`, `supports` (indicator types), `state` (`ready` | `unconfigured` | `disabled`), `credentialEnv` (the variable name only), `signupUrl`, `limits` (`requestsPerMinute`, `dailyLimit`, `concurrency`) and `usedToday`. `meta.queueMode` reports the queue in use. Credentials are never included.

### `POST /api/providers/:id/test` *(admin)*

Makes one real lookup of a harmless indicator (`8.8.8.8`) to check the key. The response is `{ ok, message, kind?, ms? }`. It counts toward the provider's daily quota, and each provider can be tested at most once every 15 s.

---

## Batches

### `POST /api/batches/preview`

Parses locally and never contacts a provider. Send either:

- JSON: `{ "text": "...", "mode": "lines" | "extract" }`
- multipart: a `file` field (`.txt`/`.csv`) plus an optional `mode` field

The response includes:

- `stats`: total, valid, invalid, duplicates, unique, eligible, ineligible, byType
- `entries`: one per input line, with `original`, `normalized`, `type`, `status`, `error`, `duplicateOfLine`, `refanged`, `lookupEligible`, `notes` and `display`
- `indicators`: the deduplicated indicators, with every source line kept
- `limits`: `maxBatchSize`, `withinBatchLimit` and `overBy`

### `POST /api/batches`

Creates a batch and queues its lookups. The input is the same as for preview (JSON or multipart), plus:

| Field | Type | Notes |
|---|---|---|
| `acknowledgeThirdPartySharing` | boolean | Required, and must be `true`. |
| `label` | string, up to 120 characters | Optional name. |

How the batch is built:

- **Re-parsing:** the server parses the input again itself and never trusts the client.
- **Exclusions:** private and internal indicators are recorded but not looked up.
- **Cache:** fresh cached results are copied instead of calling providers again.

Returns `201` with the batch (see the next endpoint).

### `GET /api/batches?page=1&pageSize=20&mine=true`

Team batch history, newest first. Each batch carries `createdBy { id, email, name }`, and `mine=true` limits the list to your own batches. `meta` carries `{ total, page, pageSize }`.

### `GET /api/batches/:id`

Returns one batch:

| Field | Contents |
|---|---|
| `status` | `queued`, `running`, `cancelling`, `completed`, `completed_with_errors` or `cancelled`. |
| `terminal` | `true` once the batch can no longer change. |
| `totals` | indicators, eligible, ineligible, invalid, duplicates. |
| `counters` | total, queued, running, completed, failed, cancelled and cached lookups. |
| `providers` | Configuration snapshot: which providers ran, and why the others did not. |
| `summary` | Risk counts, disagreements, and how many indicators are still provisional. |
| `progress` | Per-provider counts. |

A batch is only terminal once no lookup is queued or running.

### `GET /api/batches/:id/events`

Server-Sent Events. It sends `progress` events (the batch JSON) whenever the batch changes, then a final `done`. If the batch is deleted it sends `deleted`. The server ends each stream after 25 s, so hosting proxies don't cut it mid-batch; the browser's `EventSource` reconnects automatically.

### `GET /api/batches/:id/results`

| Query parameter | Values |
|---|---|
| `type` | Indicator type. |
| `risk` | `high`, `medium`, `low` or `unknown`. |
| `provider` | Only indicators that this provider looked up. |
| `status` | `pending`, `complete`, `has_failures` or `local`. |
| `disagreement` | `true` to show only indicators where providers disagree. |
| `q` | Searches the value, original input, summaries and tags. |
| `sort` | `risk`, `value`, `type` or `line`. |
| `order` | `asc` or `desc`. |
| `page`, `pageSize` | Page size is at most 200. |

Each returned item has the indicator, its `lines`/`originals`/`notes`, a `status`, `risk` and `results` keyed by provider id.

- **`risk`** has these fields:
  - `level`
  - `provisional`
  - `reasons[]`
  - `signals[]`
  - `disagreement { flagged, clear, summary }`
  - `coverage`
- **Each provider result** has these fields:
  - `status`, `outcome` (`found` / `not_found`) and `verdict`
  - `summary`, `detections` and `abuseConfidence`
  - `metrics`, `tags`, `references` and `permalink`
  - `lookedUpAt`, `expiresAt` and `cacheStatus`
  - `error { kind, message, httpStatus }`
  - `attempts`

Error kinds are `timeout`, `rate_limited`, `quota_exhausted`, `auth`, `provider_error`, `network`, `invalid_request` and `interrupted`.

### `GET /api/batches/:id/items/:index`

One indicator with full evidence from every provider.

### `POST /api/batches/:id/cancel`

Cancels the queued lookups. In-flight lookups finish first, so the status passes through `cancelling` before `cancelled`.

### `POST /api/batches/:id/retry-failed`

Re-queues every failed lookup except `invalid_request` ones. Returns `{ requeued }`.

### `POST /api/results/:resultId/retry`

Re-queues one failed lookup and returns `202`. This is useful after fixing a key or once a quota has reset.

### `DELETE /api/batches/:id`

Deletes the batch and its results, and returns `204`.

### `DELETE /api/batches` *(admin)*

Deletes all history: every batch, result and stored indicator. The body must be `{ "confirm": "DELETE ALL" }`.

---

## Plain-English explanations

Written by an AI model from the lookup results. They are optional: without `ANTHROPIC_API_KEY` the feature is off, the `GET` endpoints return `data: null` with `meta.enabled: false`, and the `POST` endpoints return `AI_NOT_CONFIGURED`.

What is sent to the model: the indicator values and, for each source, its verdict, summary, tags and a few details, plus ThreatOrbit's risk level and reasons. Batch labels, user names and email addresses are never sent. Everything from outside services is passed as quoted data, and the model's reply is checked against a schema; indicators it was not given are dropped.

Explanations are stored with a fingerprint of the evidence they were written from. If lookups change afterwards, `stale` is `true` and a new one can be requested. New explanations count against `AI_DAILY_LIMIT`; saved ones are free.

### `GET /api/batches/:id/explanation`

The saved batch summary, or `null`. `meta` is `{ enabled, model, dailyLimit }`.

### `POST /api/batches/:id/explanation`

Body `{ "refresh": false }`. Returns the saved summary when it is still current, otherwise writes a new one.

```json
{
  "data": {
    "explanation": {
      "headline": "Four addresses and one link look dangerous",
      "overview": "...",
      "keyPoints": ["..."],
      "nextSteps": ["..."],
      "indicators": [{ "value": "185.220.101.4", "headline": "...", "explanation": "...", "nextSteps": ["..."] }]
    },
    "model": "claude-opus-5-5",
    "generatedAt": "2026-10-22T09:30:00.000Z",
    "stale": false,
    "cached": false
  },
  "meta": { "enabled": true, "model": "claude-opus-5-5", "dailyLimit": 100 }
}
```

`indicators` covers up to ten High and Medium risk items, most serious first.

### `GET|POST /api/batches/:id/items/:index/explanation`

The same, for one indicator (any risk level, including kept-local ones). `explanation` is `{ headline, whatIsIt, whyItMatters, confidence: "low" | "medium" | "high", nextSteps[] }`.

---

## Exports and audit

### `GET /api/exports/:batchId?format=csv|json`

Downloads the batch as an attachment. Every export is recorded in the audit log.

- **CSV:** one row per indicator × provider, including the risk level, its reasons, any disagreement, the provider verdict and evidence, the lookup time, cache status, error and source lines. Cells are protected against formula injection, and the file has a UTF-8 BOM so Excel opens it correctly.
- **JSON:** the batch metadata plus every indicator with its risk and provider results.

### `GET /api/audit?limit=100` *(admin)*

Recent audit events. Each event has `{ at, action, actor { id, email, name } | null, batchId?, details }`. Actions include sign-ins and failed sign-ins, AI explanations (scope and model only), password changes, user changes, batch create/cancel/retry/delete, exports and provider key tests. The details never contain indicator values or secrets.
