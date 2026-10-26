# Portfolio backend release

## Required account configuration

The code is ready to configure; no Neon, R2 or identity account has been provisioned by this change. Do not put secrets in source control or chat. Add them through your backend host's secret/environment settings.

1. Create a Neon PostgreSQL database. Set `DATABASE_URL` to its pooled URL and `DATABASE_DIRECT_URL` to its direct URL. Keep `DATABASE_SSL=true` in production. Use a schema-owner migration role and a restricted runtime role as described in README.
2. Create separate private originals and public rendition R2 buckets. Configure all six `R2_*` variables in `env.example`. The private bucket must not be publicly readable. Set private-bucket CORS to your exact Studio origin, PUT and Content-Type; expose ETag. Expire `incoming/` originals after one day. Configure the public bucket's HTTPS asset origin.
3. Register a public SPA with your OIDC provider using Authorization Code + PKCE. Register the exact frontend origin plus `/admin/callback` as redirect URI. Configure an access-token audience for this API, RS256 or ES256 signatures, and the owner's immutable subject. Configure the backend's four `AUTH_*` variables. Set frontend public OIDC authority, client ID and scopes; use `VITE_OIDC_AUDIENCE` only if your provider accepts an `audience` authorization parameter (for example Auth0). For other providers, use their audience-specific scopes via `VITE_OIDC_SCOPE`.
4. Set `ALLOWED_ORIGINS` to exact frontend origins (no trailing slash); generate an independent random `RATE_LIMIT_SECRET` of at least 32 characters. Configure `TRUST_PROXY` only with your host's documented ingress CIDRs; restrict origin access before trusting forwarded addresses.

## Docker release

From the repository root:

```sh
npm ci
npm run check
npm run config:check
npm run db:migrate
npm run content:import -- /absolute/path/to/frontend/src/data/posts.json

docker build -t portfolio-api .
# Inject environment through your host's secret manager; a private .env is suitable for local commands.
docker run --rm --env-file .env portfolio-api npm run db:migrate:production
docker run --rm --env-file .env -p 3001:3001 portfolio-api
```

Use the host's release job for migrations rather than every replica. The optional Render blueprint wires a release migration and health probe; select a hosting plan that supports pre-deploy commands. No cloud resource is created until you deploy from your own account.

Schedule `npm run db:cleanup:production` hourly in the same image with runtime secrets. Enable host alerts and Neon backups. Check R2 public orphans after interrupted finalization. The Docker health check and host probe use `/health/ready`; `/health/live` reports process liveness.

## Frontend

Configure public build-time variables:

```dotenv
VITE_CONTENT_SOURCE=api
VITE_API_BASE_URL=https://YOUR_API_HOST/api/v1
VITE_CHAT_SOURCE=demo
VITE_OIDC_AUTHORITY=https://YOUR_OIDC_ISSUER/
VITE_OIDC_CLIENT_ID=YOUR_PUBLIC_SPA_CLIENT_ID
VITE_OIDC_SCOPE=openid profile YOUR_API_SCOPE
VITE_SITE_URL=https://YOUR_FRONTEND_HOST
```

Set an audience authorization parameter only when your provider requires it. The backend must receive an access token with `AUTH_AUDIENCE`; an ID token is not accepted as an API token. Never add secrets to `VITE_*` variables. The frontend keeps tokens only in memory; PKCE redirect state uses session storage. Refreshing Studio intentionally requires sign-in again. Sign out clears the local Studio session; it does not sign you out of the identity provider globally.

Visit `/admin`, sign in, create a draft, add alt text and upload an image, insert it into Markdown, preview, save, publish and verify the public URL. Open the same article in two windows and confirm a stale save returns 412. Verify non-owner access returns 403. Revision history is owner-only. The public frontend should remain in JSON mode until the API is deployed and seeded, to avoid breaking the existing portfolio.

Production builds fetch a validated, paginated snapshot from the configured HTTPS public API for article metadata, RSS and sitemap. Build after content changes to refresh those static files. Requests fail the build on API errors, rather than silently producing an empty feed. The browser still reads live API content. Configure your static host's SPA fallback for `/posts/*` and `/admin/*`; always serve real asset paths before the fallback. `/admin`, callback and new-article entry points are generated with noindex metadata.

## Remaining external work

Live Neon migration, real OIDC login, R2 CORS/upload, deployment and domain configuration cannot be verified without account configuration. AI remains disabled until its endpoint/authentication/protocol is supplied; see AI-INTEGRATION.md. Scheduled publishing, redirect management, media deletion and AI knowledge jobs remain separate roadmap features.
