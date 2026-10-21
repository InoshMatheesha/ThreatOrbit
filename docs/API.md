# Threat Intel Hub API

Base URL (local): `http://127.0.0.1:4000/api`

All responses are JSON. Successful responses wrap their payload in `data`. Errors always use this shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [ ... ] } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body or fields failed validation. `details` lists `{ path, message }`. |
| `INVALID_JSON` | 400 | Body is not valid JSON. |
| `INVALID_FILE_CONTENT` | 400 | Upload is empty, binary, UTF-16, not valid UTF-8, or malformed CSV. |
| `PAYLOAD_TOO_LARGE` | 413 | JSON body exceeds `MAX_UPLOAD_BYTES` (+64 KiB of overhead). |
| `FILE_TOO_LARGE` | 413 | Uploaded file exceeds `MAX_UPLOAD_BYTES`. |
| `TOO_MANY_LINES` | 413 | Input has more than `MAX_INPUT_LINES` lines. |
| `UNSUPPORTED_FILE_TYPE` | 415 | Not a `.txt`/`.csv` file, or an unexpected MIME type. |
| `RATE_LIMITED` | 429 | Over `API_RATE_LIMIT_PER_MINUTE`. |
| `NOT_FOUND` | 404 | Unknown route. |
| `INTERNAL_ERROR` | 500 | Unexpected failure. No internals are leaked. |

---

## `GET /api/health`

```json
{ "data": { "status": "ok", "service": "threat-intel-hub", "uptimeSeconds": 42, "time": "2026-10-21T18:00:00.000Z" } }
```

---

## `POST /api/batches/preview`

Parses, validates, classifies and deduplicates indicators **locally**. It makes no DNS lookups, HTTP requests or socket connections, and never contacts a threat intel provider. Nothing is stored.

### Request: pasted text

```http
POST /api/batches/preview
Content-Type: application/json

{ "text": "8.8.8.8\nhxxps://evil[.]com/login\n...", "mode": "lines" }
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `text` | string | required | Up to `MAX_UPLOAD_BYTES`. |
| `mode` | `"lines"` \| `"extract"` | `"lines"` | `lines`: one indicator per line, and every non-empty line is reported. `extract`: free text, and only recognised indicators are reported. |

Unknown fields are rejected.

### Request: file upload

```bash
curl -F "file=@iocs.csv" -F "mode=lines" http://127.0.0.1:4000/api/batches/preview
```

- One file in the field `file`, `.txt` or `.csv` only, UTF-8, at most `MAX_UPLOAD_BYTES`.
- **CSV:** if the first row has a recognised header (`ioc`, `indicator`, `observable`, `value`, `ip`, `domain`, `url`, `hash`, `md5`, `sha1`, `sha256`, ...), only that column is used. Otherwise every non-empty cell is a candidate. Line numbers refer to CSV records.
- In `extract` mode a CSV file is scanned as plain text.

### Response

```jsonc
{
  "data": {
    "mode": "lines",
    "source": { "kind": "text" },             // or { "kind": "file", "name": "iocs.csv", "bytes": 1234 }
    "stats": {
      "total": 124,        // candidates considered (valid + invalid)
      "valid": 122,
      "invalid": 2,
      "duplicates": 1,     // valid entries whose normalized value was already seen
      "unique": 121,
      "eligible": 118,     // unique indicators that may be sent to providers
      "ineligible": 3,     // private IPs, internal TLDs, ... (kept local)
      "byType": { "ipv4": 20, "ipv6": 20, "md5": 20, "sha1": 0, "sha256": 20, "domain": 21, "url": 20 },
      "linesRead": 125, "emptyLines": 1, "commentLines": 0
    },
    "limits": { "maxBatchSize": 500, "withinBatchLimit": true, "overBy": 0 },
    "entries": [
      {
        "line": 1,
        "original": "hxxps://evil[.]com/a#x",       // exactly as submitted (audit trail)
        "normalized": "https://evil.com/a",
        "type": "url",                              // ipv4 | ipv6 | md5 | sha1 | sha256 | domain | url | null
        "status": "valid",                          // valid | invalid
        "error": null,                              // reason when invalid
        "duplicate": false,
        "duplicateOfLine": null,
        "refanged": true,
        "lookupEligible": true,
        "notes": ["Fragment (#...) removed: it is never sent to web servers"],
        "display": "..."                            // only for internationalized domains/URLs
      }
    ],
    "indicators": [
      {
        "value": "evil.com", "type": "domain",
        "lines": [3, 9], "originals": ["evil[.]com", "EVIL.COM"],
        "lookupEligible": true, "notes": []
      }
    ]
  }
}
```

`withinBatchLimit` compares **eligible unique** indicators against `MAX_BATCH_SIZE`, because ineligible ones are never sent to providers.

---

## Coming in later stages

`POST /api/batches`, `GET /api/batches/:id`, `GET /api/batches/:id/results`, `POST /api/batches/:id/cancel`, `POST /api/results/:id/retry`, `GET /api/providers`, `GET /api/exports/:batchId?format=csv|json`.
