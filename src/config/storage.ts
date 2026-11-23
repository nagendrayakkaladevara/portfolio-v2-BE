import type { Env } from "./env.js";

/** Base URL for ready media keys (no trailing slash). */
export function mediaPublicBaseUrl(env: Env): string | undefined {
  if (env.R2_PUBLIC_URL) return env.R2_PUBLIC_URL.replace(/\/$/, "");
  if (env.AWS_ENDPOINT_URL_S3 && env.NEON_PUBLIC_BUCKET)
    return `${env.AWS_ENDPOINT_URL_S3.replace(/\/$/, "")}/${env.NEON_PUBLIC_BUCKET}`;
  return undefined;
}

export function storageConfigured(env: Env): boolean {
  const r2 = Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_PRIVATE_BUCKET &&
      env.R2_PUBLIC_BUCKET,
  );
  const neon = Boolean(
    env.AWS_ENDPOINT_URL_S3 &&
      env.AWS_ACCESS_KEY_ID &&
      env.AWS_SECRET_ACCESS_KEY &&
      env.NEON_PRIVATE_BUCKET &&
      env.NEON_PUBLIC_BUCKET,
  );
  return r2 || neon;
}