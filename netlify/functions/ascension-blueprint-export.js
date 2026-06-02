const { getStore } = require("@netlify/blobs");

const STORE_NAME = "ascension-blueprints";
const BLUEPRINTS_KEY = "ascension-blueprints.json";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body, null, 2)
  };
}

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function getToken(event) {
  return event.queryStringParameters?.token
    || event.headers?.["x-ascension-admin-token"]
    || event.headers?.["X-Ascension-Admin-Token"]
    || "";
}

async function readBlueprints() {
  const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
  const token = readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_ACCESS_TOKEN", "NETLIFY_AUTH_TOKEN");
  const storeConfig = siteID && token
    ? { name: STORE_NAME, siteID, token, consistency: "strong" }
    : { name: STORE_NAME, consistency: "strong" };
  const store = getStore({
    ...storeConfig
  });
  const value = await store.get(BLUEPRINTS_KEY, { type: "json", consistency: "strong" });
  return Array.isArray(value) ? value : [];
}

exports.handler = async function (event) {
  try {
    const adminToken = process.env.ASCENSION_BLUEPRINT_ADMIN_TOKEN || "";
    if (!adminToken) {
      return json(500, {
        ok: false,
        error: "Missing ASCENSION_BLUEPRINT_ADMIN_TOKEN."
      });
    }

    if (getToken(event) !== adminToken) {
      return json(401, {
        ok: false,
        error: "Unauthorized."
      });
    }

    const blueprints = await readBlueprints();
    const wallets = blueprints
      .map((entry) => String(entry.wallet || "").trim().toLowerCase())
      .filter(Boolean);

    return json(200, {
      ok: true,
      count: blueprints.length,
      blueprints,
      wallets
    });
  } catch (err) {
    console.error("ascension-blueprint-export error", err);
    return json(500, {
      ok: false,
      error: err?.message || "Ascension Blueprint export failed."
    });
  }
};
