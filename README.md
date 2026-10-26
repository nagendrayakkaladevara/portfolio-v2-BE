# Sai Nagendra · Portfolio API

Express 5 + TypeScript backend for [portfolio-v2](https://github.com/nagendrayakkaladevara/portfolio-v2). Node 24 LTS, Neon PostgreSQL, Cloudflare R2, Zod, Helmet, JOSE and database-backed rate limiting.

## Status

Implemented: public Writing reads; authenticated owner post create/read/update/publish/archive; optimistic concurrency; verified R2 uploads; anonymous expiring chat sessions; health checks; migrations; request IDs and redacted logs. AI generation deliberately returns **503 `ai_not_configured`** until its endpoint is specified. No provider URL, API key, model or protocol has been assumed. Studio is implemented in the companion frontend at `/admin`; its owner login uses OIDC Authorization Code + PKCE. Public Writing can use the API after deployment configuration. Demo chat remains explicit.

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

The previous frontend specifications described a wider CMS. This repository implements the subset in `docs/API.md`; do not assume unlisted endpoints exist. Admin UI, public/owner search and tag filters, tag counts, owner listings, and revision history are implemented. Scheduled publication, redirect management, media deletion, knowledge rebuild jobs and live SSE generation remain outside this release. Do not enable AI by merely changing `enabled`: first implement the full turn/idempotency/cancellation/grounding lifecycle in `docs/AI-INTEGRATION.md`.

Before live launch: verify Neon migrations and privilege separation; verify OIDC with real keys; configure R2 CORS/lifecycle and test upload/finalization; verify reverse-proxy IP behavior/rate limits across replicas; set alerts, backups and recovery jobs; run dependency audit and external security review appropriate to your deployment.

## Finish setup

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for Neon/R2/OIDC configuration and Docker release commands. `npm run config:check` checks required configuration without printing secrets; it exits nonzero when owner access or image storage is incomplete. `npm run content:import -- /absolute/path/posts.json` imports the frontend fixture as drafts, skips existing slugs, and never publishes or trusts imported media URLs. Upload original images through Studio before publishing.

Builds now include compiled operational tools and migration SQL. The production image supports `npm run db:migrate:production`, `npm run db:cleanup:production`, and `npm run content:import:production -- /path/posts.json` without installing development dependencies. Run migrations once per release before starting replicas. `/health/ready` detects a missing application schema. `render.yaml` is an optional Docker deployment blueprint; it does not create a deployment by itself.
