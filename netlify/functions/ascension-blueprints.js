const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { getStore } = require("@netlify/blobs");
const { ethers } = require("ethers");

const LIMIT = 500;
const LAUNCH_AT = "2026-06-10T12:00:00-04:00";
const STORE_NAME = "ascension-blueprints";
const BLUEPRINTS_KEY = "ascension-blueprints.json";
const LOCAL_BLUEPRINTS_PATH = path.join(process.cwd(), "data", "ascension-blueprints.json");
const TRAITS = [
  "background",
  "droid",
  "condition",
  "eyes",
  "clothes",
  "mouth",
  "hat",
  "special",
  "accessories",
  "accessories 2"
];
const REGISTRATION_ENABLED = process.env.ASCENSION_BLUEPRINT_REGISTRATION_ENABLED === "1";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeAddress(address) {
  const value = String(address || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
}

function normalizeTraits(traits = {}) {
  return TRAITS.reduce((acc, trait) => {
    acc[trait] = String(traits?.[trait] || "").trim();
    return acc;
  }, {});
}

function blueprintId(rank) {
  return `AB-${String(rank).padStart(4, "0")}`;
}

function badgeTrait() {
  return {
    trait_type: "Ascension Blueprint",
    value: "Architect"
  };
}

function traitHash(traits) {
  return createHash("sha256").update(JSON.stringify(normalizeTraits(traits))).digest("hex");
}

function signMessage(wallet, traits) {
  return [
    "DYOOR Ascension Blueprint",
    `Wallet: ${wallet}`,
    `Traits: ${traitHash(traits)}`,
    `Launch: ${LAUNCH_AT}`
  ].join("\n");
}

function currentStatus(blueprints, wallet = "") {
  const normalized = normalizeAddress(wallet);
  const registration = normalized
    ? blueprints.find((entry) => normalizeAddress(entry.wallet) === normalized) || null
    : null;
  const registeredCount = blueprints.length;
  return {
    ok: true,
    registrationOpen: REGISTRATION_ENABLED,
    launchAt: LAUNCH_AT,
    limit: LIMIT,
    registeredCount,
    remaining: Math.max(0, LIMIT - registeredCount),
    full: registeredCount >= LIMIT,
    registration,
    wallets: blueprints.map((entry) => normalizeAddress(entry.wallet)).filter(Boolean)
  };
}

function getBlobStore() {
  const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
  const token = readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_ACCESS_TOKEN", "NETLIFY_AUTH_TOKEN");

  if (siteID && token) {
    return getStore({
      name: STORE_NAME,
      siteID,
      token,
      consistency: "strong"
    });
  }

  return getStore({
    name: STORE_NAME,
    consistency: "strong"
  });
}

async function readBlueprints() {
  try {
    const store = getBlobStore();
    const value = await store.get(BLUEPRINTS_KEY, { type: "json", consistency: "strong" });
    return Array.isArray(value) ? value : [];
  } catch (error) {
    const local = await fs.readFile(LOCAL_BLUEPRINTS_PATH, "utf8").catch(() => "[]");
    const value = JSON.parse(local);
    if (Array.isArray(value)) return value;
    throw error;
  }
}

async function writeBlueprints(blueprints) {
  const store = getBlobStore();
  await store.setJSON(BLUEPRINTS_KEY, blueprints);
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    if (event.httpMethod === "GET") {
      const wallet = event.queryStringParameters?.wallet || "";
      const blueprints = await readBlueprints();
      return json(200, currentStatus(blueprints, wallet));
    }

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    if (!REGISTRATION_ENABLED) {
      return json(410, {
        ok: false,
        registrationOpen: false,
        error: "Ascension Blueprint registration is closed. Use the Blueprint Checker for saved Blueprint verification."
      });
    }

    const launchTime = Date.parse(LAUNCH_AT);
    const launchBypassed = process.env.ASCENSION_BLUEPRINT_BYPASS_LAUNCH === "1";
    if (!launchBypassed && Date.now() < launchTime) {
      return json(403, {
        ok: false,
        error: "Ascension Blueprint registration has not opened yet.",
        launchAt: LAUNCH_AT
      });
    }

    const body = JSON.parse(event.body || "{}");
    const wallet = normalizeAddress(body.wallet);
    const traits = normalizeTraits(body.traits);
    const build = body.build && typeof body.build === "object" ? body.build : null;
    const signature = String(body.signature || "");
    const message = String(body.message || "");

    if (!wallet) return json(400, { ok: false, error: "Missing or invalid wallet." });
    if (!signature || !message) return json(400, { ok: false, error: "Missing wallet signature." });

    const expectedMessage = signMessage(wallet, traits);
    if (message !== expectedMessage) {
      return json(400, { ok: false, error: "Blueprint signature message mismatch." });
    }

    let recovered = "";
    try {
      recovered = normalizeAddress(ethers.verifyMessage(message, signature));
    } catch {
      recovered = "";
    }

    if (recovered !== wallet) {
      return json(401, { ok: false, error: "Signature does not match connected wallet." });
    }

    const blueprints = await readBlueprints();
    const existing = blueprints.find((entry) => normalizeAddress(entry.wallet) === wallet);
    if (existing) {
      return json(200, {
        ...currentStatus(blueprints, wallet),
        duplicate: true,
        registration: existing
      });
    }

    if (blueprints.length >= LIMIT) {
      return json(409, {
        ...currentStatus(blueprints, wallet),
        ok: false,
        error: "Ascension Blueprint campaign complete."
      });
    }

    const rank = blueprints.length + 1;
    const registration = {
      rank,
      wallet,
      blueprintId: blueprintId(rank),
      createdAt: new Date().toISOString(),
      ascensionBlueprint: true,
      badgeTrait: badgeTrait(),
      traits,
      build
    };

    const next = blueprints.concat(registration);
    await writeBlueprints(next);

    return json(200, {
      ...currentStatus(next, wallet),
      registration
    });
  } catch (err) {
    console.error("ascension-blueprints error", err);
    return json(500, { ok: false, error: err?.message || "Ascension Blueprint API failed." });
  }
};
