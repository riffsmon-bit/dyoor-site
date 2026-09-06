import { AskError } from "./schema.ts";
export function assertAskOrigin(request: Request, previewOrigin: string) {
  const origin = request.headers.get("origin") || "";
  const url = new URL(request.url);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname) && !previewOrigin;
  const expected = previewOrigin || (local ? url.origin : "");
  if (!expected || origin !== expected || !request.headers.get("content-type")?.startsWith("application/json")) throw new AskError("Same-origin JSON request required.", 403);
  return origin;
}
