import { randomUUID } from "node:crypto";
import type { Database } from "../../db/client.js";
import { HttpError } from "../../shared/errors.js";
import { cursorSchema, type PostWrite } from "./schema.js";
type PostRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_markdown: string;
  tags: unknown[];
  media_ids: string[];
  cover_image_id: string | null;
  is_demo: boolean;
  published_at: Date | null;
  updated_at: Date;
  status: string;
  version: number;
};
export class PostsRepository {
  constructor(
    private db: Database,
    private mediaOrigin: string = "",
  ) {}
  private async dto(row: PostRow, detail = false) {
    const { rows: assets } = await this.db.query<{
      id: string;
      public_key: string;
      alt: string;
      width: number;
      height: number;
    }>(
      "SELECT id,public_key,alt,width,height FROM media WHERE id=ANY($1::uuid[]) AND status='ready'",
      [[...row.media_ids, ...(row.cover_image_id ? [row.cover_image_id] : [])]],
    );
    const media = assets.map((a) => ({
      id: a.id,
      url: `${this.mediaOrigin.replace(/\/$/, "")}/${a.public_key}`,
      alt: a.alt,
      width: a.width,
      height: a.height,
      caption: null,
    }));
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      publishedAt: row.published_at?.toISOString() ?? null,
      updatedAt: row.updated_at.toISOString(),
      readingTimeMinutes: Math.max(
        1,
        Math.ceil(row.body_markdown.split(/\s+/).length / 220),
      ),
      tags: row.tags,
      coverImage: media.find((m) => m.id === row.cover_image_id) ?? null,
      isDemo: row.is_demo,
      ...(detail ? { bodyMarkdown: row.body_markdown, media } : {}),
    };
  }
  async list(
    limit: number,
    cursor?: string,
    filter: { q?: string; tag?: string } = {},
  ) {
    let at: string | null = null,
      id: string | null = null;
    if (cursor) {
      try {
        const c = cursorSchema.parse(
          JSON.parse(Buffer.from(cursor, "base64url").toString()),
        );
        at = c.at;
        id = c.id;
      } catch {
        throw new HttpError(
          400,
          "invalid_cursor",
          "Invalid pagination cursor.",
        );
      }
    }
    const { rows } = await this.db.query<PostRow>(
      `SELECT * FROM posts WHERE status='published' AND published_at<=NOW() AND ($1::timestamptz IS NULL OR (published_at,id)<($1::timestamptz,$2::uuid)) AND ($4::text IS NULL OR strpos(lower(title || ' ' || excerpt),lower($4))>0) AND ($5::text IS NULL OR tags @> jsonb_build_array(jsonb_build_object('slug',$5::text))) ORDER BY published_at DESC,id DESC LIMIT $3`,
      [at, id, limit + 1, filter.q || null, filter.tag || null],
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: await Promise.all(page.map((r) => this.dto(r))),
      pagination: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  at: last.published_at!.toISOString(),
                  id: last.id,
                }),
              ).toString("base64url")
            : null,
      },
    };
  }
  async tags() {
    const { rows } = await this.db.query(
      `SELECT tag->>'slug' AS slug, min(tag->>'name') AS name, count(*)::int AS count
       FROM posts CROSS JOIN LATERAL jsonb_array_elements(tags) AS tag
       WHERE status='published' AND published_at<=NOW() GROUP BY tag->>'slug' ORDER BY name`,
    );
    return rows;
  }
  async adminList(filter: {
    limit: number;
    cursor?: string;
    q?: string;
    tag?: string;
    status?: string;
  }) {
    let at: string | null = null,
      id: string | null = null;
    if (filter.cursor) {
      try {
        const c = cursorSchema.parse(
          JSON.parse(Buffer.from(filter.cursor, "base64url").toString()),
        );
        at = c.at;
        id = c.id;
      } catch {
        throw new HttpError(
          400,
          "invalid_cursor",
          "Invalid pagination cursor.",
        );
      }
    }
    const { rows } = await this.db.query<PostRow>(
      `SELECT * FROM posts WHERE ($1::text IS NULL OR status=$1)
       AND ($2::text IS NULL OR strpos(lower(title || ' ' || excerpt),lower($2))>0)
       AND ($3::text IS NULL OR tags @> jsonb_build_array(jsonb_build_object('slug',$3::text)))
       AND ($4::timestamptz IS NULL OR (updated_at,id)<($4::timestamptz,$5::uuid))
       ORDER BY updated_at DESC,id DESC LIMIT $6`,
      [
        filter.status || null,
        filter.q || null,
        filter.tag || null,
        at,
        id,
        filter.limit + 1,
      ],
    );
    const page = rows.slice(0, filter.limit),
      last = page.at(-1);
    const hasMore = rows.length > filter.limit;
    return {
      data: await Promise.all(
        page.map(async (row) => ({
          ...(await this.dto(row)),
          status: row.status,
          version: row.version,
        })),
      ),
      pagination: {
        limit: filter.limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  at: last.updated_at.toISOString(),
                  id: last.id,
                }),
              ).toString("base64url")
            : null,
      },
    };
  }
  async revisions(id: string, query: { limit: number; cursor?: string }) {
    await this.adminGet(id);
    const version = query.cursor ? Number(query.cursor) : 2147483647;
    if (!Number.isInteger(version) || version < 1 || version > 2147483647)
      throw new HttpError(400, "invalid_cursor", "Invalid revision cursor.");
    const { rows } = await this.db.query(
      `SELECT version,snapshot,created_at AS "createdAt" FROM post_revisions WHERE post_id=$1 AND version<$2 ORDER BY version DESC LIMIT $3`,
      [id, version, query.limit + 1],
    );
    const page = rows.slice(0, query.limit),
      hasMore = rows.length > query.limit;
    return {
      data: page,
      pagination: {
        limit: query.limit,
        hasMore,
        nextCursor: hasMore ? String(page.at(-1)!.version) : null,
      },
    };
  }
  async get(slug: string) {
    const { rows } = await this.db.query<PostRow>(
      "SELECT * FROM posts WHERE slug=$1 AND status='published' AND published_at<=NOW()",
      [slug],
    );
    if (!rows[0]) throw new HttpError(404, "not_found", "Article not found.");
    return this.dto(rows[0], true);
  }
  async adminGet(id: string) {
    const { rows } = await this.db.query<PostRow>(
      "SELECT * FROM posts WHERE id=$1",
      [id],
    );
    if (!rows[0]) throw new HttpError(404, "not_found", "Article not found.");
    return {
      data: {
        ...(await this.dto(rows[0], true)),
        status: rows[0].status,
        mediaIds: rows[0].media_ids,
        coverImageId: rows[0].cover_image_id,
      },
      version: rows[0].version,
    };
  }
  async write(
    data: PostWrite,
    actor: string,
    id: string = randomUUID(),
    version?: number,
  ) {
    const ids = [
      ...new Set([
        ...data.mediaIds,
        ...(data.coverImageId ? [data.coverImageId] : []),
      ]),
    ];
    const { rows: assets } = await this.db.query(
      "SELECT id FROM media WHERE id=ANY($1::uuid[]) AND status='ready'",
      [ids],
    );
    if (assets.length !== ids.length)
      throw new HttpError(
        400,
        "invalid_media",
        "Every media asset must be verified and ready.",
      );
    const values = [
      id,
      data.slug,
      data.title,
      data.excerpt,
      data.bodyMarkdown,
      JSON.stringify(data.tags),
      data.mediaIds,
      data.coverImageId,
      data.isDemo,
      data.status,
      actor,
    ];
    const result =
      version === undefined
        ? await this.db.query(
            `WITH written AS (INSERT INTO posts(id,slug,title,excerpt,body_markdown,tags,media_ids,cover_image_id,is_demo,status,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $10='published' THEN NOW() END) RETURNING id)
    INSERT INTO audit_events(actor,action,resource_id) SELECT $11,'post.create',id::text FROM written RETURNING resource_id`,
            values,
          )
        : await this.db.query(
            `WITH written AS (UPDATE posts SET slug=$2,title=$3,excerpt=$4,body_markdown=$5,tags=$6,media_ids=$7,cover_image_id=$8,is_demo=$9,status=$10,published_at=CASE WHEN $10='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW(),version=version+1 WHERE id=$1 AND version=$12 RETURNING id)
    INSERT INTO audit_events(actor,action,resource_id) SELECT $11,'post.update',id::text FROM written RETURNING resource_id`,
            [...values, version],
          );
    if (!result.rowCount)
      throw new HttpError(
        412,
        "precondition_failed",
        "The article changed or no longer exists. Reload before saving.",
      );
    return this.adminGet(id);
  }
}
