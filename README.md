# Social Webapp

Next.js application for encrypted chat, contacts, account recovery, push notifications, and MongoDB persistence.

## Production Setup

1. Copy env template:
```bash
cp .env.example .env.local
```
2. Set real values for:
- `MONGODB_URI`
- `NEXT_PUBLIC_RELAY_WS_URL`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `SESSION_HASH_PEPPER` (recommended)
- `PRIVACY_ID_PEPPER` (required in production; blinds server-side owner IDs for metadata minimization)
- `RELAY_WS_AUTH_SECRET` (required when backend enforces WS token auth)
- `ATTACHMENT_TOKEN_SECRET` (required in production; signs short-lived attachment download tokens)
- optional at-rest push metadata encryption: `PUSH_DATA_ENCRYPTION_KEY` (32-byte hex/base64)
- optional outbound push host control: `PUSH_ENDPOINT_ALLOWLIST` (comma-separated host/domain allowlist; bare hosts or full `https://` URLs are accepted)
- optional for distributed API rate limiting: `RATE_LIMIT_REDIS_REST_URL`, `RATE_LIMIT_REDIS_REST_TOKEN`
- optional proxy trust flag: `TRUST_X_FORWARDED_FOR=1` only when behind trusted reverse proxy
3. Build and run:
```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

## Health Checks

- Liveness: `GET /api/healthz`
- Deep check (includes Mongo ping + security config validation): `GET /api/healthz?deep=1`

## Security and Hardening Baseline

- Security headers and CSP enabled via `next.config.ts`.
- API middleware applies:
  - in-memory rate limiting (or Redis-backed distributed limiting when configured)
  - CSRF double-submit token checks on mutating API requests
  - `X-Request-ID`
  - `Cache-Control: no-store` for `/api/*`
- Input size and format limits are enforced on high-risk API routes.
- Mongo indexes are initialized automatically at startup.
- Relationship metadata storage is anonymized with blinded owner/member IDs (`PRIVACY_ID_PEPPER`).

## Operational Notes

- Temporary accounts expire automatically after 24h.
- Expired temporary users are cleaned with related contacts, messages, room members, and push subscriptions.
- Attachments are stored separately from message records, encrypted client-side, and auto-expire after 24h.
- Attachment uploads are resumable/chunked (`init/chunk/status/finalize`) to improve reliability on unstable networks.
- Attachment download tokens are short-lived and scoped to authenticated room members only.
- Unsafe executable/script extensions are blocked; server cannot inspect plaintext attachment content in E2EE mode.
- For multi-instance production, replace in-memory API rate limiting with a shared store (Redis).

## Recommended Deployment

- Run behind HTTPS reverse proxy (Nginx/Traefik/Cloudflare).
- Force TLS; do not expose plain `ws://` publicly.
- Set `NODE_ENV=production`.
- Use managed MongoDB with backups and alerts.
