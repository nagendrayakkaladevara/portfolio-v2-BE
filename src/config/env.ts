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
    ];
    if (groups.some((g) => g.some(Boolean) && !g.every(Boolean)))
      ctx.addIssue({
        code: "custom",
        message: "Configure all auth or all R2 variables together",
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
export const parseEnv = (input: NodeJS.ProcessEnv) => schema.parse(input);
