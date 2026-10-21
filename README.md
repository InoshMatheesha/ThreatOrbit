# ThreatOrbit: Threat Intel Hub

Bulk IOC triage for SOC analysts. Paste hundreds of IPs, hashes, domains and URLs (or drop a TXT/CSV file). The app validates, refangs, classifies and deduplicates them locally, then enriches them across **VirusTotal, AbuseIPDB, AlienVault OTX, URLhaus and GreyNoise** in one go, with an explainable risk level per indicator.

## One-click start (Windows)

Double-click **`Start Threat Intel Hub.bat`**.

1. **Checks Node.js:** it needs Node.js 22.12 or newer, 64-bit. If Node is missing, it opens nodejs.org for you.
2. **Asks for your API keys (first run only):** they are written to `backend\.env`, which is gitignored and stays on your PC. Press Enter to skip any provider.
3. **Sets up the database and queue:** with Docker Desktop running, it starts MongoDB and Redis containers. Without Docker, the app starts its own local MongoDB and an in-process queue automatically. The first start downloads MongoDB, about 100 MB.
4. **Installs, builds and starts:** your browser opens at <http://127.0.0.1:4000> once the app is ready. If the build fails because of a corrupted install, the launcher reinstalls once and retries.

Keep the console window open while you work, because closing it stops the app. To change keys, edit `backend\.env` and restart.

## Check that it really works

1. **Test your keys:** open **Providers** and click **Test key** on each provider. Each one makes a single real lookup of `8.8.8.8` and should say *Key works*. A wrong key shows *rejected the API key*.
2. **Try the flow without spending quota:** on **Investigate**, click **Load sample** → **Enrich** → tick **Demo mode** → **Run demo batch**. This exercises the whole pipeline with clearly labeled SYNTHETIC data.
3. **Run a real batch:** click **Load sample** again → **Enrich**, tick the sharing confirmation, then **Start enrichment**.
   - **What to expect:** the sample includes the harmless EICAR antivirus test file hashes (`44d886…`, `3395856…`, `275a02…`). VirusTotal flags these with dozens of engines, so they should come back **High**.
   - **How long it takes:** VirusTotal's free tier allows 4 lookups per minute, so its column fills in over a few minutes. The other providers finish in seconds.
4. **Compare with the source:** click any row, then **Open in VirusTotal ↗** (or AbuseIPDB / OTX / URLhaus), and compare the numbers with the provider's own website.
5. **Export:** use **Export CSV** to get the results as a spreadsheet.

## Features

| Area | What you get |
|---|---|
| **Input** | Paste or drag-and-drop `.txt`/`.csv`. Two modes: *one per line* (every line validated), or *extract from text* (paste an email or report and the IOCs are pulled out). Live preview with total / valid / invalid / duplicate / kept-local counts. |
| **Parsing** | IPv4, IPv6, MD5, SHA-1, SHA-256, domains (including IDN/punycode) and http(s) URLs. Refangs `hxxp`, `[.]`, `(dot)` and similar. Strict normalization without merging distinct indicators, and line numbers are kept. Fully offline. |
| **Safety** | Private/reserved IPs and internal domains (`.local`, `.corp`) are **never sent** to providers. Flags homograph domains, hidden zero-width characters, credentials in URLs, and octal or hex IP tricks. Every real batch requires an explicit third-party-sharing confirmation. |
| **Providers** | Read-only lookups: nothing is ever uploaded or submitted for analysis. Each provider has its own rate limit, concurrency, timeout, retries with exponential backoff, `Retry-After`/HTTP 429 handling, and a daily-quota guard that persists across restarts. |
| **Honest results** | A provider either has a record or not. Timeouts, auth failures, quota exhaustion and provider errors are shown as such and **never** counted as clean. |
| **Risk** | High / Medium / Low / Unknown, using per-provider, per-indicator-type rules. Every level lists its reasons. Provider disagreement is called out explicitly. Low means "records exist, none flag it", never "safe". |
| **Batches** | Background queue (BullMQ on Redis, or the in-process fallback). Live progress over Server-Sent Events, per-provider ETA, cancel, retry one or all failed lookups, and automatic resume after a restart. |
| **Cache** | Fresh results (24 h by default) are reused instead of spending quota again, and marked as cached. |
| **Dashboard** | Metrics, per-provider progress, and a results table with risk/type/provider/status/disagreement filters, search, sort and pagination. A detail panel shows every provider's evidence, tags, references and permalinks. |
| **Exports** | CSV (one row per indicator × provider, formula-injection safe, Excel-friendly UTF-8) and JSON. Demo exports are labeled. |
| **History and audit** | Batch history, an audit log (create, cancel, retry, export, delete, purge, key tests; never indicator values), automatic retention purge (30 days by default), and delete-one / delete-all controls. |
| **Demo mode** | A synthetic provider for trying the workflow or training. Demo batches only ever contain synthetic results, and they are labeled everywhere. |

## Run it manually (any OS)

```bash
# Node.js 22.12+ required
npm install
cp backend/.env.example backend/.env      # then add your API keys

docker compose up -d                      # optional: MongoDB + Redis. Without it, built-in fallbacks are used
npm run build && npm start                # UI + API on http://127.0.0.1:4000

npm run dev                               # development: API on :4000 + UI with hot reload on :5173
npm test                                  # 151 automated tests (mocked providers, no real quota used)
npm run typecheck
```

The first `npm test` downloads a MongoDB binary for the test database. To use an existing one instead, set `MONGOMS_SYSTEM_BINARY=/path/to/mongod`. The BullMQ tests run when Redis is reachable at `REDIS_URL`, and are skipped otherwise.

## Providers

| Provider | Indicator types | Free tier and default limits | Key |
|---|---|---|---|
| VirusTotal | IPv4, IPv6, domain, URL, MD5, SHA-1, SHA-256 | 4/min, 500/day | `VIRUSTOTAL_API_KEY` from <https://www.virustotal.com/gui/my-apikey> |
| AbuseIPDB | IPv4, IPv6 | 1,000 checks/day (30/min locally) | `ABUSEIPDB_API_KEY` from <https://www.abuseipdb.com/account/api> |
| AlienVault OTX | IPv4, IPv6, domain/hostname, URL, MD5, SHA-1, SHA-256 | 30/min locally | `OTX_API_KEY` from <https://otx.alienvault.com/api> |
| URLhaus (abuse.ch) | URL, domain, IPv4 (host), MD5, SHA-256 (payload) | 30/min locally | `URLHAUS_AUTH_KEY` from <https://auth.abuse.ch/> |
| GreyNoise Community | IPv4 | 10/min, 50/day locally | `GREYNOISE_API_KEY` from <https://viz.greynoise.io/signup> |

- **Paid plans:** raise the limits with `<PROVIDER>_REQUESTS_PER_MINUTE` and `<PROVIDER>_DAILY_LIMIT`.
- **Turning a provider off:** use `PROVIDERS_DISABLED=otx,greynoise`.
- **Missing keys:** a provider without a key shows as *unconfigured* and is never called.
- **Cisco Talos:** not integrated, because it has no public lookup API and scraping is out of scope.

## Risk rules

The defaults live in `backend/src/config/riskRules.ts`. To override any part, point `RISK_RULES_PATH` at a JSON file, for example:

```json
{ "abuseipdb": { "high": 90, "medium": 40 }, "virustotal": { "hash": { "high": 15 } } }
```

The highest provider signal sets the level. Each provider uses its own scale, so the numbers are not compared across providers:

| Provider | Measure | Default thresholds |
|---|---|---|
| VirusTotal | Malicious engine count | IPs/domains: High ≥ 5, Medium ≥ 2. URLs: High ≥ 4, Medium ≥ 2. Hashes: High ≥ 10, Medium ≥ 3. |
| AbuseIPDB | Abuse confidence | High ≥ 75%, Medium ≥ 25%. |
| OTX | Pulse count | Medium ≥ 10, Low ≥ 1. Community pulses alone never make High. |
| URLhaus | Listing | Listed URL or payload = High. Host with online malware URLs = High. Host with only offline history = Medium. |
| GreyNoise | Classification | Malicious scanner = Medium (opportunistic, not targeted). |

**Known limitations of the scoring:**
- **Engine counts lag:** detection counts trail new threats and include false positives.
- **AbuseIPDB scores move:** they decay over time.
- **OTX pulses vary:** pulses are community-curated and of uneven quality.
- **URLhaus host listings:** shared hosting and CDNs can appear because of one malicious URL.
- **Low and Unknown are not safe:** treat the level as a triage aid, never as a verdict to act on automatically. The app never blocks, quarantines or deletes anything.

## Architecture

```
frontend/  React 19 + Vite + Tailwind 4 (single page, served by the backend in production)
backend/
  src/parser/      offline IOC parser (validation, refang, IDN, dedupe, extraction, CSV)
  src/providers/   adapter per provider + allowlisted, timed HTTP client + registry
  src/queue/       LookupQueue: BullMQ (per-provider queue + limiter) | in-memory dev fallback
  src/services/    enrichment (batches, cache, processing, retries, recovery, retention), risk engine, views, exports, audit
  src/models/      Batch, Indicator, EnrichmentResult, AuditEvent, ProviderUsage (MongoDB, indexed)
  src/controllers/ src/routes/ src/middleware/   Express 5 API, validation (Zod), security
docker-compose.yml MongoDB 7 + Redis 7 bound to localhost
```

- **Lookups:** each lookup is an `EnrichmentResult` document. Workers claim it atomically (so a duplicate job can never call a provider twice), then record the outcome.
- **Batch status:** always derived from those lookup documents, so a batch is never reported complete while anything is queued or running.
- **Cached results:** completed results double as the cache.

## Security

- **No authentication yet:** the server binds to `127.0.0.1` and refuses to start on another interface unless `ALLOW_UNAUTHENTICATED_REMOTE=true`. Add authentication before sharing it on a network.
- **API keys:** they exist only in `backend/.env`. They are never sent to the browser, logged or stored in MongoDB, and a test sweeps every endpoint for them.
- **Outbound requests:** https only, to each provider's allowlisted host, with redirects refused and a hard timeout (SSRF guard).
- **Request handling:** Helmet security headers (CSP), per-IP rate limiting, strict request validation, size/type/UTF-8 checks on uploads, and React escaping. Provider links are only rendered when they are `https://`.
- **Logging:** request logs record the method, path and status only, never query strings or bodies.
- **Exports:** CSV cells are protected against spreadsheet formula injection.
- **Audit log:** records actions and counts, never indicator values.

## API

See [docs/API.md](docs/API.md).

## Known limitations and next steps

- **Single user, no login:** batches are attributed to an anonymous browser session cookie. Add authentication and roles before any multi-user deployment.
- **Development fallbacks:** the embedded database and in-process queue are meant for a single analyst on one PC. Use real MongoDB and Redis (`docker compose up -d`) for anything shared.
- **Free-text extraction is heuristic:** for example, real TLDs that look like filenames (`readme.md`) are extracted, but flagged with a note.
- **Ideas for later:** more providers (Shodan, MISP, a self-hosted OpenCTI), a STIX export, batch comparison, and saved filters.
