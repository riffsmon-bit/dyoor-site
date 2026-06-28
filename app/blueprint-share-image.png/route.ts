import {
  blueprintShareParamsFromRequest,
  buildBlueprintShareSvg,
  normalizedBlueprintSelection,
  siteOriginFromRequest,
} from "@/lib/blueprintShare";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = siteOriginFromRequest(request);
  const params = blueprintShareParamsFromRequest(request);
  const selection = normalizedBlueprintSelection(params);
  const svg = buildBlueprintShareSvg({ origin, params, selection });

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
