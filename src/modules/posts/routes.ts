import { Router } from "express";
import { z } from "zod";
import { postWrite, postQuery, adminPostQuery, slug } from "./schema.js";
import { PostsRepository } from "./repository.js";
import { HttpError } from "../../shared/errors.js";
export function publicPosts(repo: PostsRepository) {
  const router = Router();
  router.get("/", async (req, res) => {
    const q = postQuery.parse(req.query);
    res
      .set("Cache-Control", "public, max-age=30")
      .json(await repo.list(q.limit, q.cursor, q));
  });
  router.get("/:slug", async (req, res) =>
    res
      .set("Cache-Control", "public, max-age=30")
      .json({ data: await repo.get(slug.parse(req.params.slug)) }),
  );
  return router;
}
export function adminPosts(repo: PostsRepository) {
  const router = Router();
  router.get("/", async (req, res) => {
    const q = adminPostQuery.parse(req.query);
    res.json(await repo.adminList(q));
  });
  router.get("/:id/revisions", async (req, res) => {
    res.json(
      await repo.revisions(
        z.uuid().parse(req.params.id),
        postQuery.pick({ limit: true, cursor: true }).parse(req.query),
      ),
    );
  });
  router.get("/:id", async (req, res) => {
    const result = await repo.adminGet(z.uuid().parse(req.params.id));
    res.set("ETag", `"${result.version}"`).json({ data: result.data });
  });
  router.post("/", async (req, res) => {
    const result = await repo.write(
      postWrite.parse(req.body),
      res.locals.owner,
    );
    res
      .status(201)
      .set("ETag", `"${result.version}"`)
      .json({ data: result.data });
  });
  router.put("/:id", async (req, res) => {
    const etag = /^"([1-9]\d*)"$/.exec(req.get("If-Match") ?? "");
    if (!etag)
      throw new HttpError(
        428,
        "precondition_required",
        "Supply the current ETag in If-Match.",
      );
    const version = z.coerce
      .number()
      .int()
      .positive()
      .max(2147483647)
      .parse(etag[1]);
    const result = await repo.write(
      postWrite.parse(req.body),
      res.locals.owner,
      z.uuid().parse(req.params.id),
      version,
    );
    res.set("ETag", `"${result.version}"`).json({ data: result.data });
  });
  return router;
}
