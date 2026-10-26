import { z } from "zod";
export const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const postWrite = z.strictObject({
  slug,
  title: z.string().trim().min(1).max(160),
  excerpt: z.string().trim().max(320),
  bodyMarkdown: z.string().min(1).max(200000),
  tags: z
    .array(
      z.strictObject({
        slug: slug.max(60),
        name: z.string().trim().min(1).max(60),
      }),
    )
    .max(8),
  mediaIds: z.array(z.uuid()).max(50).default([]),
  coverImageId: z.uuid().nullable().default(null),
  isDemo: z.boolean().default(false),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
});
export const postQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(500).optional(),
  q: z.string().trim().max(120).optional(),
  tag: slug.max(60).optional(),
});
export const cursorSchema = z.strictObject({
  at: z.iso.datetime(),
  id: z.uuid(),
});
export type PostWrite = z.infer<typeof postWrite>;

export const adminPostQuery = postQuery.extend({
  status: z.enum(["draft", "published", "archived"]).optional(),
});
