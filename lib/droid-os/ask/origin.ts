import { AskError } from "./schema.ts";
export function assertAskOrigin(request: Request, previewOrigin: string, localMode = false) {
  const origin = request.headers.get("origin") || "";
  const url = new URL(request.url);
  let local = false;
  try {
    const supplied = new URL(origin);
    local = localMode && !previewOrigin && ["localhost", "127.0.0.1"].includes(url.hostname)
      && ["localhost", "127.0.0.1"].includes(supplied.hostname) && supplied.origin === origin
      && supplied.protocol === url.protocol && supplied.port === url.port;
  } catch { /* deny malformed origins */ }
  const expected = previewOrigin || (local ? origin : "");
  if (!expected || origin !== expected || !request.headers.get("content-type")?.startsWith("application/json")) throw new AskError("Same-origin JSON request required.", 403);
  return origin;
}
