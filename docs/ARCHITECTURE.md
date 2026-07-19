# Architecture

## Request boundaries

The browser dashboard never receives provider secrets. It authenticates with an HTTP-only session cookie and uses a per-session CSRF token for writes. Every authenticated query is scoped to the active tenant.

Public widget traffic uses a high-entropy agent token, optional origin allowlisting, and an independent rate limit. Provider webhooks bypass browser CSRF but require provider signatures or a configured shared secret.

## AI turn lifecycle

1. Resolve tenant, client, agent, channel, policy, and recent conversation history.
2. Normalize and redact obvious secrets from customer input.
3. Retrieve only ready knowledge chunks belonging to the client and either shared with all client agents or explicitly scoped to the active agent.
4. Run input moderation. High-risk safety content immediately creates a human escalation.
5. In live mode, send trusted instructions, recent history, retrieved knowledge, and strict tool definitions to the OpenAI Responses API.
6. Execute tool calls server-side. The model cannot directly modify the database or call providers.
7. Require a strict structured response containing intent, confidence, handoff state, and retrieved chunk IDs.
8. Reject invented chunk IDs. Unsupported factual or pricing output is replaced by a safe handoff response.
9. Persist messages, tool metadata, handoffs, appointments, contacts, and provider usage.

## Data model

- `tenants`, `users`, `memberships`, `sessions`: identity and tenant isolation
- `prospects`, `clients`, `agents`: commercial and operational configuration
- `knowledge_documents`, `knowledge_chunks`: approved grounding corpus
- `contacts`, `conversations`, `messages`: customer interactions
- `appointments`, `handoffs`: tool-controlled outcomes
- `integrations`: encrypted per-tenant provider configuration
- `usage_events`: model usage and estimated cost
- `webhook_events`: provider idempotency and processing history
- `audit_logs`: administrative accountability

## Scaling boundary

The current release is designed for a single application process backed by managed PostgreSQL. Before horizontal scaling, replace the in-memory request limiter with a shared Redis-compatible store and add a durable job queue for provider retries, bulk imports, outbound campaigns, document processing, and long-running audits.
