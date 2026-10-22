<p align="center">
  <img src="docs/assets/logo.png" alt="ThreatOrbit" width="120" />
</p>

<h1 align="center">ThreatOrbit</h1>

<p align="center">
  Bulk indicator-of-compromise enrichment and triage for security operations teams.
</p>

<p align="center">
  <a href="https://threatorbit.vercel.app"><img alt="Live" src="https://img.shields.io/badge/live-threatorbit.vercel.app-000000?style=flat-square" /></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-000000?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-000000?style=flat-square&logo=react&logoColor=white" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-000000?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-000000?style=flat-square&logo=mongodb&logoColor=white" />
  <img alt="Vercel" src="https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white" />
</p>

---

## Overview

ThreatOrbit takes a raw list of indicators (IP addresses, file hashes, domains and URLs), cleans it, and enriches every indicator against several threat intelligence providers in a single batch. Each indicator receives a risk level together with the evidence and reasoning behind it, so an analyst can triage hundreds of indicators in minutes instead of checking them one by one.

Supported providers: **VirusTotal**, **AbuseIPDB**, **AlienVault OTX** and **URLhaus**.

## Contents

- [Capabilities](#capabilities)
- [Architecture](#architecture)
- [Deployment](#deployment)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Providers](#providers)
- [Risk model](#risk-model)
- [Security](#security)
- [API reference](#api-reference)

## Capabilities

### Input and parsing

- Paste text or upload `.txt` / `.csv` files.
- **List mode** accepts one indicator per line or several per line separated by commas, semicolons, pipes or spaces. For example, `66.132.195.29,65.20.149.239,202.150.138.15` becomes three indicators. A line that is valid as a whole, such as a URL with commas in its query string, is kept intact.
- **Extraction mode** pulls indicators out of free text such as emails, tickets and reports.
- Supported types: IPv4, IPv6, MD5, SHA-1, SHA-256, domains (including internationalized domains) and HTTP(S) URLs.
- Defanged values are restored automatically (`hxxp`, `[.]`, `(dot)` and similar).
- Strict normalization and deduplication, with source line numbers preserved.
- A live preview reports total, valid, invalid, duplicate and local-only counts before anything is sent to a provider.
- Parsing runs entirely offline.

### Enrichment

- Read-only lookups. Nothing is uploaded or submitted for analysis.
- Each provider has its own rate limit, concurrency, timeout, exponential back-off, `Retry-After` handling and a persistent daily quota guard.
- Fresh results are cached (24 hours by default) and reused across batches.
- Batches show live progress per provider and support cancel, retry of one or all failed lookups, and automatic resume after interruption.

### Analysis and reporting

- Risk levels of High, Medium, Low or Unknown, each with the reasons that produced it.
- Disagreement between providers is detected and flagged.
- Timeouts, authentication failures, exhausted quotas and provider errors are reported as such and are never treated as a clean result.
- Results table with filtering by risk, type, provider, status and disagreement, plus search, sorting and pagination.
- Detail panel with full evidence, tags, references and provider permalinks.
- CSV and JSON export.

### Interface

- Designed for desktop, Windows laptops, tablets and phones: a sidebar on large screens, a top bar with bottom tabs on small ones, and result tables that become tappable cards on a phone.
- Light and dark themes, following the device by default, with a manual switch.
- Keyboard accessible, with visible focus, large touch targets and reduced-motion support.

### Plain-English explanations

- Optional. One click turns the results into a short explanation written for people who are not security experts: what was found, why it matters and what to do next.
- Available for a whole batch (summary plus the most serious indicators) and for any single indicator.
- Works with Google Gemini (free tier available) or Anthropic Claude. An administrator pastes the key on the Sources page; it is checked, then stored in the database.
- Only indicators and what the services said about them are sent; batch labels and user details are not.
- Saved with the batch, marked when new results make them out of date, capped per day, and never able to change the risk level.

### Team and governance

- Accounts with **admin** and **analyst** roles.
- Analysts see the whole team's batches and can change only their own. Admins manage users, review the audit log, test provider keys and manage history.
- Audit log of sign-ins, batches, exports, retries and user changes.
- Automatic data retention (30 days by default).

### Safety controls

- Private and reserved IP ranges and internal domains are never sent to providers.
- Homograph domains, invisible characters, embedded URL credentials and numeric host tricks are flagged.
- Every batch requires explicit confirmation before indicators are shared with third parties.

## Architecture

```
Browser
   |
   v
Vercel
   |-- Static React application
   |-- /api/*  Node.js serverless function (Express)
                  |-- MongoDB Atlas  (data, queue, rate limits, sessions)
                  |-- VirusTotal, AbuseIPDB, AlienVault OTX, URLhaus
```

- **Single origin.** The API runs as a Vercel serverless function on the same domain as the web application.
- **Database-backed queue.** Serverless platforms have no long-running workers, so lookups are stored in MongoDB and processed in short, bounded bursts. Bursts are driven by an open batch page and, optionally, by an external scheduler.
- **Shared throttling.** Rate limits, back-off and daily quotas are coordinated through the database and hold across all function instances.
- **Self-hosting.** The same codebase runs as a conventional long-running server with BullMQ on Redis, or with an in-process queue.

### Repository layout

```
frontend/                 React 19, Vite, Tailwind CSS 4
backend/
  src/parser/             Offline indicator parser (validation, refanging, IDN, deduplication, extraction, CSV)
  src/providers/          Provider adapters, allowlisted HTTP client, registry
  src/queue/              Database queue (serverless), BullMQ, in-process queue
  src/services/           Enrichment, risk engine, authentication, exports, audit, retention
  src/models/             MongoDB models
  src/serverless.ts       Vercel function entry point
  src/server.ts           Long-running server entry point
scripts/build-vercel.mjs  Vercel build (static site and bundled API function)
docs/API.md               HTTP API reference
vercel.json               Vercel project settings
docker-compose.yml        MongoDB and Redis for local development
```

## Deployment

ThreatOrbit deploys to **Vercel** with **MongoDB Atlas**. Both offer free tiers that do not require a payment card.

### 1. Database

1. Create a free **M0** cluster at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas/register).
2. Under **Database Access**, create a database user with a generated password.
3. Under **Network Access**, allow access from anywhere (`0.0.0.0/0`). Vercel functions do not have fixed IP addresses; access remains protected by the database credentials.
4. Under **Connect > Drivers**, copy the connection string, insert the password, and add a database name before the `?`:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/threat_intel_hub?retryWrites=true&w=majority
   ```

### 2. Application

1. Sign in to [vercel.com](https://vercel.com) with GitHub, choose **Add New > Project** and import this repository.
2. Keep the repository root as the **Root Directory** and **Other** as the **Framework Preset**. Build settings are read from `vercel.json`.
3. Add the following **Environment Variables**:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | Connection string from step 1 |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | First administrator account (password of at least 12 characters) |
   | `VIRUSTOTAL_API_KEY`, `ABUSEIPDB_API_KEY`, `OTX_API_KEY`, `URLHAUS_AUTH_KEY` | Provider API keys |
   | `CRON_SECRET` (optional) | Random string of at least 16 characters, used for background processing |
   | `ANTHROPIC_API_KEY` (optional) | Not needed for Gemini. Plain-English explanations are normally switched on from the Sources page after signing in |

4. Select **Deploy**, then open the site and sign in.
5. Open **Providers** and run **Test key** for each provider, then add team members under **Team**.

Every push to `main` triggers a new production deployment.

### 3. Batch processing

While a batch page is open, the browser requests the next round of lookups roughly every 1.5 seconds. Provider rate limits are always respected; on the VirusTotal free tier (4 requests per minute) a large batch takes time to complete. If every batch page is closed, processing pauses and resumes when the batch is opened again.

### 4. Background processing (optional)

To keep batches running with no page open, configure a free scheduler such as [cron-job.org](https://cron-job.org):

| Setting | Value |
|---|---|
| URL | `https://<your-domain>/api/cron/tick` |
| Schedule | Every minute |
| Header | `Authorization: Bearer <CRON_SECRET>` |

`CRON_SECRET` must be set in Vercel and the project redeployed first.

## Local development

Requirements: Node.js 22.12 or later. Docker is optional.

```bash
npm install
cp backend/.env.example backend/.env    # set ADMIN_EMAIL, ADMIN_PASSWORD and provider keys
docker compose up -d                    # optional: MongoDB and Redis
npm run dev                             # API on :4000, UI on http://127.0.0.1:5173
```

Without Docker, a local MongoDB instance starts automatically for development.

| Command | Description |
|---|---|
| `npm run dev` | API and UI with hot reload |
| `npm run build && npm start` | Production build served on http://127.0.0.1:4000 |
| `npm test` | Test suite (providers mocked; database and queue are real) |
| `npm run typecheck` | TypeScript checks for both packages |
| `npm run format` | Code formatting with Prettier |
| `npm run build:vercel` | Build the Vercel output locally |

The first test run downloads a MongoDB binary. Set `MONGOMS_SYSTEM_BINARY` to use an existing installation.

## Configuration

All settings are environment variables. [`backend/.env.example`](backend/.env.example) lists every option with its default. The most relevant in production:

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `QUEUE_MODE` | `database` on Vercel (set automatically). Self-hosted `auto` uses BullMQ when `REDIS_URL` is reachable, otherwise an in-process queue |
| `CRON_SECRET` | Enables `/api/cron/tick` for an external scheduler |
| `TICK_BUDGET_MS` | Processing time per queue tick (default 20 seconds) |
| `TRUST_PROXY` | Number of proxies in front of the application (set automatically on Vercel) |
| `ALLOWED_ORIGINS` | Additional origins allowed to make state-changing requests |
| `SESSION_TTL_HOURS` | Session lifetime (default 12 hours) |
| `RETENTION_DAYS`, `AUDIT_RETENTION_DAYS` | Data retention (defaults 30 and 180 days) |
| `<PROVIDER>_REQUESTS_PER_MINUTE`, `<PROVIDER>_DAILY_LIMIT` | Raise for paid provider plans |
| `PROVIDERS_DISABLED` | Comma-separated providers to disable, for example `otx,urlhaus` |
| `ANTHROPIC_API_KEY` | Optional fallback for Claude. A key saved on the Sources page (Gemini or Claude) takes priority |
| `AI_MODEL` | Model for the `ANTHROPIC_API_KEY` fallback: `claude-opus-5-5` (default), `claude-sonnet-5-5` or `claude-haiku-5-5` |
| `AI_DAILY_LIMIT` | New explanations per UTC day for the whole team (default 100). Saved ones are free |

## Providers

| Provider | Indicator types | Default limits (free tier) | API key |
|---|---|---|---|
| VirusTotal | IPv4, IPv6, domain, URL, MD5, SHA-1, SHA-256 | 4 per minute, 500 per day | [virustotal.com](https://www.virustotal.com/gui/my-apikey) |
| AbuseIPDB | IPv4, IPv6 | 30 per minute, 1,000 per day | [abuseipdb.com](https://www.abuseipdb.com/account/api) |
| AlienVault OTX | IPv4, IPv6, domain, URL, MD5, SHA-1, SHA-256 | 30 per minute | [otx.alienvault.com](https://otx.alienvault.com/api) |
| URLhaus | URL, domain, IPv4, MD5, SHA-256 | 30 per minute | [auth.abuse.ch](https://auth.abuse.ch/) |

A provider without a key is shown as unconfigured and is never called.

## Risk model

Default rules are defined in `backend/src/config/riskRules.ts` and can be overridden by pointing `RISK_RULES_PATH` at a JSON file, for example `{ "abuseipdb": { "high": 90 } }`. The strongest provider signal determines the level, and each provider is assessed on its own scale.

| Provider | Measure | Default thresholds |
|---|---|---|
| VirusTotal | Malicious engine count | IPs and domains: High at 5, Medium at 2. URLs: High at 4, Medium at 2. Hashes: High at 10, Medium at 3 |
| AbuseIPDB | Abuse confidence score | High at 75%, Medium at 25% |
| AlienVault OTX | Pulse count | Medium at 10, Low at 1. Pulses alone never produce High |
| URLhaus | Listing status | Listed URL or payload: High. Host with active malware: High. Host with historical listings only: Medium |

- **Low** means providers hold records and none flag the indicator significantly. It is not a guarantee of safety.
- **Unknown** means no usable evidence was returned.
- ThreatOrbit is a triage tool. It never blocks, quarantines or deletes anything.

## Security

| Area | Controls |
|---|---|
| Authentication | scrypt password hashing; server-side sessions storing only token hashes; `httpOnly`, `Secure`, `SameSite=Lax` cookies with the `__Host-` prefix; account lockout after 5 failed attempts; per-IP sign-in rate limiting; sessions revoked on password reset, deactivation or role change |
| Authorization | Every route except health and sign-in requires a session. Role checks are enforced server-side |
| Request integrity | Cross-origin state-changing requests are rejected in addition to SameSite protection |
| Secrets | Provider keys exist only as server environment variables and are never sent to the browser, logged or stored. Automated tests verify this across all endpoints |
| Outbound requests | HTTPS only, restricted to each provider's allowlisted host, redirects refused, hard timeouts |
| Application hardening | Strict Content Security Policy and security headers, schema validation on every request, upload size, type and encoding checks |
| AI explanations | Opt-in, behind sign-in, capped per day. The key is set by administrators only, checked with the provider before saving, and never sent back to the browser (only its last four characters). Outside-service text is passed as quoted data and the reply is validated against a schema, so a hostile indicator cannot steer the model or add entries. Output is rendered as plain text |
| Data handling | Request logs exclude query strings and bodies; CSV exports are protected against formula injection; the audit log never records indicator values |

## API reference

The full HTTP API is documented in [docs/API.md](docs/API.md).
