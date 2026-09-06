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
  "Accessories 2"
];

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function blueprintIdForRank(rank) {
  const value = Number(rank);
  return `AB-${String(Number.isFinite(value) && value > 0 ? Math.floor(value) : 0).padStart(4, "0")}`;
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
  return host ? `${proto}://${host}` : "https://dyoor.fun";
}

function htmlEscape(value) {
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

function normalizeSelection(params = {}) {
  const selection = {};
  for (const key of BLUEPRINT_TRAIT_ORDER) {
    const raw = String(params[key] || "").trim();
    if (raw) selection[key] = prettyTrait(raw);
  }
  return selection;
}

function shareTitle(params) {
  if (params.saved && params.blueprintId) {
    const rank = Number(params.rank || 0);
    const id = params.blueprintId || blueprintIdForRank(rank);
    return `${id} | DYOOR Ascension Blueprint`;
  }

  return "DYOOR Ascension Blueprint";
}

function shareDescription(params, selection) {
  const traitCount = Object.keys(selection).length;
  if (params.saved && params.rank) {
    return `Saved Blueprint #${params.rank} from the DYOOR Ascension terminal.`;
  }

  if (!traitCount) {
    return "Design your future Droid and share the build.";
  }

  return `${traitCount} trait${traitCount === 1 ? "" : "s"} selected in the DYOOR Ascension Blueprint builder.`;
}

function buildShareUrl(origin, params) {
  const query = new URLSearchParams();
  for (const key of BLUEPRINT_TRAIT_ORDER) {
    if (params[key]) query.set(key, params[key]);
  }
  if (params.saved) query.set("saved", "1");
  if (params.rank) query.set("rank", String(params.rank));
  if (params.blueprintId) query.set("blueprintId", params.blueprintId);
  return `${origin}${BLUEPRINT_SHARE_IMAGE_PATH}${query.toString() ? `?${query}` : ""}`;
}

function renderHtml({ origin, params, selection }) {
  const title = shareTitle(params);
  const description = shareDescription(params, selection);
  const url = `${origin}/blueprint-share${new URLSearchParams(params).toString() ? `?${new URLSearchParams(params)}` : ""}`;
  const imageUrl = `${origin}${BLUEPRINT_SHARE_IMAGE_PATH}${new URLSearchParams(params).toString() ? `?${new URLSearchParams(params)}` : ""}`;
  const heroLine = params.saved && params.blueprintId
    ? `${params.blueprintId}${params.rank ? ` • Rank #${params.rank}` : ""}`
    : "Blueprint preview";

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
    main{width:min(1100px,100%)}
    .card{border:1px solid rgba(255,255,255,.12);border-radius:28px;overflow:hidden;background:linear-gradient(180deg, rgba(11,15,23,.98), rgba(7,9,14,.98));box-shadow:0 18px 60px rgba(0,0,0,.45)}
    .hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.84fr);gap:0}
    .copy{padding:34px}
    .eyebrow{color:#9df7d7;letter-spacing:.22em;font-size:12px;font-weight:900;text-transform:uppercase}
    h1{margin:10px 0 12px;font-size:42px;line-height:.95;letter-spacing:-.06em}
    p{margin:0;color:rgba(255,255,255,.78);line-height:1.55}
    .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
    .chip{padding:8px 10px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);font-size:12px;font-weight:800}
    .side{padding:18px;background:
      radial-gradient(420px 260px at 20% 20%, rgba(66,241,200,.16), transparent 60%),
      radial-gradient(420px 260px at 78% 20%, rgba(255,83,216,.16), transparent 60%),
      linear-gradient(180deg, rgba(15,18,28,.98), rgba(8,10,16,.98));
      display:grid;place-items:center}
    .preview{width:100%;max-width:420px;aspect-ratio:1;border-radius:24px;border:1px solid rgba(255,255,255,.14);background:
      linear-gradient(135deg, rgba(66,241,200,.14), rgba(157,104,255,.14)),
      rgba(255,255,255,.03);display:grid;place-items:center;padding:20px;text-align:center}
    .preview strong{display:block;font-size:18px;letter-spacing:.2em;text-transform:uppercase}
    .preview span{display:block;margin-top:12px;color:rgba(255,255,255,.68);font-size:14px;line-height:1.5}
    .footer{padding:0 34px 34px;color:rgba(255,255,255,.52);font-size:12px}
    @media (max-width:900px){.hero{grid-template-columns:1fr} h1{font-size:34px}}
  </style>
</head>
<body>
  <main>
    <section class="card">
      <div class="hero">
        <div class="copy">
          <div class="eyebrow">DYOOR Ascension Blueprint</div>
          <h1>${htmlEscape(title)}</h1>
          <p>${htmlEscape(description)}</p>
          <div class="chips">
            ${heroLine ? `<span class="chip">${htmlEscape(heroLine)}</span>` : ""}
            ${Object.keys(selection).slice(0, 6).map((key) => `<span class="chip">${htmlEscape(key)}: ${htmlEscape(selection[key])}</span>`).join("")}
          </div>
        </div>
        <div class="side">
          <div class="preview">
            <div>
              <strong>Blueprint</strong>
              <span>Share image generated for X preview cards.</span>
            </div>
          </div>
        </div>
      </div>
      <div class="footer">Open this page on X to get the social card preview. The actual post can still point back to the builder.</div>
    </section>
  </main>
</body>
</html>`;
}

export const handler = async function (event) {
  const origin = siteOrigin(event);
  const params = {
    saved: String(event.queryStringParameters?.saved || "") === "1",
    rank: String(event.queryStringParameters?.rank || "").trim(),
    blueprintId: String(event.queryStringParameters?.blueprintId || "").trim(),
    ...event.queryStringParameters
  };
  const selection = normalizeSelection(params);
  const html = renderHtml({ origin, params, selection });

  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300"
    },
    body: html
  };
};
