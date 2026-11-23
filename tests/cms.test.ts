import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { readFile, readdir } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import type { Database } from "../src/db/client.js";

const pg = new PGlite();
const db: Database = {
  async query<T extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) {
    const result = await pg.query<T>(sql, values);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  },
};
const env = parseEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost/test",
  DATABASE_SSL: "false",
  RATE_LIMIT_SECRET: "t".repeat(32),
});
const app = createApp({
  db,
  env,
  logger: false,
  ownerGuard: (_req, res, next) => {
    res.locals.owner = "owner";
    next();
  },
});
const locked = createApp({ db, env, logger: false });
const article = {
  slug: "private-notes",
  title: "Private Angular notes",
  excerpt: "Draft excerpt",
  bodyMarkdown: "Initial text",
  tags: [{ slug: "angular", name: "Angular" }],
  status: "draft",
};
beforeAll(async () => {
  for (const file of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(
      await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
}, 30000);
afterAll(() => pg.close());
describe("CMS owner workflows", () => {
  it("protects the session, listing and revision endpoints", async () => {
    for (const url of [
      "/api/v1/admin/session",
      "/api/v1/admin/posts",
      "/api/v1/admin/posts/00000000-0000-4000-8000-000000000001/revisions",
    ])
      await request(locked).get(url).expect(503);
    const session = await request(app).get("/api/v1/admin/session").expect(200);
    expect(session.body.data).toEqual({
      subject: "owner",
      storageConfigured: false,
    });
    expect(session.headers["cache-control"]).toBe("no-store");
  });
  it("lists drafts for the owner without exposing them through public searches or tags", async () => {
    await request(app).post("/api/v1/admin/posts").send(article).expect(201);
    const drafts = await request(app)
      .get("/api/v1/admin/posts?status=draft&q=angular&tag=angular")
      .expect(200);
    expect(drafts.body.data).toHaveLength(1);
    expect(drafts.body.data[0].publishedAt).toBeNull();
    expect(drafts.body.data[0].version).toBe(1);
    expect(
      (await request(app).get("/api/v1/posts?q=angular")).body.data,
    ).toEqual([]);
    expect((await request(app).get("/api/v1/tags")).body.data).toEqual(
      [],
    );
  });
  it("records versions atomically and paginates revision history, including drafts and archive changes", async () => {
    const created = await request(app)
      .post("/api/v1/admin/posts")
      .send({ ...article, slug: "versioned" })
      .expect(201);
    const id = created.body.data.id;
    await request(app)
      .put(`/api/v1/admin/posts/${id}`)
      .set("If-Match", '"1"')
      .send({
        ...article,
        slug: "versioned",
        bodyMarkdown: "Published text",
        status: "published",
      })
      .expect(200);
    await request(app)
      .put(`/api/v1/admin/posts/${id}`)
      .set("If-Match", '"1"')
      .send({ ...article, slug: "versioned" })
      .expect(412);
    const first = await request(app)
      .get(`/api/v1/admin/posts/${id}/revisions?limit=1`)
      .expect(200);
    expect(first.body.data[0].snapshot.body_markdown).toBe("Published text");
    expect(first.body.data[0].version).toBe(2);
    const second = await request(app)
      .get(
        `/api/v1/admin/posts/${id}/revisions?limit=1&cursor=${first.body.pagination.nextCursor}`,
      )
      .expect(200);
    expect(second.body.data[0].snapshot.status).toBe("draft");
    expect(second.body.pagination.hasMore).toBe(false);
    await request(app)
      .get(`/api/v1/admin/posts/${id}/revisions?cursor=bad`)
      .expect(400);
    await request(app)
      .get("/api/v1/admin/posts/00000000-0000-4000-8000-000000000001/revisions")
      .expect(404);
  });
  it("supports public search and tag filters and excludes archived content", async () => {
    const found = await request(app)
      .get("/api/v1/posts?q=ANGULAR&tag=angular")
      .expect(200);
    expect(found.body.data.map((p: { slug: string }) => p.slug)).toEqual([
      "versioned",
    ]);
    const tags = await request(app).get("/api/v1/tags").expect(200);
    expect(tags.body.data).toEqual([
      { slug: "angular", name: "Angular", count: 1 },
    ]);
    const id = found.body.data[0].id;
    await request(app)
      .put(`/api/v1/admin/posts/${id}`)
      .set("If-Match", '"2"')
      .send({ ...article, slug: "versioned", status: "archived" })
      .expect(200);
    expect(
      (await request(app).get("/api/v1/posts?q=angular")).body.data,
    ).toEqual([]);
    expect((await request(app).get("/api/v1/tags")).body.data).toEqual(
      [],
    );
  });
  it("paginates owner listings without duplicate rows and validates filters", async () => {
    const first = await request(app)
      .get("/api/v1/admin/posts?limit=1")
      .expect(200);
    const second = await request(app)
      .get(
        `/api/v1/admin/posts?limit=1&cursor=${first.body.pagination.nextCursor}`,
      )
      .expect(200);
    expect(first.body.data[0].id).not.toBe(second.body.data[0].id);
    expect(second.body.pagination.hasMore).toBe(false);
    await request(app).get("/api/v1/admin/posts?cursor=bogus").expect(400);
    await request(app).get("/api/v1/admin/posts?status=deleted").expect(400);
    await request(app).get("/api/v1/posts?tag=invalid%20tag").expect(400);
    expect(
      (await request(app).get("/api/v1/admin/posts?q=%25")).body.data,
    ).toEqual([]);
  });
});
