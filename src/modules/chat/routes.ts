import { Router, type RequestHandler } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { HttpError } from "../../shared/errors.js";
export const messageSchema = z.strictObject({
  clientMessageId: z.uuid(),
  content: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)),
  pagePath: z
    .string()
    .max(240)
    .regex(/^\/(?![/\\])[^\\\s?#]*$/),
});
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const chatConfig = {
  enabled: false,
  title: "Ask about Sai",
  welcomeMessage:
    "Explore Sai’s work, projects, and the ideas behind what he builds.",
  suggestedQuestions: [
    "What does Sai work on?",
    "Show me his projects",
    "What are his main skills?",
    "How can I get in touch?",
  ],
  maxMessageLength: 2000,
  disclaimer: "AI Agent · connection coming soon",
};
export function chatRoutes(
  db: Database,
  sessionLimit: RequestHandler,
  messageLimit: RequestHandler,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/config", (_req, res) => res.json({ data: chatConfig }));
  // Capability sessions are implemented independently; generation remains fail-closed.
  router.post("/sessions", sessionLimit, async (req, res) => {
    z.strictObject({}).parse(req.body);
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      expiresAt = new Date(Date.now() + 3600000);
    await db.query(
      "INSERT INTO chat_sessions(id,token_hash,expires_at) VALUES($1,$2,$3)",
      [id, hashToken(token), expiresAt],
    );
    res
      .status(201)
      .json({ data: { id, token, expiresAt: expiresAt.toISOString() } });
  });
  const authorize: RequestHandler = async (req, res, next) => {
    const id = z.uuid().parse(req.params.id);
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      req.headers.authorization ?? "",
    )?.[1];
    if (!token)
      throw new HttpError(
        401,
        "unauthorized",
        "A valid chat session token is required.",
      );
    const { rows } = await db.query(
      "SELECT id FROM chat_sessions WHERE id=$1 AND token_hash=$2 AND expires_at>NOW()",
      [id, hashToken(token)],
    );
    if (!rows[0])
      throw new HttpError(
        401,
        "unauthorized",
        "Chat session is missing or expired.",
      );
    res.locals.sessionId = id;
    next();
  };
  router.get("/sessions/:id", authorize, (_req, res) =>
    res.json({ data: { id: res.locals.sessionId, messages: [] } }),
  );
  router.delete("/sessions/:id", authorize, async (_req, res) => {
    await db.query("DELETE FROM chat_sessions WHERE id=$1", [
      res.locals.sessionId,
    ]);
    res.status(204).end();
  });
  router.post(
    "/sessions/:id/messages",
    messageLimit,
    authorize,
    (req, _res) => {
      messageSchema.parse(req.body);
      throw new HttpError(
        503,
        "ai_not_configured",
        "The AI Agent is not connected yet.",
      );
    },
  );
  return router;
}
