import sharp from "sharp";

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
  "Accessories 2"
];

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function siteOrigin(event) {
  const fromEnv = readEnv("URL", "SITE_URL", "DEPLOY_PRIME_URL");
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const host = event.headers?.["x-forwarded-host"]
    || event.headers?.["X-Forwarded-Host"]
    || event.headers?.host
    || event.headers?.Host
    || "";
  const proto = event.headers?.["x-forwarded-proto"] || event.headers?.["X-Forwarded-Proto"] || "https";
  return host ? `${proto}://${host}` : "https://dyoor.netlify.app";
}

function svgEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function prettyTrait(value) {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blueprintIdForRank(rank) {
  const value = Number(rank);
  return `AB-${String(Number.isFinite(value) && value > 0 ? Math.floor(value) : 0).padStart(4, "0")}`;
}

function normalizedSelection(params = {}) {
  const selection = [];
  for (const key of BLUEPRINT_TRAIT_ORDER) {
    const raw = String(params[key] || "").trim();
    if (raw) selection.push({ key, value: prettyTrait(raw) });
  }
  return selection;
}

function cardTitle(params) {
  if (params.saved && params.blueprintId) {
    const rank = Number(params.rank || 0);
    return `${params.blueprintId || blueprintIdForRank(rank)}`;
  }
  return "DYOOR Blueprint";
}

function description(params, selection) {
  if (params.saved && params.rank) {
    return `Rank #${params.rank} • ${selection.length} selected traits`;
  }
  return `${selection.length} trait${selection.length === 1 ? "" : "s"} selected`;
}

function buildSvg({ origin, params, selection }) {
  const title = cardTitle(params);
  const desc = description(params, selection);
  const subtitle = params.saved && params.rank
    ? `Saved Blueprint #${svgEscape(params.rank)}`
    : "Blueprint build preview";
  const footer = `${origin.replace(/^https?:\/\//, "")}/blueprint-share`;
  const rows = selection.slice(0, 8).map((item, index) => `
    <g transform="translate(0, ${index * 58})">
      <rect x="0" y="0" rx="18" ry="18" width="1040" height="48" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.10)"/>
      <text x="24" y="31" fill="#9df7d7" font-size="18" font-family="Inter, Arial, sans-serif" font-weight="800">${svgEscape(item.key)}</text>
      <text x="220" y="31" fill="#ffffff" font-size="18" font-family="Inter, Arial, sans-serif">${svgEscape(item.value)}</text>
    </g>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title>${svgEscape(title)}</title>
  <desc>${svgEscape(desc)}</desc>
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
  <text x="104" y="232" fill="rgba(255,255,255,.72)" font-size="22" font-family="Inter, Arial, sans-serif">${svgEscape(subtitle)}</text>
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

async function renderPng(svg) {
  return sharp(Buffer.from(svg))
    .resize(1200, 630, { fit: "fill" })
    .png()
    .toBuffer();
}

export const handler = async function (event) {
  const origin = siteOrigin(event);
  const params = {
    saved: String(event.queryStringParameters?.saved || "") === "1",
    rank: String(event.queryStringParameters?.rank || "").trim(),
    blueprintId: String(event.queryStringParameters?.blueprintId || "").trim(),
    ...event.queryStringParameters
  };
  const selection = normalizedSelection(params);
  const svg = buildSvg({ origin, params, selection });
  const png = await renderPng(svg);

  return {
    statusCode: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff"
    },
    body: png.toString("base64"),
    isBase64Encoded: true
  };
};
