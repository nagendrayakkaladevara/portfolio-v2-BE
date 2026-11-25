import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import type { Database } from "../src/db/client.js";
import { streamPortfolioAnswer } from "../src/modules/chat/gemini.js";
import {
  buildInteractionInput,
  completedPairs,
  parseTranscript,
  saveAssistantTurn,
  upsertUserTurn,
} from "../src/modules/chat/transcript.js";

vi.mock("../src/modules/chat/gemini.js", () => ({
  streamPortfolioAnswer: vi.fn(),
}));

const streamPortfolioAnswerMock = vi.mocked(streamPortfolioAnswer);

const pg = new PGlite();
const db: Database = {
  async query<T extends Record<string, unknown>>(sql: string, values?: unknown[]) {
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
  GEMINI_API_KEY: "test-key",
});
const app = createApp({ db, env, logger: false });

beforeAll(async () => {
  for (const file of ["001_initial.sql", "003_chat_transcript.sql"]) {
    await pg.exec(
      await readFile(
        new URL(`../migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  }
}, 120000);

afterAll(async () => {
  await pg.close();
});

beforeEach(() => {
  streamPortfolioAnswerMock.mockReset();
});

describe("buildInteractionInput", () => {
  it("includes completed pairs and ends with the new question", () => {
    const input = buildInteractionInput(
      [{ user: "First question", assistant: "First answer" }],
      "Follow-up",
    );
    expect(input).toEqual([
      {
        type: "user_input",
        content: [{ type: "text", text: "First question" }],
      },
      {
        type: "model_output",
        content: [{ type: "text", text: "First answer" }],
      },
      {
        type: "user_input",
        content: [{ type: "text", text: "Follow-up" }],
      },
    ]);
  });

  it("drops transcript turns without assistant text", () => {
    const turns = completedPairs(
      parseTranscript([
        {
          clientMessageId: randomUUID(),
          user: "Hi",
          assistant: "Hello",
        },
        { clientMessageId: randomUUID(), user: "Stopped mid-way" },
      ]),
    );
    expect(turns).toEqual([{ user: "Hi", assistant: "Hello" }]);
    expect(buildInteractionInput(turns, "Next").at(-1)?.type).toBe(
      "user_input",
    );
  });
});

describe("chat transcript persistence", () => {
  it("stores completed turns and passes them as model history", async () => {
    streamPortfolioAnswerMock
      .mockImplementationOnce(async function* () {
        yield "One ";
        yield "reply";
      })
      .mockImplementationOnce(async function* () {
        yield "Two";
      })
      .mockImplementationOnce(async function* () {
        yield "Three";
      });

    const session = await request(app)
      .post("/api/v1/chat/sessions")
      .send({})
      .expect(201);
    const { id, token } = session.body.data;
    const auth = { Authorization: `Bearer ${token}` };

    const firstId = randomUUID();
    await request(app)
      .post(`/api/v1/chat/sessions/${id}/messages`)
      .set(auth)
      .send({
        clientMessageId: firstId,
        content: "Turn one",
        pagePath: "/",
      })
      .expect(200);

    const secondId = randomUUID();
    await request(app)
      .post(`/api/v1/chat/sessions/${id}/messages`)
      .set(auth)
      .send({
        clientMessageId: secondId,
        content: "Turn two",
        pagePath: "/",
      })
      .expect(200);

    const stored = await db.query<{ transcript: unknown }>(
      "SELECT transcript FROM chat_sessions WHERE id=$1",
      [id],
    );
    const transcript = parseTranscript(stored.rows[0]!.transcript);
    expect(transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientMessageId: firstId,
          user: "Turn one",
          assistant: "One reply",
        }),
        expect.objectContaining({
          clientMessageId: secondId,
          user: "Turn two",
          assistant: "Two",
        }),
      ]),
    );

    await request(app)
      .post(`/api/v1/chat/sessions/${id}/messages`)
      .set(auth)
      .send({
        clientMessageId: randomUUID(),
        content: "Turn three",
        pagePath: "/",
      })
      .expect(200);
    expect(streamPortfolioAnswerMock.mock.calls.at(-1)?.[2]).toEqual([
      { user: "Turn one", assistant: "One reply" },
      { user: "Turn two", assistant: "Two" },
    ]);
  });

  it("reuses the same user turn for duplicate clientMessageId", () => {
    const id = randomUUID();
    let transcript = upsertUserTurn([], id, "Hello");
    transcript = upsertUserTurn(transcript, id, "Hello again");
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.user).toBe("Hello again");
    transcript = saveAssistantTurn(transcript, id, "Hi");
    expect(transcript[0]?.assistant).toBe("Hi");
  });
});