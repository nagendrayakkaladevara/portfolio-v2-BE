# Sai Nagendra · Portfolio API

Express 5 + TypeScript backend for [portfolio-v2](https://github.com/nagendrayakkaladevara/portfolio-v2). Node 24 LTS, Neon PostgreSQL, Cloudflare R2, Zod, Helmet, JOSE and database-backed rate limiting.

## Status

Implemented: public Writing reads; authenticated owner post create/read/update/publish/archive; optimistic concurrency; verified R2 uploads; anonymous expiring chat sessions; health checks; migrations; request IDs and redacted logs. AI generation deliberately returns **503 `ai_not_configured`** until its endpoint is specified. No provider URL, API key, model or protocol has been assumed. The frontend continues to use bundled JSON and demo chat.

This is a tested backend foundation, not a claim that external services are provisioned or production deployment is complete. Neon, R2 and your OIDC provider need configuration and live integration verification. Tests run against embedded PostgreSQL (PGlite), not a remote Neon instance.

## Run locally

1. Install Node 24 and PostgreSQL 16+ (or create a development Neon branch).
2. `npm ci`
3. Copy `env.example` to `.env`; fill database and rate-limit secret values.
4. `npm run db:migrate`
5. `npm run dev`
6. Check `http://localhost:3001/health/ready`.

Generate the rate-limit secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Never commit `.env`. Do not use the example secret in production.

`npm run check` runs strict TypeScript, integration tests and the build. `npm start` runs the compiled server after `npm run build`. `npm run db:cleanup` expires capability sessions, rate counters and old audit records, and marks abandoned uploads failed; schedule hourly with your hosting platform. Configure a one-day R2 lifecycle rule for the private `incoming/` prefix, including failed/overwritten uploads. Schedule checks for orphaned public objects after interrupted upload processing.

## Production setup

**Neon:** use a pooled connection string in `DATABASE_URL`; use the direct non-pooler connection string in `DATABASE_DIRECT_URL` for migration session locks. Set `DATABASE_SSL=true`. Certificate verification is always enabled for TLS; URL flags cannot disable it. Place the API near your database region. Runtime needs only SELECT/INSERT/UPDATE/DELETE on application tables and usage on the audit sequence; use a separate schema owner for migrations. Migrations use a session advisory lock, checksums and transactions, and must run as a release job, never from every API replica. Enable backups/PITR and practice restoration.

**Owner authentication:** supply `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, and immutable comma-separated `AUTH_OWNER_SUBJECTS` from an OIDC provider. Use access tokens with this API's audience and RS256/ES256 signatures. The backend validates issuer, audience, expiration, issued-at and subject. It has no password login, test bypass or shared admin key in production. Unconfigured owner access fails closed. The test-only injected guard is never provided by `server.ts`. Keep owner access tokens in memory; use the provider's Authorization Code + PKCE flow when building an admin UI. MFA is recommended at the identity provider.

**R2:** use separate private-original and public-rendition buckets. Keep original bucket public access disabled. Set the public bucket's custom HTTPS asset origin. Scope the R2 token to these two buckets only. Private bucket CORS: allow only your exact admin origin, PUT, and Content-Type; expose ETag. A presigned URL expires in 5 minutes. Upload JPEG, PNG or WebP only, up to 5 MiB. Finalization checks actual length and decodes actual image format, caps decoded pixels at 16 million, rejects animation, strips metadata via re-encoding and publishes a bounded WebP rendition under a server-generated immutable key. Do not publish raw uploaded SVG, HTML or the original bucket. Original objects have no public read URL. Crash recovery/orphan reconciliation is an operational follow-up documented below.

**HTTP:** terminate TLS at a trusted ingress; set exact frontend origins in `ALLOWED_ORIGINS`. Only set `TRUST_PROXY` to actual ingress IP ranges; never `true` or an arbitrary hop count. Restrict direct access to the origin server at your firewall when behind a proxy. CORS is not authentication. Admin uses explicit bearer tokens with no cookies, so there is no ambient cookie-based CSRF authority. Apply ingress body-size, connection and request-rate limits as well; HTTP timeouts alone do not prevent volumetric attacks.

**Deploy:** build the Dockerfile (runs as non-root), inject secrets from your host, expose port 3001, and use `/health/live` and `/health/ready` probes. Handle SIGTERM with a 15-second drain budget. No deployment to a backend host is performed by this repository. Neon/R2 costs and availability remain your account's responsibility. Audit and update dependencies regularly; CI includes a production dependency audit.

### Deploy on Vercel

Vercel runs this API as a **container function** (`Dockerfile.vercel` at the project root). That keeps the full Express server, Sharp image pipeline, and Node 24 runtime without rewriting routes to serverless handlers.

1. From `Sai-Nagendra-Portfolio-Backend/`, run `npx vercel link` (or connect the Git repo in the Vercel dashboard and set the **Root Directory** to this folder).
2. In Vercel → **Settings → Environment Variables**, set production (and preview if needed) values from `env.example`. Use Neon’s **pooled** URL for `DATABASE_URL`, the direct URL for `DATABASE_DIRECT_URL`, `DATABASE_SSL=true`, and exact `https://…` entries in `ALLOWED_ORIGINS` for your Vercel frontend URL(s) (no wildcards).
3. Run migrations once against Neon before or after the first deploy: `DATABASE_URL=… npm run db:migrate` (locally or in CI — not from the running container).
4. Deploy with `npx vercel --prod` or push to the linked branch. Vercel builds the image and routes all traffic to it.
5. Pick a **Function region** near your Neon database in **Project → Settings → Functions**. Health checks: `GET /health/live` and `GET /health/ready`.

`VERCEL=1` is set automatically on Vercel. When `TRUST_PROXY` is empty, trusted hop values suitable for Vercel’s edge are applied so rate limits use the client IP from `X-Forwarded-For`. Production listens on `0.0.0.0` and `$PORT` from the platform. Schedule `npm run db:cleanup` hourly via an external cron or a future secured cron route — not included in this image.

## Structure

- `src/app.ts`: dependency composition, HTTP/security middleware, routers; no listening side effects.
- `src/server.ts`: validated configuration, database pool and graceful lifecycle.
- `src/config`: Zod environment schema with cross-field constraints.
- `src/db`: small database boundary, PostgreSQL pool and TLS settings.
- `src/middleware`: owner JWT verification and shared atomic rate-limit store.
- `src/modules/posts`: schemas, repository and public/admin routes.
- `src/modules/media`: upload contract, R2 adapter and image verification pipeline.
- `src/modules/chat`: capability sessions, request validation, disabled generation boundary and provider interface.
- `src/shared`: safe Problem Details errors.
- `migrations`, `scripts`: versioned schema and maintenance commands.
- `tests`: real SQL integration tests using PGlite; HTTP tests through Supertest.
- `docs`: implemented API, security scope and AI integration requirements.

## Connect the frontend later

Set `VITE_CONTENT_SOURCE=api` and `VITE_API_BASE_URL=https://your-api.example/api/v1` after publishing real posts. The public post response matches the frontend's Zod schemas. Keep `VITE_CHAT_SOURCE=demo` until the provider and streaming lifecycle are implemented and validated. Setting it to `api` now correctly shows the agent unavailable (`enabled:false`). No secret belongs in a `VITE_` variable.

## Remaining production work

The previous frontend specifications described a wider CMS. This repository implements the subset in `docs/API.md`; do not assume unlisted endpoints exist. Admin UI, search/tags APIs, revision history, scheduled publication, redirect management, media deletion, knowledge rebuild jobs and live SSE generation are not implemented. Do not enable AI by merely changing `enabled`: first implement the full turn/idempotency/cancellation/grounding lifecycle in `docs/AI-INTEGRATION.md`.

Before live launch: verify Neon migrations and privilege separation; verify OIDC with real keys; configure R2 CORS/lifecycle and test upload/finalization; verify reverse-proxy IP behavior/rate limits across replicas; set alerts, backups and recovery jobs; run dependency audit and external security review appropriate to your deployment.
