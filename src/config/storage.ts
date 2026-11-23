import type { Env } from "./env.js";

/**
 * Phase 2 (Cloudflare R2): public CDN/base URL for ready media keys — no trailing slash.
 * Omitted in phase 1 deploys; posts still work, image URLs stay empty until R2 is configured.
 */
export function mediaPublicBaseUrl(env: Env): string | undefined {
  if (!env.R2_PUBLIC_URL) return undefined;
  return env.R2_PUBLIC_URL.replace(/\/$/, "");
}

/** True when all R2 variables are set (phase 2 — admin media upload/finalize). */
export function storageConfigured(env: Env): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_PRIVATE_BUCKET &&
      env.R2_PUBLIC_BUCKET &&
      env.R2_PUBLIC_URL,
  );
}