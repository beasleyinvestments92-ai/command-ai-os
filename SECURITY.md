# Security Policy

## Supported branch

Security fixes target the active production branch and the latest release candidate.

## Controls implemented

- Argon2id password hashing
- Hashed bearer session tokens stored in PostgreSQL
- HTTP-only, SameSite cookies with production Secure enforcement
- CSRF token and same-origin validation for authenticated writes
- Tenant-scoped queries and role checks
- AES-256-GCM encryption for stored tenant integration credentials
- Strict security headers and CSP
- Request-body, upload, message, and rate limits
- Twilio and Stripe signature verification
- Webhook idempotency records
- Structured logging with credential redaction
- Audit logs for administrative mutations
- No browser exposure of provider secrets
- OpenAI storage disabled by default

## Production requirements

- Use a managed PostgreSQL service with automated backups, encryption at rest, and restricted network access.
- Store all secrets in the host's secret manager. Never commit `.env`.
- Rotate bootstrap credentials after first deployment and remove `ADMIN_PASSWORD` from the host.
- Set `APP_URL` to the canonical HTTPS origin, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, and `TWILIO_VALIDATE_WEBHOOKS=true`.
- Restrict `allowedWidgetOrigins` for every tenant.
- Run one application instance unless the in-memory rate limiter is replaced with a shared Redis-compatible limiter.
- Add MFA/SSO before granting access to multiple agency operators or regulated data.
- Do not collect card numbers, Social Security numbers, passwords, medical records, or other unnecessary sensitive data through AI conversations.
- Establish retention, deletion, breach-response, vendor, and access-review procedures.

## Reporting

Do not open a public issue containing secrets or exploitable details. Send a private report to the repository owner with reproduction steps, affected version, and expected impact.
