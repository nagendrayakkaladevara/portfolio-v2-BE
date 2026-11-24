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
export function chatConfig(enabled: boolean) {
  return {
    enabled,
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
    disclaimer: enabled
      ? "AI Agent · answers use this portfolio’s public profile."
      : "AI Agent · connection coming soon",
  };
}
export function chatRoutes(
  db: Database,
  sessionLimit: RequestHandler,
  messageLimit: RequestHandler,
  geminiApiKey?: string,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const enabled = Boolean(geminiApiKey);
  router.get("/config", (_req, res) =>
    res.json({ data: chatConfig(enabled) }),
  );
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
    async (req, res) => {
      const body = messageSchema.parse(req.body);
      if (!geminiApiKey)
        throw new HttpError(
          503,
          "ai_not_configured",
          "The AI Agent is not connected yet.",
        );
      const messageId = randomUUID();
      const abort = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, 45_000);
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const write = (type: string, payload: unknown) => {
        if (!res.writableEnded)
          res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      res.status(200);
      res.set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      write("start", {
        type: "start",
        messageId,
        clientMessageId: body.clientMessageId,
      });
      let text = "";
      let finishReason: "stop" | "length" = "stop";
      try {
        const loaded = (await import("./" + "gemini.js")) as {
          streamPortfolioAnswer: (
            apiKey: string,
            question: string,
            signal: AbortSignal,
          ) => AsyncGenerator<string>;
        };
        const { streamPortfolioAnswer } = loaded;
        for await (const chunk of streamPortfolioAnswer(
          geminiApiKey,
          body.content,
          abort.signal,
        )) {
          if (abort.signal.aborted || res.writableEnded) return;
          const room = 8000 - text.length;
          if (room <= 0) {
            finishReason = "length";
            break;
          }
          const piece = chunk.slice(0, Math.min(room, 2048));
          text += piece;
          write("delta", { type: "delta", text: piece });
          if (piece.length < chunk.length) {
            finishReason = "length";
            break;
          }
        }
        if (abort.signal.aborted || res.writableEnded) return;
        if (!text.trim()) {
          write("error", {
            type: "error",
            code: "content_unavailable",
            retryable: true,
          });
        } else {
          write("done", {
            type: "done",
            messageId,
            text,
            sources: [],
            finishReason,
            knowledgeVersion: "portfolio-public",
          });
        }
        res.end();
      } catch {
        if (!res.writableEnded) {
          write("error", {
            type: "error",
            code: timedOut
              ? "generation_failed"
              : abort.signal.aborted
                ? "cancelled"
                : "generation_failed",
            retryable: !abort.signal.aborted || timedOut,
          });
          res.end();
        }
      } finally {
        clearTimeout(timer);
      }
    },
  );
  return router;
}
