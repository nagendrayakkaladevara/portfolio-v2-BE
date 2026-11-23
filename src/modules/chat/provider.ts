/** Provider-neutral contract. Implement only after the AI endpoint is specified.
 * An implementation must enforce timeouts, validate output, and return ONLY retrieved citation IDs.
 * No browser, shell, database-write or arbitrary URL tools belong in this public agent.
 */
export interface KnowledgeDocument {
  id: string;
  title: string;
  url: string;
  text: string;
  version: string;
}
export interface AgentRequest {
  question: string;
  history: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
  documents: ReadonlyArray<KnowledgeDocument>;
  signal: AbortSignal;
}
export interface AgentAnswer {
  text: string;
  citationIds: string[];
  finishReason: "stop" | "length";
}
export interface AgentProvider {
  generate(request: AgentRequest): Promise<AgentAnswer>;
}
// No guessed endpoint/protocol/API key. Chat routes deliberately remain disabled.
