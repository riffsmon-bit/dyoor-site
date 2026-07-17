import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const DEFAULT_S2_LAYER_DIR = "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/layers";
const ROOTS = [
  process.env.DYOOR_S2_LAYER_DIR || "",
  DEFAULT_S2_LAYER_DIR,
  path.join(/* turbopackIgnore: true */ process.cwd(), "dyoor-builder", "layers"),
].filter(Boolean).map((root) => path.resolve(root));

async function existingFile(filePath: string) {
  const parsed = path.parse(filePath);
  const candidates = [
    filePath,
    path.join(parsed.dir, `${parsed.name}.PNG`),
    path.join(parsed.dir, `${parsed.name}.png`),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }

  return "";
}

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await context.params;

  for (const root of ROOTS) {
    const filePath = path.normalize(path.join(root, ...parts));
    if (!filePath.startsWith(root)) continue;

    const found = await existingFile(filePath);
    if (!found) continue;

    try {
      const bytes = await readFile(found);
      const body = new Uint8Array(bytes).buffer;
      return new NextResponse(body, {
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {}
  }

  return new NextResponse("Not found", { status: 404 });
}
