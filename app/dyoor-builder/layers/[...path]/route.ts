import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const ROOT = path.join(process.cwd(), "dyoor-builder", "layers");

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await context.params;
  const filePath = path.normalize(path.join(ROOT, ...parts));

  if (!filePath.startsWith(ROOT)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const bytes = await readFile(filePath);
    const body = new Uint8Array(bytes).buffer;
    return new NextResponse(body, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
