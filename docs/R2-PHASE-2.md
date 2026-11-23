# Phase 2 — Cloudflare R2 media storage

Phase 1 deploys use **Neon Postgres only**. The API already includes an R2-backed media pipeline; it stays **unwired** until you set environment variables.

## Code

- `src/modules/media/service.ts` — presigned upload, verify, WebP finalize, public object publish
- `src/modules/media/routes.ts` — owner admin routes
- `src/config/storage.ts` — `storageConfigured()`, `mediaPublicBaseUrl()`

With no R2 env vars, `POST /api/v1/admin/media/uploads` returns **503** `storage_not_configured`.

## When you enable R2

Set **all** of these on the API host (never `VITE_*`):

| Variable | Purpose |
|----------|---------|
| `R2_ACCOUNT_ID` | Cloudflare account id (32 hex chars) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token |
| `R2_PRIVATE_BUCKET` | Original uploads (`incoming/…`) |
| `R2_PUBLIC_BUCKET` | Published WebP renditions |
| `R2_PUBLIC_URL` | Public HTTPS origin for images (custom domain or r2.dev) |

See `env.example` and the **R2** section in `README.md`.