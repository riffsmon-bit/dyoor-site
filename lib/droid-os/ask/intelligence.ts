import { AskError, type State } from "./schema.ts";
import { askInstructions, parseReply, replySchema, type DroidAIProvider } from "./provider-contract.ts";
import { GROQ_MODEL, groqProvider } from "./groq.ts";
export { parseReply } from "./provider-contract.ts";
export type { Reply, Usage, DroidAIProvider } from "./provider-contract.ts";
export function openAIProvider(config: { key: string; model: string }, fetcher: typeof fetch = fetch): DroidAIProvider {
  return { id: "openai", getCapabilities: () => ["DROID_CHAT", "MISSION_RESEARCH_DRAFT"], async chat(input) {
    const start = Date.now();
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, store: false, max_output_tokens: 1000,
        instructions: askInstructions(input.tokenId),
        input: [{ role: "user", content: JSON.stringify({ untrustedTraining: input.state.training, untrustedConversation: input.state.messages, message: input.message }) }],
        text: { format: { type: "json_schema", name: "droid_ask_reply_v1", strict: true, schema: replySchema } },
      }),
    });
    if (!response.ok) throw new AskError("AI provider is unavailable or its quota was reached. No action occurred.", 503);
    const reader = response.body?.getReader();
    if (!reader) throw new AskError("Empty AI response.", 502);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 64000) { await reader.cancel(); throw new AskError("AI response exceeded its size limit.", 502); } chunks.push(value); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.status !== "completed" || !Array.isArray(body.output)) throw new AskError("AI response was incomplete. No action occurred.", 502);
    const parts = body.output.flatMap((item: { type?: string; content?: unknown[] }) => {
      if (item.type === "reasoning") return [];
      if (item.type !== "message" || !Array.isArray(item.content)) throw new AskError("Unexpected AI output type.", 502);
      return item.content;
    });
    if (parts.length !== 1 || parts[0]?.type !== "output_text") throw new AskError("AI declined or returned unsupported output.", 502);
    const reply = parseReply(JSON.parse(parts[0].text));
    const usage = body.usage;
    if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0) throw new AskError("AI usage evidence unavailable.", 502);
    return { reply, usage: { provider: "openai", model: config.model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, durationMs: Date.now() - start, promptVersion: "droid-ask-v1", costUsd: null } };
  } };
}
export class DroidIntelligenceOrchestrator {
  private providers: DroidAIProvider[];
  constructor(providers: DroidAIProvider[]) { this.providers = providers; }
  getAdmissionLimits() {
    const provider = this.providers.find(p => p.getCapabilities().includes("DROID_CHAT"));
    return provider?.id === "groq" ? { key: "groq-preview-v1", perMinute: 1, perDay: 25 } : null;
  }
  async chat(input: { tokenId: string; state: State; message: string }) {
    // No automatic retries: a timed-out paid call may still be billable. Future
    // routing must reserve each attempt separately and retain these boundaries.
    const provider = this.providers.find(p => p.getCapabilities().includes("DROID_CHAT"));
    if (!provider) throw new AskError("AI is not configured yet. Training can still be saved.", 503);
    const result = await provider.chat(input);
    return { ...result, reply: parseReply(result.reply) };
  }
}
export function configuredIntelligence(env: Record<string, string | undefined> = {
  // Explicit references let Next inline only these non-secret build settings.
  DROID_AI_ENABLED: process.env.DROID_AI_ENABLED,
  DROID_AI_PROVIDER: process.env.DROID_AI_PROVIDER,
  DROID_AI_MODEL: process.env.DROID_AI_MODEL,
  DROID_AI_GROQ_API_KEY: process.env.DROID_AI_GROQ_API_KEY,
  DROID_AI_OPENAI_API_KEY: process.env.DROID_AI_OPENAI_API_KEY,
}) {
  const enabled = env.DROID_AI_ENABLED === "true";
  const provider = env.DROID_AI_PROVIDER || "openai"; // Preserve explicitly configured legacy OpenAI setups.
  const model = env.DROID_AI_MODEL || "";
  const providers: DroidAIProvider[] = [];
  if (enabled && provider === "groq" && model === GROQ_MODEL && env.DROID_AI_GROQ_API_KEY?.trim()) providers.push(groqProvider({ key: env.DROID_AI_GROQ_API_KEY.trim() }));
  if (enabled && provider === "openai" && /^[a-zA-Z0-9._-]{1,100}$/.test(model) && env.DROID_AI_OPENAI_API_KEY?.trim()) providers.push(openAIProvider({ key: env.DROID_AI_OPENAI_API_KEY.trim(), model }));
  return { ready: providers.length === 1, orchestrator: new DroidIntelligenceOrchestrator(providers) };
}
