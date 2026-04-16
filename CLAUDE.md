# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

WhatsApp sales-intelligence audit system for **Ortiz Finca Raíz** (Colombian real estate). Pipeline extracts ~12,000 WhatsApp conversations, transcribes audio, runs Claude-based analysis to produce 45+ structured data points per chat, and surfaces the results in a 7-panel dashboard. Data is also exported as a knowledge base for the Dapta WhatsApp agent platform. `CONTEXT.md` has the full domain spec including the 45+-field extraction schema — read it before changing analyzer prompts or DB schema.

All UI copy, DB column names, enum values, and log messages are in **Spanish**. Preserve that convention.

## Architecture

Seven-stage pipeline, orchestrated via `docker-compose.yml` (8 services on an internal bridge network):

```
WhatsApp → extractor (Node/Baileys) → Postgres (raw)
         → transcriber (Python/Whisper API)  → Postgres (enriched)
         → analyzer (Python/Claude Sonnet)   → Postgres (final)
         → api (FastAPI) → dashboard (Next.js) → nginx+certbot
```

- **`extractor/`** — Node 20 + `@whiskeysockets/baileys` (no Chromium). Connects via WebSocket protocol directly. Uses `syncFullHistory: true` + `Browsers.macOS('Desktop')` for max history on initial sync. Session is persisted in the `extractor_session` volume (`/app/auth_state`) — deleting it forces a new QR scan. Rate-limited (`EXTRACTION_DELAY_*`, `MEDIA_DELAY_*` env vars). Writes raw JSON to `./data` volume + rows in Postgres. Checkpoints allow resume per-chat on crash.
- **`transcriber/`** — Python 3.11. N parallel workers (`TRANSCRIBER_WORKERS`, default 3) pull audio jobs via Redis, call OpenAI Whisper, score confidence (`CONFIDENCE_THRESHOLD`, default 0.80), then build *unified transcripts* (text + transcribed audio in chronological order) that the analyzer consumes.
- **`analyzer/`** — Python 3.11. Workers (`ANALYZER_WORKERS`, default 2) call Claude (`CLAUDE_MODEL`, default `claude-sonnet-4-20250514`) with the prompt in `analyzer/src/prompt.py`; `validator.py` enforces the JSON shape of the 45+-field output before writing back. `knowledge_base.py` produces the Dapta export.
- **`api/`** — FastAPI. JWT auth (single admin user, `ADMIN_USER`/`ADMIN_PASSWORD`). Routers under `api/src/routers/` map 1:1 to the dashboard panels: `overview`, `leads`, `advisors`, `product_intel`, `errors`, `competitors`, `knowledge_base`, plus `export` (CSV/JSON).
- **`dashboard/`** — Next.js 14 (App Router) + Tailwind + Recharts. One route per panel under `app/` matching the API routers. Reads `NEXT_PUBLIC_API_URL`.
- **`db/schema.sql`** + **`db/indexes.sql`** — 20+ tables auto-loaded by the postgres container on first boot (`/docker-entrypoint-initdb.d/`). To re-apply after changes you must drop the `postgres_data` volume.
- **`nginx/`** + **certbot** service — reverse proxy with Let's Encrypt auto-renewal.

Inter-service coordination uses **Redis** (queues + cache); persistent state lives in **Postgres**. The shared `./data` bind mount carries raw JSON/media between extractor → transcriber → analyzer.

## Common commands

Copy `.env.example` → `.env` before anything. Required vars: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`.

```bash
# Full stack
docker compose up -d postgres redis        # bring deps up first
docker compose up -d                        # then everything
docker compose logs -f extractor            # watch QR / extraction progress
docker compose down                         # stop (keeps volumes)
docker compose down -v                      # wipe volumes — forces schema re-init + new QR

# Extractor (must see QR on first run)
docker compose run --rm extractor npm run test-connection
docker compose run --rm extractor npm run extract
docker compose run --rm extractor npm run stats

# Dashboard dev
cd dashboard && npm install && npm run dev  # local dev on :3000
cd dashboard && npm run lint
cd dashboard && npm run build

# Re-apply SQL schema changes (destructive — loses all data)
docker compose down -v && docker compose up -d postgres

# Server bootstrap (DigitalOcean Ubuntu 24.04, run as root)
./setup.sh
```

## Working in this repo

- **Always validate end-to-end with the developer's personal WhatsApp before touching the client's account.** This is an explicit, load-bearing project rule (`CONTEXT.md`).
- `schema.sql` runs only on a fresh `postgres_data` volume. Migrations must either be idempotent `ALTER`s added to a new file in `db/` and applied manually, or require a volume wipe — pick deliberately.
- The analyzer's 45+-field JSON contract is the integration point between analyzer → API → dashboard → Dapta export. Any change to `analyzer/src/prompt.py` output shape must be reflected in `analyzer/src/validator.py`, the relevant `db/schema.sql` columns, the API schemas, the dashboard types, and `knowledge_base.py`.
- Rate-limit delays in the extractor are not cosmetic — lowering them risks a WhatsApp ban on the client's number.
