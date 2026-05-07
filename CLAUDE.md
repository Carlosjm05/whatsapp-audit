# CLAUDE.md

This file gives Claude Code (claude.ai/code) the persistent context it
needs to be useful in this repository. Written in English because
Claude performs better in English; everything else in the project is
in Spanish (UI, DB enums, logs, docs aimed at humans).

> **Author and rights holder:** Carlos Manuel Jiménez Méndez
> (WhatsApp +57 302 439 6752, carlitos05203rules@gmail.com). Claude
> Code is used here as a productivity tool of the Author. All
> intellectual property remains with the Author. See `LICENSE`.

## Project at a glance

WhatsApp sales-intelligence audit for **Ortiz Finca Raíz** (Colombian
real estate). Extracts ~12,000 conversations, transcribes audio, runs
Claude Sonnet to produce 45+ structured fields per chat, surfaces it
in a Next.js dashboard, and exports a knowledge base to the Dapta
WhatsApp agent platform.

For business context, motivation, and constraints, read
`docs/CONTEXTO_NEGOCIO.md` (Spanish).

## Architecture

Seven-stage pipeline, eight Docker Compose services on an internal
bridge network:

```
WhatsApp → extractor (Node 20 + @whiskeysockets/baileys) → Postgres (raw)
         → transcriber (Python 3.11 + OpenAI Whisper)    → Postgres (enriched)
         → analyzer (Python 3.11 + Claude Sonnet)        → Postgres (final)
         → api (FastAPI) → dashboard (Next.js 14) → nginx + certbot
```

- **`extractor/`** — Connects to WhatsApp via Baileys (no Chromium).
  Daemon mode listens for jobs on Redis (`wa:jobs`); CLI mode also
  available. Session persisted in `extractor_session` volume. Rate
  limits (`EXTRACTION_DELAY_*`, `MEDIA_DELAY_*`) are **load-bearing**
  — see "Never do" below.
- **`transcriber/`** — N parallel workers (`TRANSCRIBER_WORKERS`,
  default 3) pull audio jobs, call Whisper, score confidence, then
  build *unified transcripts* (text + transcribed audio in
  chronological order) for the analyzer.
- **`analyzer/`** — Workers (`ANALYZER_WORKERS`, default 2) call
  Claude. Two-pass: cheap Haiku for triage, Sonnet for full analysis
  on `analizable` chats only. See ADR-0003.
- **`api/`** — FastAPI with JWT auth. Multi-user via `admin_users`
  table; env-based admin as fallback. 13 routers under
  `api/src/routers/` mapping to dashboard panels.
- **`dashboard/`** — Next.js App Router + Tailwind + Recharts.
  Mobile-first because the client (Oscar) reads it on his iPhone.
- **`db/schema.sql`** + `db/indexes.sql` — auto-loaded on first boot.
  Migrations under `db/migrations/` are idempotent and ALSO copied
  into `schema.sql`. See ADR-0006.
- **`nginx/`** + certbot — reverse proxy + Let's Encrypt.

Inter-service coordination uses **Redis** (queues + cache); persistent
state lives in **Postgres**. Shared `./data` bind mount carries raw
JSON/media between extractor → transcriber → analyzer.

## Common commands

`.env` must exist before anything (`cp .env.example .env`). Required
vars: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`.

```bash
# Always-on services
docker compose up -d                                # bring everything except extractor/analyzer
docker compose logs -f api                          # watch a service

# Extractor (profile-gated — won't auto-start)
docker compose --profile extraction up -d extractor
docker compose run --rm extractor npm run test-connection   # CLI mode (stop daemon first)
docker compose run --rm extractor npm run index             # discover + prioritize chats
docker compose run --rm extractor npm run extract -- --batch=500

# Analyzer (profile-gated — costs money)
docker compose --profile analysis up -d analyzer

# Dashboard dev (outside Docker)
cd dashboard && npm install && npm run dev          # local on :3000

# Re-apply SQL schema changes (DESTRUCTIVE — wipes all data)
docker compose down -v && docker compose up -d postgres

# Server bootstrap (DigitalOcean Ubuntu 24.04, run as root)
./setup.sh
```

Full operational procedures: `docs/RUNBOOK.md`.

## Working in this repo

### Always

- **Validate end-to-end with the developer's personal WhatsApp before
  touching the client's account.** Load-bearing project rule.
- When changing the analyzer output contract, update **all five**
  integration points: `analyzer/src/prompt.py`,
  `analyzer/src/validator.py`, `db/schema.sql`, `api/src/schemas.py`,
  `dashboard/types/api.ts`, plus `analyzer/src/knowledge_base.py` if
  the change affects the Dapta export. See `docs/SCHEMA_45_CAMPOS.md`.
- For migrations: idempotent SQL in `db/migrations/NNN_*.sql` AND
  copy the same change to `db/schema.sql`. See ADR-0006.
- Spanish for UI copy, DB enum values, log messages, error responses.
  English for code identifiers, comments where natural, and
  `CLAUDE.md`.

### Never do

These are not stylistic preferences — they have caused real incidents
or carry hard-to-reverse consequences.

- **Never** lower `EXTRACTION_DELAY_*` or `MEDIA_DELAY_*` in the
  extractor. Risk: WhatsApp ban on the client's number.
- **Never** run `docker compose down -v` on production without a
  verified backup. Wipes Postgres volume and Baileys session.
- **Never** commit `.env`, `auth_state/`, or `data/raw/`. Real
  credentials and PII.
- **Never** edit `db/schema.sql` without also producing an idempotent
  migration in `db/migrations/`. Existing installs need both.
- **Never** activate the `extractor` or `analyzer` profile without
  intent. They cost money or carry ban risk; both are profile-gated
  on purpose (ADR-0004).
- **Never** push secrets to `NEXT_PUBLIC_*` vars in the dashboard.
  They get inlined into the client bundle.
- **Never** use `--no-verify` on commits. Pre-commit hooks exist for
  reasons.
- **Never** generate `INSERT`s with f-strings concatenating user
  input. All API routers use `%s` parametrized queries — keep that
  invariant.

### Before changing X, read Y

| Changing | Read first |
|----------|------------|
| `analyzer/src/prompt.py` | `docs/SCHEMA_45_CAMPOS.md` + ADR-0003 |
| `db/schema.sql` or any migration | `db/migrations/README.md` + ADR-0006 |
| Anything in `extractor/` | ADR-0001 + the rate-limit comments in `.env.example` |
| Auth flow (`api/src/auth.py`, `cli_users.py`) | ADR-0002 |
| `docker-compose.yml` profiles | ADR-0004 |
| Index/extract workflow | ADR-0005 |
| Anything that touches PII (phone numbers, names, message bodies) | `docs/PRIVACIDAD.md` |

### Dangerous commands

Confirm with the user before running any of these:

- `docker compose down -v` — wipes volumes
- `git push --force` — overwrites remote history
- `git rebase -i` — interactive editor not supported by this harness
- `UPDATE leads SET analysis_status='pending' WHERE ...` mass — costs
  real money in Claude calls
- `rm -rf data/` — no backup of audio files

## Audit history

- `docs/audits/2026-04-16-auditoria-inicial.md` — initial 11-phase
  remediation, mostly executed.
- `docs/audits/2026-05-06-auditoria-completa.md` — current findings,
  pending application.

When applying audit fixes, update the corresponding entry in
`CHANGELOG.md` and mark the phase as closed in the audit document.

## Commit attribution

The Author (Carlos Manuel Jiménez Méndez) is the sole intellectual
author of this codebase. When you (Claude Code) generate commits in
this repo:

- **Do not** add `Co-Authored-By: Claude` or any line that implies
  co-authorship to Anthropic / Claude. Claude Code is a productivity
  tool of the Author, not a co-author.
- The commit's author and committer are the human user (the Author);
  Claude Code does not append itself.
- Older commits in `git log` may still contain `Co-Authored-By: Claude`
  lines from earlier sessions. Those are residual and have been
  clarified in `docs/audits/2026-04-16-auditoria-inicial.md` — do not
  rewrite history to remove them unless the user explicitly asks.
- If the user wants any kind of AI-tool acknowledgement, it goes only
  in two visible places: a discreet footer in `README.md` and a
  blockquote at the top of this `CLAUDE.md`. Nowhere else.
