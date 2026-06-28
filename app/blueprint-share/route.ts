import {
  blueprintShareParamsFromRequest,
  buildBlueprintShareHtml,
  normalizedBlueprintSelection,
  siteOriginFromRequest,
} from "@/lib/blueprintShare";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = siteOriginFromRequest(request);
  const params = blueprintShareParamsFromRequest(request);
  const selection = normalizedBlueprintSelection(params);
  const html = buildBlueprintShareHtml({ origin, params, selection });

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
