# ThreatOrbit: Threat Intel Hub

Bulk IOC triage for SOC analysts. You paste hundreds of IPs, hashes, domains and URLs, or upload a TXT/CSV file. The app validates, refangs, classifies and deduplicates them locally, then enriches them across several threat intel providers in one go.

> **Status: Stage 1 of 7 complete.** The local parser and preview API are done and tested. Provider enrichment, batches, the dashboard and exports are not built yet. See the [roadmap](#roadmap).

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js 20+, Express 5, TypeScript, Zod, pino |
| Parsing | `ipaddr.js`, `tldts` (Public Suffix List), WHATWG `URL`, Node UTS #46 IDNA, `csv-parse` |
| Storage / queue | MongoDB, Redis + BullMQ (from Stage 2) |
| Frontend | React + Vite + TypeScript + Tailwind (from Stage 2) |
| Tests | Vitest + Supertest |

## Quick start

```bash
# Node.js 20.19+ required
npm install
cp backend/.env.example backend/.env

npm run dev:backend        # API on http://127.0.0.1:4000
npm test                   # all tests
npm run typecheck
npm run build

# MongoDB + Redis (not required for Stage 1)
docker compose up -d
```

Try it:

```bash
curl -s http://127.0.0.1:4000/api/batches/preview \
  -H 'content-type: application/json' \
  -d '{"text":"hxxps://evil[.]com/login\n8.8.8.8\n8.8.8.8\n10.0.0.1\nmünchen.de\nnot-an-ioc"}'

curl -s -F "file=@iocs.csv" http://127.0.0.1:4000/api/batches/preview
```

Full API reference: [docs/API.md](docs/API.md).

## What the parser does

All of this runs offline. There is no DNS, no HTTP and no sockets, and a test enforces it. A syntactically valid indicator is never treated as safe or malicious.

| Type | Validation | Normalization |
|---|---|---|
| IPv4 | Exactly four decimal octets, 0-255. Rejects leading zeros (`010.1.1.1` is ambiguous octal). | Dotted decimal |
| IPv6 | `ipaddr.js`. Rejects zone IDs (`%eth0`) and CIDR. Accepts `[...]`. | RFC 5952 (`2001:db8::1`). IPv4-mapped addresses stay IPv6 (`::ffff:1.2.3.4`) and are not merged with the IPv4 address. |
| MD5 / SHA-1 / SHA-256 | Exact hex length 32 / 40 / 64. Other hex lengths get a specific error (including SHA-512). | Lowercase |
| Domain | LDH labels (underscores allowed), at most 63 chars per label and 253 total, non-numeric TLD. | UTS #46 to punycode, lowercase, trailing root dot removed. A Unicode `display` form is kept. |
| URL | WHATWG URL parser, `http`/`https` only, host validated as an IP or domain. | Lowercase scheme/host, default port dropped, IDN host punycoded, fragment removed |

**Extras you get on top:**

- **Refanging:** `hxxp`, `hXXps`, `[.]`, `(.)`, `{.}`, `[dot]`, `[:]`, `[://]`, `[@]` and `\.` are all reversed. The original text is always kept on each entry, and `refanged: true` flags it.
- **Kept local, never sent to providers:** private/RFC 1918, loopback, link-local, CGNAT, multicast, documentation and other reserved IP ranges. Also non-public TLDs (`.local`, `.internal`, `.corp`) and bare public suffixes (`co.uk`). These still appear in results with `lookupEligible: false` and a reason.
- **Security notes:** mixed-script homographs (`аpple.com` with a Cyrillic а), zero-width characters removed during IDNA, URLs with embedded credentials, numeric URL hosts the URL standard silently reinterprets (`http://0x7f.1/` becomes `127.0.0.1`), and TLDs that double as file extensions (`readme.md`).
- **Targeted errors:** `evil.com/x` asks you to add a scheme, `evil.com:8080` says host:port isn't supported, `user@evil.com` tells you to submit the domain, and `10.0.0.0/8` says CIDR isn't supported.
- **Free-text extraction (`mode: "extract"`):** paste a phishing email or an incident report and the recognisable IOCs are pulled out. Domains must have a public suffix, so `e.g.`, `invoice.exe` and timestamps like `10:30` are ignored. Email senders contribute their domain.
- **Deduplication** uses `type + normalized value`. Every entry reports `duplicateOfLine`, and every unique indicator keeps all its source `lines` and distinct `originals`.
- **Line handling:** CRLF, LF and CR line endings and UTF-8 BOMs are handled. Empty lines are ignored, and lines starting with `#` or `//` are treated as comments.

## Security posture (Stage 1)

- **No authentication yet.** The server binds to `127.0.0.1` and refuses to start on another interface unless `ALLOW_UNAUTHENTICATED_REMOTE=true`.
- Helmet security headers, a per-IP API rate limit and strict Zod validation are in place. Unknown fields are rejected.
- **Upload checks:** extension (`.txt`/`.csv`), MIME type, size and file count are all limited, and the content must be valid UTF-8 text, not binary.
- **Logging:** request logs record only the method, path, status and duration. Query strings and bodies are never logged, and credential-like fields are redacted.
- Secrets live only in `backend/.env`, which is gitignored. `.env.example` contains placeholders only.

## Known limitations

- **Free-text extraction is heuristic.** Real TLDs that look like filenames (`readme.md`, `update.zip`) are extracted, but flagged with a note. URLs ending in `)` lose that character.
- **Defanging that splits on whitespace** (`evil [.] com`) is only recognised inside a single token.
- **Only http/https URLs are supported.** Other schemes (ftp and so on) and CIDR ranges are rejected.
- **`withinBatchLimit` only warns at preview time.** Batch creation (Stage 2) will enforce it.

## Roadmap

1. ✅ Local parser, preview API and tests
2. ⬜ Bulk-input UI (paste, upload, live preview) and the Batch/Indicator/EnrichmentResult MongoDB models
3. ⬜ Provider adapters: VirusTotal, AbuseIPDB, AlienVault OTX, URLhaus, GreyNoise Community. Each with its own rate limits, timeouts, 429 handling, an "unconfigured" state and a separately labeled demo mode.
4. ⬜ BullMQ batch processing, caching with TTL, cancel/retry, and progress via SSE. Includes a documented in-process fallback when Redis is unavailable (dev only).
5. ⬜ Explainable risk rules, a display for provider disagreements, and the dashboard with filters and detail panel
6. ⬜ CSV/JSON exports, audit log, retention and deletion controls
7. ⬜ Full verification pass

Cisco Talos is **not** planned. It has no public lookup API, and scraping it is out of scope. URLhaus and GreyNoise cover its role.
