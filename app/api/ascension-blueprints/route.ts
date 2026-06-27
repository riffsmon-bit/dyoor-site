import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { ethers } from "ethers";

export const runtime = "nodejs";

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
  "accessories 2",
];

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeAddress(address: string | null | undefined) {
  const value = String(address || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
}

function normalizeTraits(traits: Record<string, unknown> = {}) {
  return TRAITS.reduce<Record<string, string>>((acc, trait) => {
    acc[trait] = String(traits?.[trait] || "").trim();
    return acc;
  }, {});
}

function traitHash(traits: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(normalizeTraits(traits))).digest("hex");
}

function signMessage(wallet: string, traits: Record<string, unknown>) {
  return [
    "DYOOR Ascension Blueprint",
    `Wallet: ${wallet}`,
    `Traits: ${traitHash(traits)}`,
    `Launch: ${LAUNCH_AT}`,
  ].join("\n");
}

function blueprintId(rank: number) {
  return `AB-${String(rank).padStart(4, "0")}`;
}

function badgeTrait() {
  return {
    trait_type: "Ascension Blueprint",
    value: "Architect",
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
      consistency: "strong",
    });
  }

  return getStore({
    name: STORE_NAME,
    consistency: "strong",
  });
}

async function readBlueprints() {
  try {
    const store = getBlobStore();
    const value = await store.get(BLUEPRINTS_KEY, { type: "json", consistency: "strong" });
    return Array.isArray(value) ? value : [];
  } catch {
    const local = await fs.readFile(LOCAL_BLUEPRINTS_PATH, "utf8").catch(() => "[]");
    const value = JSON.parse(local);
    return Array.isArray(value) ? value : [];
  }
}

async function writeBlueprints(blueprints: unknown[]) {
  const store = getBlobStore();
  await store.setJSON(BLUEPRINTS_KEY, blueprints);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = normalizeAddress(url.searchParams.get("wallet"));
  const blueprints = await readBlueprints();
  const registration = wallet
    ? blueprints.find((entry: { wallet?: string }) => normalizeAddress(entry.wallet) === wallet) || null
    : null;

  return Response.json({
    ok: true,
    limit: LIMIT,
    registeredCount: blueprints.length,
    remaining: Math.max(0, LIMIT - blueprints.length),
    full: blueprints.length >= LIMIT,
    registration,
  }, {
    headers: {
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  try {
    const launchBypassed = process.env.ASCENSION_BLUEPRINT_BYPASS_LAUNCH === "1";
    if (!launchBypassed && Date.now() < Date.parse(LAUNCH_AT)) {
      return Response.json({
        ok: false,
        error: "Ascension Blueprint registration has not opened yet.",
        launchAt: LAUNCH_AT,
      }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const wallet = normalizeAddress(body.wallet);
    const traits = normalizeTraits(body.traits);
    const build = body.build && typeof body.build === "object" ? body.build : null;
    const signature = String(body.signature || "");
    const message = String(body.message || "");

    if (!wallet) return Response.json({ ok: false, error: "Missing or invalid wallet." }, { status: 400 });
    if (!signature || !message) return Response.json({ ok: false, error: "Missing wallet signature." }, { status: 400 });

    const expectedMessage = signMessage(wallet, traits);
    if (message !== expectedMessage) {
      return Response.json({ ok: false, error: "Blueprint signature message mismatch." }, { status: 400 });
    }

    let recovered = "";
    try {
      recovered = normalizeAddress(ethers.verifyMessage(message, signature));
    } catch {
      recovered = "";
    }
    if (recovered !== wallet) {
      return Response.json({ ok: false, error: "Signature does not match connected wallet." }, { status: 401 });
    }

    const blueprints = await readBlueprints();
    const existing = blueprints.find((entry: { wallet?: string }) => normalizeAddress(entry.wallet) === wallet);
    if (existing) {
      return Response.json({
        ok: true,
        duplicate: true,
        limit: LIMIT,
        registeredCount: blueprints.length,
        remaining: Math.max(0, LIMIT - blueprints.length),
        full: blueprints.length >= LIMIT,
        registration: existing,
      }, { headers: { "cache-control": "no-store" } });
    }

    if (blueprints.length >= LIMIT) {
      return Response.json({
        ok: false,
        error: "Ascension Blueprint campaign complete.",
        limit: LIMIT,
        registeredCount: blueprints.length,
        remaining: 0,
        full: true,
      }, { status: 409 });
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
      build,
    };

    const next = blueprints.concat(registration);
    await writeBlueprints(next);

    return Response.json({
      ok: true,
      limit: LIMIT,
      registeredCount: next.length,
      remaining: Math.max(0, LIMIT - next.length),
      full: next.length >= LIMIT,
      registration,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Ascension Blueprint API failed.",
    }, { status: 500 });
  }
}
