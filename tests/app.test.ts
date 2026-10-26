import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import type { Database } from "../src/db/client.js";
import { normalizeImage } from "../src/modules/media/service.js";
import { PostgresRateStore } from "../src/middleware/rate-limit.js";
import { messageSchema } from "../src/modules/chat/routes.js";
import { HttpError } from "../src/shared/errors.js";
const pg = new PGlite();
const db: Database = {
  async query<T extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) {
    const r = await pg.query<T>(sql, values);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
};
const env = parseEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost/test",
  DATABASE_SSL: "false",
  RATE_LIMIT_SECRET: "a".repeat(32),
  ALLOWED_ORIGINS: "http://localhost:5173",
});
const app = createApp({ db, env, logger: false });
const admin = createApp({
  db,
  env,
  logger: false,
  ownerGuard: (req, res, next) => {
    if (req.get("Authorization") !== "Bearer test-owner")
      throw new HttpError(401, "unauthorized", "Test owner required.");
    res.locals.owner = "test-owner";
    next();
  },
});
const post = {
  slug: "first-post",
  title: "First post",
  excerpt: "A real article",
  bodyMarkdown: "Hello from the portfolio.",
  tags: [{ slug: "react", name: "React" }],
  status: "draft",
};
beforeAll(async () => {
  for (const name of (await readdir(new URL("../migrations/", import.meta.url))).filter(n => n.endsWith(".sql")).sort()) {
    await pg.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
}, 30000);
afterAll(async () => {
  await pg.close();
});
describe("HTTP boundaries", () => {
  it("serves health with security headers and request ids", async () => {
    const r = await request(app).get("/health/ready").expect(200);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers["x-request-id"]).toBeTruthy();
  });
  it("rejects unapproved origins", async () => {
    await request(app)
      .get("/api/v1/posts")
      .set("Origin", "https://evil.example")
      .expect(403);
  });
  it("admits exact configured origins and preflights auth headers", async () => {
    const r = await request(app)
      .options("/api/v1/admin/posts")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);
    expect(r.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
  });
  it("fails closed when owner authentication is unconfigured", async () => {
    await request(app).post("/api/v1/admin/posts").send(post).expect(503);
  });
  it("rejects malformed and oversized JSON", async () => {
    await request(app)
      .post("/api/v1/chat/sessions")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
    await request(app)
      .post("/api/v1/chat/sessions")
      .send({ text: "x".repeat(300000) })
      .expect(413);
  });
  it("does not leak invalid input or internal details", async () => {
    const r = await request(app)
      .get("/api/v1/posts?limit=99&secret=do-not-echo")
      .expect(400);
    expect(JSON.stringify(r.body)).not.toContain("do-not-echo");
    expect(r.headers["content-type"]).toContain("application/problem+json");
  });
});
describe("Writing persistence and publication", () => {
  it("creates drafts, publishes with concurrency protection, hides archived posts", async () => {
    await request(admin).post("/api/v1/admin/posts").send(post).expect(401);
    const created = await request(admin)
      .post("/api/v1/admin/posts")
      .set("Authorization", "Bearer test-owner")
      .send(post)
      .expect(201);
    const id = created.body.data.id;
    await request(app).get("/api/v1/posts/first-post").expect(404);
    await request(admin)
      .put(`/api/v1/admin/posts/${id}`)
      .set("Authorization", "Bearer test-owner")
      .send(post)
      .expect(428);
    await request(admin)
      .put(`/api/v1/admin/posts/${id}`)
      .set("Authorization", "Bearer test-owner")
      .set("If-Match", '"1"')
      .send({ ...post, status: "published" })
      .expect(200);
    const published = await request(app)
      .get("/api/v1/posts/first-post")
      .expect(200);
    expect(published.body.data.bodyMarkdown).toBe(post.bodyMarkdown);
    expect(published.body.data.publishedAt).toBeTruthy();
    await request(admin)
      .put(`/api/v1/admin/posts/${id}`)
      .set("Authorization", "Bearer test-owner")
      .set("If-Match", '"1"')
      .send(post)
      .expect(412);
    await request(admin)
      .put(`/api/v1/admin/posts/${id}`)
      .set("Authorization", "Bearer test-owner")
      .set("If-Match", '"2"')
      .send({ ...post, status: "archived" })
      .expect(200);
    await request(app).get("/api/v1/posts/first-post").expect(404);
    expect((await db.query("SELECT * FROM audit_events")).rows.length).toBe(3);
  });
  it("validates uploads and blocks references to unverified media", async () => {
    await request(admin)
      .post("/api/v1/admin/media/uploads")
      .set("Authorization", "Bearer test-owner")
      .send({ contentType: "image/svg+xml", sizeBytes: 12, alt: "x" })
      .expect(400);
    await request(admin)
      .post("/api/v1/admin/posts")
      .set("Authorization", "Bearer test-owner")
      .send({ ...post, slug: "bad-media", mediaIds: [randomUUID()] })
      .expect(400);
  });
  it("paginates with keyset cursors and rejects tampering", async () => {
    for (let i = 0; i < 3; i++)
      await request(admin)
        .post("/api/v1/admin/posts")
        .set("Authorization", "Bearer test-owner")
        .send({ ...post, slug: `page-${i}`, status: "published" })
        .expect(201);
    const first = await request(app).get("/api/v1/posts?limit=2").expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.pagination.hasMore).toBe(true);
    const second = await request(app)
      .get(`/api/v1/posts?limit=2&cursor=${first.body.pagination.nextCursor}`)
      .expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(first.body.data.map((p: { id: string }) => p.id)).not.toContain(
      second.body.data[0].id,
    );
    await request(app).get("/api/v1/posts?cursor=bogus").expect(400);
  });
});
describe("Chat capability security", () => {
  it("keeps generation disabled while allowing expiring scoped sessions", async () => {
    const config = await request(app).get("/api/v1/chat/config").expect(200);
    expect(config.body.data.enabled).toBe(false);
    const session = await request(app)
      .post("/api/v1/chat/sessions")
      .send({})
      .expect(201);
    const { id, token } = session.body.data;
    const stored = await db.query(
      "SELECT token_hash FROM chat_sessions WHERE id=$1",
      [id],
    );
    expect(stored.rows[0]!.token_hash).not.toBe(token);
    await request(app).get(`/api/v1/chat/sessions/${id}`).expect(401);
    await request(app)
      .get(`/api/v1/chat/sessions/${id}`)
      .set("Authorization", `Bearer ${"x".repeat(43)}`)
      .expect(401);
    await request(app)
      .post(`/api/v1/chat/sessions/${id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientMessageId: randomUUID(),
        content: "Tell me about Sai",
        pagePath: "/",
      })
      .expect(503);
    await request(app)
      .delete(`/api/v1/chat/sessions/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    await request(app)
      .get(`/api/v1/chat/sessions/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });
  it("rejects expired session tokens", async () => {
    const r = await request(app)
      .post("/api/v1/chat/sessions")
      .send({})
      .expect(201);
    await db.query(
      "UPDATE chat_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [r.body.data.id],
    );
    await request(app)
      .get(`/api/v1/chat/sessions/${r.body.data.id}`)
      .set("Authorization", `Bearer ${r.body.data.token}`)
      .expect(401);
  });
  it("rejects unknown fields, controls, unsafe context paths", () => {
    for (const content of ["", "x".repeat(2001), "a\u0000b"])
      expect(
        messageSchema.safeParse({
          clientMessageId: randomUUID(),
          content,
          pagePath: "/",
        }).success,
      ).toBe(false);
    expect(
      messageSchema.safeParse({
        clientMessageId: randomUUID(),
        content: "Hi",
        pagePath: "//evil.example",
      }).success,
    ).toBe(false);
  });
});
describe("Storage and distributed limits", () => {
  it("re-encodes a valid image and rejects MIME spoofing", async () => {
    const png = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const r = await normalizeImage(png, "image/png");
    expect(r.info.format).toBe("webp");
    expect(r.info.width).toBe(20);
    await expect(normalizeImage(png, "image/jpeg")).rejects.toThrow(
      "declared type",
    );
    await expect(
      normalizeImage(Buffer.from("<svg></svg>"), "image/png"),
    ).rejects.toThrow();
  });
  it("shares counters across separate store instances without retaining raw IP", async () => {
    const a = new PostgresRateStore(db, "test", "s".repeat(32)),
      b = new PostgresRateStore(db, "test", "s".repeat(32));
    const r = await Promise.all([
      a.increment("1.2.3.4"),
      b.increment("1.2.3.4"),
    ]);
    expect(r.map((v) => v.totalHits).sort()).toEqual([1, 2]);
    expect(
      JSON.stringify((await db.query("SELECT key FROM rate_limits")).rows),
    ).not.toContain("1.2.3.4");
  });
  it("fails production config with insecure DB transport", () => {
    expect(() =>
      parseEnv({ ...env, NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});
