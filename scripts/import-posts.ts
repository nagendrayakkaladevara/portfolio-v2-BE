import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createPool } from "../src/db/client.js";
import { parseEnv } from "../src/config/env.js";
import { postWrite } from "../src/modules/posts/schema.js";
const file = process.argv[2];
if (!file)
  throw new Error("Usage: npm run content:import -- /absolute/path/posts.json");
const fixture = z
  .object({
    schemaVersion: z.literal(1),
    posts: z
      .array(
        z.object({
          slug: z.string(),
          title: z.string(),
          excerpt: z.string(),
          bodyMarkdown: z.string(),
          tags: postWrite.shape.tags,
          isDemo: z.boolean().optional(),
        }),
      )
      .max(500),
  })
  .parse(JSON.parse(await readFile(file, "utf8")));
const data = fixture.posts.map((item) =>
  postWrite.parse({ ...item, status: "draft", isDemo: item.isDemo ?? false }),
);
if (new Set(data.map((p) => p.slug)).size !== data.length)
  throw new Error("Duplicate slugs in import. Nothing was written.");
const pool = createPool(parseEnv(process.env), true);
const db = await pool.connect();
try {
  await db.query("BEGIN");
  let count = 0;
  for (const post of data) {
    // Never auto-publish, overwrite an existing slug, or trust imported image URLs.
    const r = await db.query(
      `WITH inserted AS (
    INSERT INTO posts(id,slug,title,excerpt,body_markdown,tags,is_demo,status)
    VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'draft') ON CONFLICT(slug) DO NOTHING RETURNING id
   ) INSERT INTO audit_events(actor,action,resource_id) SELECT 'content-import','post.import',id::text FROM inserted`,
      [
        post.slug,
        post.title,
        post.excerpt,
        post.bodyMarkdown,
        JSON.stringify(post.tags),
        post.isDemo,
      ],
    );
    count += r.rowCount ?? 0;
  }
  await db.query("COMMIT");
  console.log(
    `Imported ${count} drafts; existing slugs were skipped. Upload images in Studio and review before publishing.`,
  );
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  db.release();
  await pool.end();
}
