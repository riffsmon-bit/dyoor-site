const BLUEPRINT_SHARE_IMAGE_PATH = "/blueprint-share-image.png";

const BLUEPRINT_TRAIT_ORDER = [
  "Background",
  "Droid",
  "Condition",
  "Eyes",
  "Clothes",
  "Mouth",
  "Hat",
  "Special",
  "Accessories",
  "Accessories 2",
];

export type BlueprintShareParams = Record<string, string | boolean>;

function htmlEscape(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgEscape(value: unknown) {
  return htmlEscape(value);
}

function prettyTrait(value: unknown) {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blueprintIdForRank(rank: unknown) {
  const value = Number(rank);
  return `AB-${String(Number.isFinite(value) && value > 0 ? Math.floor(value) : 0).padStart(4, "0")}`;
}

export function siteOriginFromRequest(request: Request) {
  const fromEnv = process.env.URL || process.env.SITE_URL || process.env.DEPLOY_PRIME_URL || "";
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(/:$/, "") || "https";
  return host ? `${proto}://${host}` : "https://dyoor.netlify.app";
}

export function blueprintShareParamsFromRequest(request: Request): BlueprintShareParams {
  const url = new URL(request.url);
  const params: BlueprintShareParams = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  params.saved = url.searchParams.get("saved") === "1";
  params.rank = String(url.searchParams.get("rank") || "").trim();
  params.blueprintId = String(url.searchParams.get("blueprintId") || "").trim();
  params.v = String(url.searchParams.get("v") || "").trim();
  return params;
}

export function normalizedBlueprintSelection(params: BlueprintShareParams = {}) {
  return BLUEPRINT_TRAIT_ORDER
    .map((key) => {
      const raw = String(params[key] || "").trim();
      return raw ? { key, value: prettyTrait(raw) } : null;
    })
    .filter(Boolean) as Array<{ key: string; value: string }>;
}

function shareTitle(params: BlueprintShareParams) {
  if (params.saved && params.blueprintId) {
    const rank = Number(params.rank || 0);
    const id = params.blueprintId || blueprintIdForRank(rank);
    return `${id} | DYOOR Ascension Blueprint`;
  }

  return "DYOOR Ascension Blueprint";
}

function cardTitle(params: BlueprintShareParams) {
  if (params.saved && params.blueprintId) {
    const rank = Number(params.rank || 0);
    return String(params.blueprintId || blueprintIdForRank(rank));
  }
  return "DYOOR Blueprint";
}

function shareDescription(params: BlueprintShareParams, selection: Array<{ key: string; value: string }>) {
  if (params.saved && params.rank) {
    return `Saved Blueprint #${params.rank} from the DYOOR Ascension terminal.`;
  }

  if (!selection.length) {
    return "Design your future Droid and share the build.";
  }

  return `${selection.length} trait${selection.length === 1 ? "" : "s"} selected in the DYOOR Ascension Blueprint builder.`;
}

function imageDescription(params: BlueprintShareParams, selection: Array<{ key: string; value: string }>) {
  if (params.saved && params.rank) {
    return `Rank #${params.rank} - ${selection.length} selected traits`;
  }
  return `${selection.length} trait${selection.length === 1 ? "" : "s"} selected`;
}

function canonicalQuery(params: BlueprintShareParams) {
  const query = new URLSearchParams();
  for (const key of BLUEPRINT_TRAIT_ORDER) {
    if (params[key]) query.set(key, String(params[key]));
  }
  if (params.saved) query.set("saved", "1");
  if (params.rank) query.set("rank", String(params.rank));
  if (params.blueprintId) query.set("blueprintId", String(params.blueprintId));
  if (params.v) query.set("v", String(params.v));
  return query.toString();
}

export function buildBlueprintShareSvg({
  origin,
  params,
  selection,
}: {
  origin: string;
  params: BlueprintShareParams;
  selection: Array<{ key: string; value: string }>;
}) {
  const title = cardTitle(params);
  const desc = imageDescription(params, selection);
  const subtitle = params.saved && params.rank ? `Saved Blueprint #${svgEscape(params.rank)}` : "Blueprint build preview";
  const footer = `${origin.replace(/^https?:\/\//, "")}/blueprint-share`;
  const rows = selection.slice(0, 8).map((item, index) => `
    <g transform="translate(0, ${index * 58})">
      <rect x="0" y="0" rx="18" ry="18" width="1040" height="48" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.10)"/>
      <text x="24" y="31" fill="#9df7d7" font-size="18" font-family="Inter, Arial, sans-serif" font-weight="800">${svgEscape(item.key)}</text>
      <text x="220" y="31" fill="#ffffff" font-size="18" font-family="Inter, Arial, sans-serif">${svgEscape(item.value)}</text>
    </g>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg" role="img">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#090c14"/>
      <stop offset="1" stop-color="#05070c"/>
    </linearGradient>
    <linearGradient id="glowA" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#42f1c8" stop-opacity=".28"/>
      <stop offset="1" stop-color="#9d68ff" stop-opacity=".18"/>
    </linearGradient>
    <linearGradient id="glowB" x1="1" y1="0" x2="0" y2="1">
      <stop stop-color="#ff53d8" stop-opacity=".22"/>
      <stop offset="1" stop-color="#42f1c8" stop-opacity=".12"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="210" cy="130" r="220" fill="url(#glowA)"/>
  <circle cx="1020" cy="120" r="180" fill="url(#glowB)"/>
  <rect x="52" y="52" width="1096" height="526" rx="32" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.10)"/>
  <rect x="72" y="72" width="520" height="486" rx="28" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.10)"/>
  <text x="104" y="128" fill="#9df7d7" font-size="18" font-family="Inter, Arial, sans-serif" font-weight="800" letter-spacing="4">DYOOR ASCENSION BLUEPRINT</text>
  <text x="104" y="188" fill="#ffffff" font-size="54" font-family="Inter, Arial, sans-serif" font-weight="900">${svgEscape(title)}</text>
  <text x="104" y="232" fill="rgba(255,255,255,.72)" font-size="22" font-family="Inter, Arial, sans-serif">${subtitle}</text>
  <text x="104" y="274" fill="rgba(255,255,255,.62)" font-size="18" font-family="Inter, Arial, sans-serif">${svgEscape(desc)}</text>
  <rect x="104" y="316" width="198" height="40" rx="20" fill="rgba(66,241,200,.12)" stroke="rgba(66,241,200,.28)"/>
  <text x="128" y="342" fill="#9df7d7" font-size="16" font-family="Inter, Arial, sans-serif" font-weight="800">Shareable on X</text>
  <text x="104" y="392" fill="rgba(255,255,255,.58)" font-size="15" font-family="Inter, Arial, sans-serif">${svgEscape(footer)}</text>
  <g transform="translate(640, 124)">
    <rect x="0" y="0" width="488" height="390" rx="28" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.10)"/>
    <rect x="24" y="24" width="440" height="90" rx="22" fill="rgba(66,241,200,.08)" stroke="rgba(66,241,200,.16)"/>
    <text x="48" y="60" fill="#9df7d7" font-size="18" font-family="Inter, Arial, sans-serif" font-weight="800" letter-spacing="3">BLUEPRINT SNAPSHOT</text>
    <text x="48" y="94" fill="#ffffff" font-size="28" font-family="Inter, Arial, sans-serif" font-weight="900">${svgEscape(params.blueprintId || "Preview")}</text>
    <text x="24" y="154" fill="rgba(255,255,255,.74)" font-size="18" font-family="Inter, Arial, sans-serif">${svgEscape(selection.length ? "Selected Traits" : "No traits selected yet")}</text>
    <g transform="translate(24, 174)">${rows}</g>
  </g>
</svg>`;
}

export function buildBlueprintShareHtml({
  origin,
  params,
  selection,
}: {
  origin: string;
  params: BlueprintShareParams;
  selection: Array<{ key: string; value: string }>;
}) {
  const title = shareTitle(params);
  const description = shareDescription(params, selection);
  const query = canonicalQuery(params);
  const url = `${origin}/blueprint-share${query ? `?${query}` : ""}`;
  const imageUrl = `${origin}${BLUEPRINT_SHARE_IMAGE_PATH}${query ? `?${query}` : ""}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${htmlEscape(description)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:title" content="${htmlEscape(title)}"/>
  <meta property="og:description" content="${htmlEscape(description)}"/>
  <meta property="og:url" content="${htmlEscape(url)}"/>
  <meta property="og:image" content="${htmlEscape(imageUrl)}"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${htmlEscape(title)}"/>
  <meta name="twitter:description" content="${htmlEscape(description)}"/>
  <meta name="twitter:image" content="${htmlEscape(imageUrl)}"/>
  <link rel="canonical" href="${htmlEscape(url)}"/>
  <style>
    :root{color-scheme:dark}
    html,body{margin:0;min-height:100%;background:#05070c;color:#fff;font-family:Inter,system-ui,sans-serif}
    body{display:grid;place-items:center;padding:24px}
    main{width:min(980px,100%);border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.035);padding:28px}
    .eyebrow{color:#9df7d7;letter-spacing:.22em;font-size:12px;font-weight:900;text-transform:uppercase}
    h1{font-size:42px;line-height:.98;margin:12px 0}
    p{color:rgba(255,255,255,.72);line-height:1.55}
    img{display:block;width:100%;max-width:720px;margin-top:24px;border:1px solid rgba(255,255,255,.14);background:#05070c}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">DYOOR Ascension Blueprint</div>
    <h1>${htmlEscape(title)}</h1>
    <p>${htmlEscape(description)}</p>
    <img src="${htmlEscape(imageUrl)}" alt="${htmlEscape(title)}"/>
  </main>
</body>
</html>`;
}
