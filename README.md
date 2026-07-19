# COMMAND AI OS

Production release candidate for a white-label, multi-tenant AI receptionist and business-operations platform.

The system replaces the original browser-only simulation with authenticated server-side AI, PostgreSQL persistence, approved-knowledge retrieval, conversation memory, tool-controlled appointment booking, human escalation, embedded web chat, Twilio voice/SMS webhooks, Stripe subscription billing, HighLevel synchronization, audit logs, usage accounting, and release-readiness checks.

## Core reliability model

The agent is not allowed to improvise business facts. For each turn it:

1. Retrieves tenant- and agent-scoped approved knowledge.
2. Adds structured business hours and emergency rules.
3. moderates high-risk input.
4. Calls server-side tools for availability, booking, contact capture, or human handoff.
5. Produces a strict structured response with confidence and citations.
6. Rejects citations that were not actually retrieved.
7. forces a handoff when factual or pricing claims are unsupported or below the configured confidence threshold.
8. stores the conversation, tool results, handoff state, and provider usage.

When OpenAI is not configured or a tenant remains in simulation mode, a deterministic grounded fallback answers only from approved knowledge and structured business data.

## Included production capabilities

- Secure Argon2id administrator authentication, HTTP-only sessions, CSRF protection, role checks, tenant scoping, and encrypted integration secrets
- PostgreSQL migrations and idempotent first-owner bootstrap
- Grounded OpenAI Responses API orchestration with moderation, strict JSON Schema output, tools, citation validation, and `store=false` support
- Knowledge ingestion from text, PDF, TXT, Markdown, CSV, and JSON with lexical and embedding retrieval
- Appointment availability, conflict prevention, contact capture, booking, and human handoff tools
- Public embeddable chat widget with origin allowlisting and rate limits
- Twilio inbound SMS and speech-driven phone handling with signature verification, STOP handling, transfer, and conversation persistence
- Stripe Checkout, Billing Portal, webhook verification, duplicate-event protection, and client subscription state
- Encrypted HighLevel tenant configuration, connection testing, contact upsert, and appointment sync
- White-label dashboard for prospects, clients, agents, knowledge, inbox, billing, integrations, and release readiness
- Security headers, request limits, structured redacted logs, health checks, graceful shutdown, audit trails, and webhook idempotency
- Docker, Docker Compose, Render blueprint, GitHub Actions CI, automated migrations, tests, and deployment documentation

## Local release validation

Requirements: Node.js 22+ and PostgreSQL 16+.

```bash
cp .env.example .env
# Fill DATABASE_URL, SESSION_PEPPER, INTEGRATION_ENCRYPTION_KEY,
# ADMIN_EMAIL, and ADMIN_PASSWORD.
node scripts/materialize-source.cjs
npm ci
npm run bootstrap
npm test
npm run check
npm start
```

Open `http://localhost:4173`.

Docker-based setup:

```bash
cp .env.example .env
docker compose up --build
```

## First deployment sequence

1. Provision PostgreSQL with backups enabled.
2. Create independent high-entropy `SESSION_PEPPER` and `INTEGRATION_ENCRYPTION_KEY` values.
3. Set `ADMIN_EMAIL` and a unique 12+ character `ADMIN_PASSWORD` for the first seed.
4. Set `APP_URL` to the final HTTPS origin and enable secure cookies.
5. Deploy and confirm `/healthz`, `/readyz`, login, knowledge retrieval, agent tests, and widget tests.
6. Add `OPENAI_API_KEY`, set accurate model cost rates, and disable tenant simulation mode only after the live evaluation passes.
7. Add Twilio, Stripe, and HighLevel credentials and configure their webhooks from `docs/PROVIDER_SETUP.md`.
8. Remove `ADMIN_PASSWORD` from the host after the owner account exists.
9. Complete every item in `docs/RELEASE_CHECKLIST.md` before onboarding paying customers.

## Repository map

```text
migrations/       PostgreSQL schema
src/ai/           Retrieval, moderation, orchestration, tools, fallback
src/routes/       Authenticated API, public widget, provider webhooks
src/integrations/ Stripe and HighLevel adapters
public/           Operator dashboard and embeddable chat widget
scripts/          Migrations, bootstrap seed, release checks, live AI eval
tests/            Security, API, grounding, and widget tests
docs/             Architecture, deployment, providers, operations, release gate
```

## Scope at release candidate

The code is ready for a production host. Live provider behavior still depends on valid customer-owned accounts, credentials, approved phone numbers, Stripe products/prices, webhook registration, privacy/terms pages, and the laws and consent requirements applicable to each deployed business and jurisdiction.
