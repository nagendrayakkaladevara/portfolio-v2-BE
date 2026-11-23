import "dotenv/config";
import { z } from "zod";
const https = z
  .url()
  .refine((s) => new URL(s).protocol === "https:", "HTTPS required");
const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.string().startsWith("postgres"),
    DATABASE_DIRECT_URL: z.string().startsWith("postgres").optional(),
    DATABASE_SSL: z.enum(["true", "false"]).default("true"),
    ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
    TRUST_PROXY: z.string().default(""),
    RATE_LIMIT_SECRET: z.string().min(32),
    AUTH_ISSUER: https.optional(),
    AUTH_AUDIENCE: z.string().min(1).optional(),
    AUTH_JWKS_URL: https.optional(),
    AUTH_OWNER_SUBJECTS: z.string().optional(),
    R2_ACCOUNT_ID: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_PRIVATE_BUCKET: z.string().min(1).optional(),
    R2_PUBLIC_BUCKET: z.string().min(1).optional(),
    R2_PUBLIC_URL: https.optional(),
    AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    AWS_ENDPOINT_URL_S3: https.optional(),
    AWS_REGION: z.string().min(1).optional(),
    NEON_PRIVATE_BUCKET: z.string().min(1).default("originals"),
    NEON_PUBLIC_BUCKET: z.string().min(1).default("images"),
  })
  .superRefine((e, ctx) => {
    const groups = [
      [e.AUTH_ISSUER, e.AUTH_AUDIENCE, e.AUTH_JWKS_URL, e.AUTH_OWNER_SUBJECTS],
      [
        e.R2_ACCOUNT_ID,
        e.R2_ACCESS_KEY_ID,
        e.R2_SECRET_ACCESS_KEY,
        e.R2_PRIVATE_BUCKET,
        e.R2_PUBLIC_BUCKET,
        e.R2_PUBLIC_URL,
      ],
      [
        e.AWS_ACCESS_KEY_ID,
        e.AWS_SECRET_ACCESS_KEY,
        e.AWS_ENDPOINT_URL_S3,
        e.AWS_REGION,
      ],
    ];
    if (groups.some((g) => g.some(Boolean) && !g.every(Boolean)))
      ctx.addIssue({
        code: "custom",
        message:
          "Configure all auth, all R2, or all Neon Object Storage variables together",
      });
    const r2 = Boolean(e.R2_ACCOUNT_ID);
    const neonStorage = Boolean(e.AWS_ENDPOINT_URL_S3);
    if (r2 && neonStorage)
      ctx.addIssue({
        code: "custom",
        message: "Use either Cloudflare R2 or Neon Object Storage, not both",
      });
    if (e.NODE_ENV === "production" && e.DATABASE_SSL !== "true")
      ctx.addIssue({
        code: "custom",
        message: "Production database TLS is required",
      });
    for (const s of e.ALLOWED_ORIGINS.split(",")) {
      try {
        const u = new URL(s.trim());
        if (
          u.origin !== s.trim() ||
          (e.NODE_ENV === "production" && u.protocol !== "https:")
        )
          throw Error();
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["ALLOWED_ORIGINS"],
          message: "Use exact origins; HTTPS in production",
        });
      }
    }
    if (e.R2_PRIVATE_BUCKET && e.R2_PRIVATE_BUCKET === e.R2_PUBLIC_BUCKET)
      ctx.addIssue({
        code: "custom",
        message: "Private and public R2 buckets must differ",
      });
  });
export type Env = z.infer<typeof schema>;
/** Apply Vercel-specific defaults without weakening non-Vercel deployments. */
function withPlatformDefaults(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (input.VERCEL !== "1") return input;
  const next = { ...input };
  if (!next.TRUST_PROXY?.trim())
    next.TRUST_PROXY = "loopback,linklocal,uniquelocal";
  return next;
}
function normalizeNeonEnv(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...input };
  if (!next.DATABASE_DIRECT_URL && next.DATABASE_URL_UNPOOLED)
    next.DATABASE_DIRECT_URL = next.DATABASE_URL_UNPOOLED;
  if (next.DATABASE_URL?.includes("neon.tech") && next.DATABASE_SSL === undefined)
    next.DATABASE_SSL = "true";
  return next;
}

export const parseEnv = (input: NodeJS.ProcessEnv) =>
  schema.parse(withPlatformDefaults(normalizeNeonEnv(input)));
