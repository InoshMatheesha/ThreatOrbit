# Threat Intel Hub API

Base URL (local): `http://127.0.0.1:4000/api`. All bodies are JSON unless noted.

Successful responses wrap their payload in `data` (lists also include `meta`). Errors always use this shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [ ... ] } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body, query or path parameter failed validation. `details` lists `{ path, message }`. |
| `INVALID_JSON` | 400 | Body is not valid JSON. |
| `INVALID_FILE_CONTENT` | 400 | Upload is empty, binary, UTF-16, not valid UTF-8, or malformed CSV. |
| `ACKNOWLEDGEMENT_REQUIRED` | 400 | A real (non-demo) batch needs `acknowledgeThirdPartySharing: true`. |
| `NOTHING_TO_ENRICH` | 400 | The input has no provider-eligible indicators. |
| `NOT_FOUND` | 404 | Unknown route, batch, item or lookup. |
| `NO_PROVIDERS_CONFIGURED` | 409 | No provider has a key; add keys or use demo mode. |
| `BATCH_NOT_ACTIVE` | 409 | Cancel/retry on a batch that is finished or cancelled. |
| `NOT_RETRYABLE` / `NOTHING_TO_RETRY` | 409 | The lookup is not failed, or failed in a way retrying cannot fix. |
| `PAYLOAD_TOO_LARGE` / `FILE_TOO_LARGE` / `TOO_MANY_LINES` | 413 | Input over `MAX_UPLOAD_BYTES` / `MAX_INPUT_LINES`. |
| `BATCH_TOO_LARGE` | 413 | More eligible indicators than `MAX_BATCH_SIZE`. |
| `UNSUPPORTED_FILE_TYPE` | 415 | Not a `.txt`/`.csv` file. |
| `RATE_LIMITED` | 429 | Too many API requests, or a provider key test repeated within 15 s. |
| `DATABASE_UNAVAILABLE` | 503 | Enrichment endpoints while the database is not connected. |
| `INTERNAL_ERROR` | 500 | Unexpected failure. No internals are leaked. |

---

## Health and providers

### `GET /api/health`

```json
{
  "data": {
    "status": "ok",
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

Lists each provider's `id`, `name`, `description`, `supports` (indicator types), `state` (`ready` | `unconfigured` | `disabled`), `synthetic`, `credentialEnv` (the variable name only), `signupUrl`, `limits` (`requestsPerMinute`, `dailyLimit`, `concurrency`) and `usedToday`. `meta.queueMode` reports the queue in use. Credentials are never included.

### `POST /api/providers/:id/test`

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
| `acknowledgeThirdPartySharing` | boolean | Required `true` unless `demo`. |
| `demo` | boolean | Use only the synthetic demo provider. Results are labeled and nothing leaves the PC. |
| `label` | string, up to 120 characters | Optional name. |

How the batch is built:

- **Re-parsing:** the server parses the input again itself and never trusts the client.
- **Exclusions:** private and internal indicators are recorded but not looked up.
- **Cache:** fresh cached results are copied instead of calling providers again.

Returns `201` with the batch (see the next endpoint).

### `GET /api/batches?page=1&pageSize=20`

Batch history, newest first. `meta` carries `{ total, page, pageSize }`.

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

Server-Sent Events. It sends `progress` events (the batch JSON) whenever the batch changes, then a final `done`. If the batch is deleted it sends `deleted`.

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

### `DELETE /api/batches`

Deletes all history: every batch, result and stored indicator. The body must be `{ "confirm": "DELETE ALL" }`.

---

## Exports and audit

### `GET /api/exports/:batchId?format=csv|json`

Downloads the batch as an attachment. Every export is recorded in the audit log.

- **CSV:** one row per indicator × provider, including the risk level, its reasons, any disagreement, the provider verdict and evidence, the lookup time, cache status, error and source lines. Cells are protected against formula injection, and the file has a UTF-8 BOM so Excel opens it correctly.
- **JSON:** the batch metadata plus every indicator with its risk and provider results.

### `GET /api/audit?limit=100`

Recent audit events. Each event has `{ at, action, batchId?, details }`. The details never contain indicator values or secrets.
