# Production Deployment

## Managed Node host

Use Node.js 22+, managed PostgreSQL, HTTPS, and a host that supports environment secrets and health checks.

Build command:

```bash
npm ci --no-audit --no-fund
```

Migration or pre-deploy command:

```bash
npm run migrate
```

Start command:

```bash
npm start
```

Health checks:

- Liveness: `/healthz`
- Database readiness: `/readyz`

The server binds to the host-provided `PORT` on all interfaces.

## Render

`render.yaml` declares a Node web service and managed PostgreSQL database. Create a Blueprint from the repository, provide all `sync: false` secrets, set `APP_URL` to the final service URL, and deploy. The pre-deploy command applies migrations before traffic moves to the new release.

Use a persistent paid PostgreSQL plan for real customers. Test restores, not only backups.

## Docker

```bash
cp .env.example .env
docker compose up --build -d
```

For public deployment, terminate TLS at a managed load balancer or reverse proxy, set the canonical `APP_URL`, enable secure cookies and webhook validation, and do not expose PostgreSQL publicly.

## Deployment verification

```bash
curl -fsS https://YOUR-DOMAIN/healthz
curl -fsS https://YOUR-DOMAIN/readyz
```

Then verify through the dashboard:

1. Administrator login and logout
2. CSRF-protected writes
3. Create client and agent
4. Add knowledge and ask a known question
5. Ask an unsupported question and confirm handoff
6. Ask a prompt-injection/private-data question and confirm refusal
7. Check availability and book a non-conflicting appointment
8. Open the widget from an allowed origin
9. Send a signed provider test webhook
10. Verify logs contain no provider credentials or session cookies

## Rollback

Application releases are backward-compatible with migration `001_init.sql`. Before future destructive migrations, deploy additive schema changes first, backfill, release code that no longer relies on old columns, and only then remove obsolete schema in a later release. Keep a tested database restore procedure and record the deployed commit SHA.
