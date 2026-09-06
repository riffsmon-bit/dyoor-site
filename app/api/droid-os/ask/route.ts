import { NextResponse } from "next/server";
import path from "node:path";
import { AskError, object, parseOperation } from "@/lib/droid-os/ask/schema";
import { blobAskStore, localAskStore } from "@/lib/droid-os/ask/storage";
import { createOwnerReader } from "@/lib/droid-os/ask/ownership";
import { configuredIntelligence } from "@/lib/droid-os/ask/intelligence";
import { createAskService } from "@/lib/droid-os/ask/service";
import { assertAskOrigin } from "@/lib/droid-os/ask/origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store, private", "Vary": "Origin" };
function gate() {
  if (process.env.DROID_OS_UI_PREVIEW !== "true") throw new AskError("Not found.", 404);
}
function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof AskError ? error.message : "ASK service unavailable. Nothing was authorized. Try again." }, { status: error instanceof AskError ? error.status : 503, headers });
}
export async function GET() {
  try { gate(); return NextResponse.json({ version: 1, mode: "ASK", aiReady: configuredIntelligence().ready, training: "owner-signed", execution: false }, { headers }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    gate();
    const origin = assertAskOrigin(request, process.env.DROID_OS_PREVIEW_ORIGIN || "");
    // Streaming limit applies even if Content-Length is absent or misleading.
    const reader = request.body?.getReader();
    if (!reader) throw new AskError("Missing request.");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 20000) { await reader.cancel(); throw new AskError("Request too large.", 413); } chunks.push(value); }
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const input = object(raw, raw.stage === "challenge" ? ["stage", "operation"] : ["stage", "operation", "id", "signature"]);
    const op = parseOperation(input.operation);
    const store = process.env.NETLIFY || process.env.DEPLOY_ID ? blobAskStore() : localAskStore(path.join(process.cwd(), "data/runtime/droid-os-ask"));
    const ai = configuredIntelligence();
    const service = createAskService({ store, owners: createOwnerReader(), intelligence: ai.orchestrator, aiReady: ai.ready });
    const result = input.stage === "challenge" ? await service.challenge(origin, op) : input.stage === "perform" ? await service.perform(origin, op, String(input.id), String(input.signature)) : null;
    if (!result) throw new AskError("Unsupported stage.");
    return NextResponse.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}
