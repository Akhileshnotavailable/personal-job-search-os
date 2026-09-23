# Personal Job Search OS

A private, single-user job search and interview preparation tool.

Discovers relevant Product Designer / Senior Product Designer openings at target companies as early
as possible, surfaces the referral contacts who can help, generates the outreach message, and
tracks the application through to interviews — in one place, on free infrastructure.

## Status

Phase 0, milestone M0 (foundation). See [`docs/progress.md`](docs/progress.md).

## Stack

Next.js 16 on Cloudflare Workers (`@opennextjs/cloudflare`) · Cloudflare D1 + Drizzle · Python 3.12 crawlers on
GitHub Actions · Cloudflare Access · Gmail SMTP.

There is no Go backend, despite the PRD proposing one — it is incompatible with D1 and free
Cloudflare hosting. See [ADR 002](docs/decisions/002-typescript-on-workers.md).

## Documentation

| Document | Contents |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Persistent context and invariants — start here |
| [`docs/architecture.md`](docs/architecture.md) | System architecture and data flows |
| [`docs/development.md`](docs/development.md) | Local setup and commands |
| [`docs/infrastructure.md`](docs/infrastructure.md) | Cloudflare, Actions, secrets, deployment |
| [`docs/database.md`](docs/database.md) | Schema, relationships, migrations |
| [`docs/api.md`](docs/api.md) | Endpoints, requests, responses, errors |
| [`docs/crawlers.md`](docs/crawlers.md) | Crawler architecture, adding a company or adapter |
| [`docs/matching.md`](docs/matching.md) | What counts as a relevant job, and how to tune it |
| [`docs/deployment-checklist.md`](docs/deployment-checklist.md) | Everything needed to take this live |
| [`docs/engineering-principles.md`](docs/engineering-principles.md) | How this codebase is written |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records |

## Quick start

```bash
# app
cd app && npm install && npm run dev

# crawler
python -m venv .venv && .venv/Scripts/activate   # Windows
pip install -r crawler/requirements.txt
pytest crawler/tests
```

Full setup, including Cloudflare and GitHub configuration, is in
[`docs/development.md`](docs/development.md).

## Cost

Designed to run at $0/month on free tiers. Paid infrastructure is never introduced without explicit
approval (PRD §48).
