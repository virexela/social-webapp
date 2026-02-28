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
3. Build and run:
```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

## Health Checks

- Liveness: `GET /api/healthz`
- Deep check (includes Mongo ping): `GET /api/healthz?deep=1`

## Security and Hardening Baseline

- Security headers and CSP enabled via `next.config.ts`.
- API middleware applies:
  - in-memory rate limiting
  - `X-Request-ID`
  - `Cache-Control: no-store` for `/api/*`
- Input size and format limits are enforced on high-risk API routes.
- Mongo indexes are initialized automatically at startup.

## Operational Notes

- Temporary accounts expire automatically after 24h.
- Expired temporary users are cleaned with related contacts, messages, room members, and push subscriptions.
- For multi-instance production, replace in-memory API rate limiting with a shared store (Redis).

## Recommended Deployment

- Run behind HTTPS reverse proxy (Nginx/Traefik/Cloudflare).
- Force TLS; do not expose plain `ws://` publicly.
- Set `NODE_ENV=production`.
- Use managed MongoDB with backups and alerts.
