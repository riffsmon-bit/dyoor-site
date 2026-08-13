import {
  hoodYoorTraitsAreCompatible,
  renderHoodYoorPackedSvg,
} from "@/lib/hoodyoor-reroll-catalog.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const traits = String(new URL(request.url).searchParams.get("traits") || "").trim();
    if (!/^\d{1,48}$/.test(traits) || !hoodYoorTraitsAreCompatible(traits)) {
      return new Response("Invalid HoodYØØR traits.", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    const svg = renderHoodYoorPackedSvg(traits);
    return new Response(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Invalid HoodYØØR traits.", {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
}
