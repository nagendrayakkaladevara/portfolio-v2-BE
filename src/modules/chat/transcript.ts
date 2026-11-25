import { z } from "zod";

export const MAX_COMPLETED_PAIRS = 8;
export const MAX_USER_STORED = 2000;
export const MAX_ASSISTANT_STORED = 4000;

const turnSchema = z.object({
  clientMessageId: z.uuid(),
  user: z.string().max(MAX_USER_STORED),
  assistant: z.string().max(MAX_ASSISTANT_STORED).optional(),
});

export type TranscriptTurn = z.infer<typeof turnSchema>;

export type CompletedPair = { user: string; assistant: string };

export type InteractionStep =
  | {
      type: "user_input";
      content: [{ type: "text"; text: string }];
    }
  | {
      type: "model_output";
      content: [{ type: "text"; text: string }];
    };

export function capText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function parseTranscript(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = turnSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function completedPairs(turns: TranscriptTurn[]): CompletedPair[] {
  return turns
    .filter((turn) => Boolean(turn.assistant?.trim()))
    .slice(-MAX_COMPLETED_PAIRS)
    .map((turn) => ({ user: turn.user, assistant: turn.assistant!.trim() }));
}

export function buildInteractionInput(
  completed: CompletedPair[],
  question: string,
): InteractionStep[] {
  const steps: InteractionStep[] = [];
  for (const pair of completed) {
    steps.push({
      type: "user_input",
      content: [{ type: "text", text: pair.user }],
    });
    steps.push({
      type: "model_output",
      content: [{ type: "text", text: pair.assistant }],
    });
  }
  steps.push({
    type: "user_input",
    content: [{ type: "text", text: question }],
  });
  return steps;
}

export function upsertUserTurn(
  transcript: TranscriptTurn[],
  clientMessageId: string,
  user: string,
): TranscriptTurn[] {
  const capped = capText(user.trim(), MAX_USER_STORED);
  const index = transcript.findIndex(
    (turn) => turn.clientMessageId === clientMessageId,
  );
  if (index >= 0) {
    const next = [...transcript];
    const existing = next[index]!;
    next[index] = { ...existing, user: capped };
    return next;
  }
  return [...transcript, { clientMessageId, user: capped }];
}

export function saveAssistantTurn(
  transcript: TranscriptTurn[],
  clientMessageId: string,
  assistant: string,
): TranscriptTurn[] {
  const capped = capText(assistant.trim(), MAX_ASSISTANT_STORED);
  if (!capped) return transcript;
  const index = transcript.findIndex(
    (turn) => turn.clientMessageId === clientMessageId,
  );
  if (index < 0) return transcript;
  const next = [...transcript];
  const existing = next[index]!;
  next[index] = { ...existing, assistant: capped };
  return next;
}