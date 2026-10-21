# Threat Intel Hub

Bulk IOC triage for SOC teams. Paste hundreds of IPs, hashes, domains and URLs, or upload a TXT/CSV file. Threat Intel Hub validates, refangs and deduplicates them, then enriches every indicator across **VirusTotal, AbuseIPDB, AlienVault OTX and URLhaus** in one batch, with an explainable risk level for each.

## Features

| Area | What you get |
|---|---|
| **Input** | Paste text or drag-and-drop `.txt`/`.csv` files. Two modes: one indicator per line, or extraction from free text such as emails and reports. A live preview shows total, valid, invalid, duplicate and kept-local counts. |
| **Parsing** | IPv4, IPv6, MD5, SHA-1, SHA-256, domains (including IDN/punycode) and http(s) URLs. Refangs `hxxp`, `[.]` and `(dot)`. Normalizes strictly without merging distinct indicators, and keeps source line numbers. Fully offline. |
| **Safety** | Private/reserved IPs and internal domains are never sent to providers. Flags homograph domains, invisible characters, credentials embedded in URLs, and numeric-host tricks. Every batch requires an explicit third-party-sharing confirmation. |
| **Providers** | Read-only lookups: nothing is ever uploaded or submitted for analysis. Each provider gets its own rate limit, concurrency, timeout, exponential-backoff retries, `Retry-After`/HTTP 429 handling and a persistent daily-quota guard. |
| **Honest results** | A provider either has a record or it doesn't. Timeouts, auth failures, quota exhaustion and provider errors are reported as such and never counted as clean. |
| **Risk** | High / Medium / Low / Unknown, from per-provider, per-indicator-type rules that you can configure. Every level lists its reasons. Disagreement between providers is called out explicitly. |
| **Batches** | Background queue (BullMQ on Redis, or in-process) with live progress, per-provider ETAs, cancel, retry one or all failed lookups, and automatic resume after a restart. Fresh results are cached for 24 h by default. |
| **Dashboard** | Metrics, per-provider progress, and a results table filterable by risk, type, provider, status and disagreement, with search, sort and pagination. A detail panel shows every provider's evidence, tags, references and permalinks. |
| **Exports** | CSV (one row per indicator × provider, protected against formula injection, Excel-friendly UTF-8) and JSON. |
| **Team** | Accounts with **admin** and **analyst** roles. Analysts see the whole team's batches but can only change their own. Admins manage the team, view the audit log, test provider keys and can delete history. |
| **Governance** | An audit log of who did what (sign-ins, batches, exports, retries, user changes). Data is purged automatically after 30 days by default. |

## Architecture

```
Browser ──> Vercel (React SPA, /api/* rewrite) ──> Render (Node.js API + queue workers) ──> MongoDB Atlas
                                                              │
                                                              └──> VirusTotal · AbuseIPDB · OTX · URLhaus
```

```
frontend/         React 19 + Vite + Tailwind CSS 4
  vercel.json     Vercel build, /api proxy rewrite, security headers
backend/
  src/parser/     offline IOC parser (validation, refang, IDN, dedupe, extraction, CSV)
  src/providers/  one adapter per provider; allowlisted, timed HTTP client; registry
  src/queue/      BullMQ (one queue + rate limiter per provider) or in-process queue
  src/services/   enrichment, risk engine, auth, exports, audit, retention
  src/models/     Batch, EnrichmentResult, Indicator, User, Session, AuditEvent, ProviderUsage
render.yaml       Render Blueprint for the API
docker-compose.yml MongoDB + Redis for local development
```

## Deploy (Vercel + Render + MongoDB Atlas)

All three services have free tiers. Do the steps in this order.

### 1. Database: MongoDB Atlas

1. Create a free account at <https://www.mongodb.com/cloud/atlas/register> and create an **M0 (free)** cluster. AWS Singapore is a good region if you are in South Asia.
2. Go to **Database Access** → **Add database user** and create a user with a strong password. This password is separate from your app login.
3. Go to **Network Access** → **Add IP address** → **Allow access from anywhere** (`0.0.0.0/0`). Render's free plan has no fixed IP; access is still protected by the database password.
4. Go to **Connect** → **Drivers** and copy the connection string. Add a database name before the `?`, like this:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/threat_intel_hub?retryWrites=true&w=majority`

### 2. Backend: Render

1. Sign in at <https://render.com> with GitHub.
2. Go to **New** → **Blueprint**, pick this repository, and click **Apply**. Render reads `render.yaml`.
3. Render prompts for the secret values:

| Variable | Value |
|---|---|
| `MONGODB_URI` | The Atlas connection string from step 1. |
| `ALLOWED_ORIGINS` | Your Vercel URL, e.g. `https://threatorbit.vercel.app`. If you don't know it yet, leave it empty and come back after step 3. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Your first admin login. The password needs 12+ characters. |
| `VIRUSTOTAL_API_KEY`, `ABUSEIPDB_API_KEY`, `OTX_API_KEY`, `URLHAUS_AUTH_KEY` | Your provider keys. |

4. Wait for the deploy to finish, then open `https://<your-service>.onrender.com/api/health`. It should show `{"data":{"status":"ok",...}}`.
5. Copy the service URL. If the name `threatorbit-api` was free, it is `https://threatorbit-api.onrender.com`.

The free plan sleeps after 15 minutes without traffic, and the first request after that takes about 30 seconds while it wakes up. Unfinished lookups resume automatically when it wakes. For an always-on service, switch the plan to Starter.

### 3. Frontend: Vercel

1. If your Render URL is **not** `https://threatorbit-api.onrender.com`, edit `frontend/vercel.json`, put your URL in the `/api/:path*` rewrite, and commit the change.
2. Sign in at <https://vercel.com> with GitHub and go to **Add New** → **Project** → import this repository.
3. Set **Root Directory** to `frontend`. The build settings come from `frontend/vercel.json`, so leave them as they are. Click **Deploy**.
4. Copy your site URL, e.g. `https://threatorbit.vercel.app`. On Render, set `ALLOWED_ORIGINS` to that URL; Render redeploys automatically.

### 4. First sign-in

1. Open your Vercel URL and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Open **Providers** and click **Test key** on each provider. Each should say *Key works*.
3. Open **Team** → **Add member** to create accounts for your teammates. Share their temporary passwords privately; they can change them from the profile menu.
4. You can now remove `ADMIN_PASSWORD` from Render if you like. It is only used while no users exist.

Every later `git push` to the deployed branch redeploys both services automatically.

## Local development

```bash
# Node.js 22.12+
npm install
cp backend/.env.example backend/.env   # set ADMIN_EMAIL, ADMIN_PASSWORD and your provider keys
docker compose up -d                   # optional: MongoDB + Redis. Without it a local MongoDB starts automatically
npm run dev                            # API on :4000, UI with hot reload on http://127.0.0.1:5173
```

| Command | Purpose |
|---|---|
| `npm run build && npm start` | Production build: UI and API together on <http://127.0.0.1:4000>. |
| `npm test` | Automated test suite. Provider calls are mocked, and the database and queue are real. |
| `npm run typecheck` | TypeScript checks for both packages. |
| `npm run format` | Prettier. |

The first `npm test` downloads a MongoDB binary for the test database. To use an existing one, set `MONGOMS_SYSTEM_BINARY`.

## Configuration

Every setting is an environment variable. See [`backend/.env.example`](backend/.env.example) for the full list with defaults. The ones that matter most in production:

| Variable | Purpose |
|---|---|
| `NODE_ENV=production` | Secure (HTTPS-only) cookies, and no embedded database fallback. |
| `MONGODB_URI` | MongoDB connection string. |
| `REDIS_URL` + `QUEUE_MODE=bullmq` | Optional Redis (e.g. Upstash) for a durable job queue. The default `memory` queue resumes from MongoDB after a restart. |
| `TRUST_PROXY` | Number of proxies in front of the app: `2` behind Vercel → Render. |
| `ALLOWED_ORIGINS` | Your site URL(s), for the cross-site request check. |
| `SESSION_TTL_HOURS` | How long a sign-in lasts. Default 12. |
| `RETENTION_DAYS` / `AUDIT_RETENTION_DAYS` | Automatic data purge. Defaults are 30 and 180. |
| `<PROVIDER>_REQUESTS_PER_MINUTE` / `<PROVIDER>_DAILY_LIMIT` | Raise these for paid API plans. |
| `PROVIDERS_DISABLED` | Switch providers off, e.g. `otx,urlhaus`. |

## Providers

| Provider | Indicator types | Default limits (free tier) | Get a key |
|---|---|---|---|
| VirusTotal | IPv4, IPv6, domain, URL, MD5, SHA-1, SHA-256 | 4/min, 500/day | <https://www.virustotal.com/gui/my-apikey> |
| AbuseIPDB | IPv4, IPv6 | 30/min, 1,000/day | <https://www.abuseipdb.com/account/api> |
| AlienVault OTX | IPv4, IPv6, domain, URL, MD5, SHA-1, SHA-256 | 30/min | <https://otx.alienvault.com/api> |
| URLhaus | URL, domain, IPv4, MD5, SHA-256 | 30/min | <https://auth.abuse.ch/> |

A provider without a key shows as *unconfigured* and is never called.

## Risk rules

The defaults live in `backend/src/config/riskRules.ts`. To override any part, point `RISK_RULES_PATH` at a JSON file, e.g. `{ "abuseipdb": { "high": 90 } }`. The highest provider signal sets the level, and each provider keeps its own scale:

| Provider | Measure | Default thresholds |
|---|---|---|
| VirusTotal | Malicious engine count | IPs/domains: High ≥ 5, Medium ≥ 2. URLs: High ≥ 4, Medium ≥ 2. Hashes: High ≥ 10, Medium ≥ 3. |
| AbuseIPDB | Abuse confidence | High ≥ 75%, Medium ≥ 25%. |
| OTX | Pulse count | Medium ≥ 10, Low ≥ 1. Pulses alone never make High. |
| URLhaus | Listing | Listed URL or payload = High. Host with online malware = High. Host with offline history only = Medium. |

**How to read the levels:**
- **Low** means providers have a record and none flag it significantly. It is not a guarantee of safety.
- **Unknown** means there is no usable evidence.
- **Triage only:** the app never blocks, quarantines or deletes anything on its own.

## Security

- **Sign-in:**
  - Passwords are hashed with scrypt.
  - Sessions are server-side; the session token lives in an httpOnly, `Secure`, `SameSite=Lax` cookie (with the `__Host-` prefix over HTTPS), and only its hash is stored in the database.
  - Accounts lock for 15 minutes after 5 failed sign-ins, and sign-in is also rate-limited per IP.
  - A password reset, deactivation or role change signs the user out everywhere.
- **Authorization:** every API route except health and sign-in requires a session. Admin-only routes are enforced on the server, not just hidden in the UI.
- **Cross-site requests:** state-changing requests from other origins are rejected, on top of the SameSite cookie protection.
- **Provider keys:** they exist only as server environment variables. They are never sent to the browser, logged or stored, and a test sweeps every endpoint for them.
- **Outbound requests (SSRF guard):** https only, to each provider's allowlisted host, with redirects refused and a hard timeout.
- **Browser hardening:** a strict Content-Security-Policy and security headers on both Vercel and the API, request validation (Zod), checks on upload size, type and encoding, and React escaping. Provider links are only rendered when they are `https://`.
- **Logs and exports:** request logs record only the method, path and status, never query strings or bodies. CSV exports are protected against formula injection. The audit log never records indicator values.

## API

See [docs/API.md](docs/API.md).
