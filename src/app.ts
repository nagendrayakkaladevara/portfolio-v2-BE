import express, { type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import type { Env } from "./config/env.js";
import type { Database } from "./db/client.js";
import { HttpError, errorHandler } from "./shared/errors.js";
import { ownerAuth } from "./middleware/auth.js";
import { PostgresRateStore, limiter } from "./middleware/rate-limit.js";
import { PostsRepository } from "./modules/posts/repository.js";
import { publicPosts, adminPosts } from "./modules/posts/routes.js";
import { MediaService } from "./modules/media/service.js";
import { mediaRoutes } from "./modules/media/routes.js";
import { chatRoutes } from "./modules/chat/routes.js";
export interface AppDependencies {
  db: Database;
  env: Env;
  ownerGuard?: RequestHandler;
  logger?: boolean;
}
export function createApp({
  db,
  env,
  ownerGuard,
  logger = true,
}: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  // Explicit CIDRs/IPs only. Never trust arbitrary forwarded headers or hop counts.
  if (env.TRUST_PROXY)
    app.set(
      "trust proxy",
      env.TRUST_PROXY.split(",").map((s) => s.trim()),
    );
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set("X-Request-ID", res.locals.requestId);
    next();
  });
  app.use(helmet());
  if (logger)
    app.use(
      pinoHttp({
        genReqId: (_req, res) => res.locals.requestId,
        serializers: {
          req: (req) => ({ method: req.method, url: req.url?.split("?")[0] }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
        ],
        customLogLevel: (_req, res, error) =>
          error || res.statusCode >= 500
            ? "error"
            : res.statusCode >= 400
              ? "warn"
              : "info",
      }),
    );
  const origins = new Set(env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()));
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(
          origin && !origins.has(origin)
            ? new HttpError(403, "origin_denied", "Origin is not allowed.")
            : null,
          true,
        ),
      credentials: false,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "If-Match"],
      exposedHeaders: [
        "ETag",
        "X-Request-ID",
        "Retry-After",
        "RateLimit",
        "RateLimit-Policy",
      ],
      maxAge: 600,
    }),
  );
  const limits = (name: string, n: number, ms = 60000) =>
    limiter(new PostgresRateStore(db, name, env.RATE_LIMIT_SECRET), n, ms);
  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    await db.query("SELECT id FROM posts LIMIT 0");
    await db.query("SELECT post_id FROM post_revisions LIMIT 0");
    res.json({ status: "ok" });
  });
  app.use("/api", limits("api", 120));
  app.use(
    express.json({ limit: "256kb", strict: true, type: "application/json" }),
  );
  app.use((req, _res, next) => {
    if (
      ["POST", "PUT", "PATCH"].includes(req.method) &&
      !req.is("application/json")
    )
      throw new HttpError(
        415,
        "unsupported_media_type",
        "Use application/json.",
      );
    next();
  });
  const posts = new PostsRepository(db, env.R2_PUBLIC_URL);
  app.get("/api/v1/tags", async (_req, res) =>
    res
      .set("Cache-Control", "public, max-age=30")
      .json({ data: await posts.tags() }),
  );
  app.use("/api/v1/posts", publicPosts(posts));
  app.use(
    "/api/v1/chat",
    chatRoutes(
      db,
      limits("chat-session", 5, 3600000),
      limits("chat-message", 10),
    ),
  );
  const admin = express.Router();
  admin.use(
    limits("admin", 30),
    ownerGuard ?? ownerAuth(env),
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
  );
  admin.get("/session", (_req, res) =>
    res.json({
      data: {
        subject: res.locals.owner,
        storageConfigured: Boolean(env.R2_ACCOUNT_ID),
      },
    }),
  );
  admin.use("/posts", adminPosts(posts));
  admin.use(
    "/media",
    limits("media", 10),
    mediaRoutes(new MediaService(db, env)),
  );
  app.use("/api/v1/admin", admin);
  app.use((_req, _res) => {
    throw new HttpError(404, "not_found", "Endpoint not found.");
  });
  app.use(errorHandler);
  return app;
}
