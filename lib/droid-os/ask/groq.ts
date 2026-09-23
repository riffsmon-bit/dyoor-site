import { AskError } from "./schema.ts";
import { askInstructions, parseReply, replySchema, type ChatInput, type DroidAIProvider } from "./provider-contract.ts";

// Reviewed model only. Neither users nor retrieved content can choose a model,
// endpoint or tools. A different model requires explicit review and tests.
export const GROQ_MODEL = "openai/gpt-oss-20b";
export const GROQ_REQUEST_BYTES = 6000;

export function groqRequest(input: ChatInput) {
  const history = [...input.state.messages];
  const build = () => JSON.stringify({
    model: GROQ_MODEL, stream: false, n: 1, max_completion_tokens: 1000,
    reasoning_effort: "low", include_reasoning: false,
    messages: [
      { role: "system", content: askInstructions(input.tokenId) + " Some older conversation may be omitted to fit the free-tier context budget. Keep replies under 250 words." },
      { role: "user", content: JSON.stringify({ untrustedTraining: input.state.training, untrustedConversation: history, message: input.message }) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "droid_ask_reply_v1", strict: true, schema: replySchema } },
  });
  let body = build();
  // Trim context, never the durable record or current message/preferences.
  // Bytes are a conservative size budget, not a claim of exact tokenization.
  while (Buffer.byteLength(body, "utf8") > GROQ_REQUEST_BYTES && history.length) {
    history.splice(0, 2); body = build();
  }
  if (Buffer.byteLength(body, "utf8") > GROQ_REQUEST_BYTES) throw new AskError("Training and message exceed the free AI context budget. Shorten your instructions or message and try again.", 413);
  return body;
}

export function groqProvider(config: { key: string }, fetcher: typeof fetch = fetch): DroidAIProvider {
  return { id: "groq", getCapabilities: () => ["DROID_CHAT", "MISSION_RESEARCH_DRAFT"], async chat(input) {
    const requestBody = groqRequest(input);
    const start = Date.now();
    const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` }, body: requestBody,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AskError(response.status === 429 ? "Free AI quota reached. Please try later. No action occurred." : "AI provider unavailable. No action occurred.", 503);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AskError("Empty AI response.", 502);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 64000) { await reader.cancel(); throw new AskError("AI response exceeded its size limit.", 502); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.model !== GROQ_MODEL || !Array.isArray(body.choices) || body.choices.length !== 1) throw new AskError("Unexpected AI response.", 502);
    const choice = body.choices[0], message = choice?.message;
    if (choice?.finish_reason !== "stop" || message?.role !== "assistant" || typeof message.content !== "string" || message.refusal || message.function_call || message.tool_calls?.length || body.executed_tools?.length) throw new AskError("AI declined or returned unsupported output. No action occurred.", 502);
    const reply = parseReply(JSON.parse(message.content));
    const usage = body.usage;
    if (!Number.isSafeInteger(usage?.prompt_tokens) || usage.prompt_tokens < 0 || !Number.isSafeInteger(usage?.completion_tokens) || usage.completion_tokens < 0 || usage.completion_tokens > 1000) throw new AskError("AI usage evidence unavailable.", 502);
    return { reply, usage: { provider: "groq", model: GROQ_MODEL, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, durationMs: Date.now() - start, promptVersion: "droid-ask-groq-v1", costUsd: null } };
  } };
}
