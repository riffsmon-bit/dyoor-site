import { createServer } from "node:http";
import { createHash } from "node:crypto";
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { verifyMessage } from "ethers";
import quoteHandler from "./netlify/functions/quote.js";
import energyBankCreditHandler from "./netlify/functions/energy-bank-credit.js";

const root = process.cwd();
const preferredPort = Number(process.env.PORT || 8888);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function safeFilePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const publicTokenPath = cleanPath.startsWith("/tokens/") ? `/public${cleanPath}` : "";
  const filePath = publicTokenPath || (cleanPath === "/" ? "/index.html" : cleanPath);
  const resolved = path.resolve(root, `.${filePath}`);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handleFunction(req, res, handler) {
  const body = await readRequestBody(req);
  const host = req.headers.host || `localhost:${preferredPort}`;
  const request = new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: body.length ? body : undefined,
  });
  const response = await handler(request);
  const responseBody = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(response.headers.entries());
  send(res, response.status, responseBody, headers);
}

function normalizeAddress(address) {
  const trimmed = String(address || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed.toLowerCase() : "";
}

const BLUEPRINT_LIMIT = 500;
const BLUEPRINT_LAUNCH_AT = "2026-06-10T12:00:00-04:00";
const BLUEPRINT_TRAITS = ["background", "droid", "condition", "eyes", "clothes", "mouth", "hat", "accessories"];

function normalizeBlueprintTraits(traits = {}) {
  return BLUEPRINT_TRAITS.reduce((acc, trait) => {
    acc[trait] = String(traits?.[trait] || "").trim();
    return acc;
  }, {});
}

function blueprintId(rank) {
  return `AB-${String(rank).padStart(4, "0")}`;
}

function blueprintTraitHash(traits) {
  return createHash("sha256").update(JSON.stringify(normalizeBlueprintTraits(traits))).digest("hex");
}

function blueprintSignMessage(wallet, traits) {
  return [
    "DYOOR Ascension Blueprint",
    `Wallet: ${wallet}`,
    `Traits: ${blueprintTraitHash(traits)}`,
    `Launch: ${BLUEPRINT_LAUNCH_AT}`
  ].join("\n");
}

async function readLocalBlueprints() {
  try {
    const text = await readFile(path.join(root, "data/ascension-blueprints.json"), "utf8");
    const parsed = JSON.parse(text || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalBlueprints(blueprints) {
  const wallets = blueprints.map((entry) => normalizeAddress(entry.wallet)).filter(Boolean);
  await writeFile(path.join(root, "data/ascension-blueprints.json"), `${JSON.stringify(blueprints, null, 2)}\n`, "utf8");
  await writeFile(path.join(root, "data/ascension-blueprint-wallets.json"), `${JSON.stringify(wallets, null, 2)}\n`, "utf8");
}

function blueprintStatus(blueprints, wallet = "") {
  const normalized = normalizeAddress(wallet);
  const registration = normalized ? blueprints.find((entry) => normalizeAddress(entry.wallet) === normalized) || null : null;
  return {
    ok: true,
    launchAt: BLUEPRINT_LAUNCH_AT,
    limit: BLUEPRINT_LIMIT,
    registeredCount: blueprints.length,
    remaining: Math.max(0, BLUEPRINT_LIMIT - blueprints.length),
    full: blueprints.length >= BLUEPRINT_LIMIT,
    registration,
    wallets: blueprints.map((entry) => normalizeAddress(entry.wallet)).filter(Boolean)
  };
}

async function handleLocalAscensionBlueprints(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${preferredPort}`}`);
  const blueprints = await readLocalBlueprints();

  if (req.method === "GET") {
    send(res, 200, JSON.stringify(blueprintStatus(blueprints, url.searchParams.get("wallet"))), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, JSON.stringify({ ok: false, error: "Method not allowed" }), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  if (process.env.ASCENSION_BLUEPRINT_BYPASS_LAUNCH !== "1" && Date.now() < Date.parse(BLUEPRINT_LAUNCH_AT)) {
    send(res, 403, JSON.stringify({ ok: false, error: "Ascension Blueprint registration has not opened yet.", launchAt: BLUEPRINT_LAUNCH_AT }), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  const body = JSON.parse((await readRequestBody(req)).toString("utf8") || "{}");
  const wallet = normalizeAddress(body.wallet);
  const traits = normalizeBlueprintTraits(body.traits);
  const message = String(body.message || "");
  const signature = String(body.signature || "");

  if (!wallet) {
    send(res, 400, JSON.stringify({ ok: false, error: "Missing or invalid wallet." }), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  if (message !== blueprintSignMessage(wallet, traits)) {
    send(res, 400, JSON.stringify({ ok: false, error: "Blueprint signature message mismatch." }), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  let recovered = "";
  try {
    recovered = normalizeAddress(verifyMessage(message, signature));
  } catch {}

  if (recovered !== wallet) {
    send(res, 401, JSON.stringify({ ok: false, error: "Signature does not match connected wallet." }), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  const existing = blueprints.find((entry) => normalizeAddress(entry.wallet) === wallet);
  if (existing) {
    send(res, 200, JSON.stringify({ ...blueprintStatus(blueprints, wallet), duplicate: true, registration: existing }), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  if (blueprints.length >= BLUEPRINT_LIMIT) {
    send(res, 409, JSON.stringify({ ...blueprintStatus(blueprints, wallet), ok: false, error: "Ascension Blueprint campaign complete." }), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  const rank = blueprints.length + 1;
  const registration = {
    rank,
    wallet,
    blueprintId: blueprintId(rank),
    createdAt: new Date().toISOString(),
    ascensionBlueprint: true,
    badgeTrait: { trait_type: "Ascension Blueprint", value: "Architect" },
    traits
  };
  const next = blueprints.concat(registration);
  await writeLocalBlueprints(next);
  send(res, 200, JSON.stringify({ ...blueprintStatus(next, wallet), registration }), { "content-type": "application/json; charset=utf-8" });
}

function toBigInt(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

async function readLocalHarvestLedger() {
  try {
    const text = await readFile(path.join(root, "data/harvested-energy.json"), "utf8");
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLocalHarvestLedger(ledger) {
  await writeFile(
    path.join(root, "data/harvested-energy.json"),
    `${JSON.stringify(ledger, null, 2)}\n`,
    "utf8"
  );
}

async function handleLocalHarvestedLedger(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${preferredPort}`}`);
  const ledger = await readLocalHarvestLedger();

  if (req.method === "GET") {
    const address = normalizeAddress(url.searchParams.get("address"));
    if (!address) {
      send(res, 400, JSON.stringify({ ok: false, error: "Missing or invalid address" }), { "content-type": "application/json; charset=utf-8" });
      return;
    }
    send(res, 200, JSON.stringify({ ok: true, address, harvestedRaw: String(ledger[address]?.harvestedRaw || "0") }), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  if (req.method === "POST") {
    const body = JSON.parse((await readRequestBody(req)).toString("utf8") || "{}");
    const action = String(body.action || "");
    const address = normalizeAddress(body.address);
    if (!address) {
      send(res, 400, JSON.stringify({ ok: false, error: "Missing or invalid address" }), { "content-type": "application/json; charset=utf-8" });
      return;
    }
    if (action !== "recordHarvest" && action !== "seedHarvest") {
      send(res, 400, JSON.stringify({ ok: false, error: "Unsupported action" }), { "content-type": "application/json; charset=utf-8" });
      return;
    }

    const amountRaw = toBigInt(body.amountRaw);
    if (amountRaw <= 0n) {
      send(res, 400, JSON.stringify({ ok: false, error: "Invalid amountRaw" }), { "content-type": "application/json; charset=utf-8" });
      return;
    }

    const txHash = String(body.txHash || "").toLowerCase();
    const current = ledger[address] || { harvestedRaw: "0", claims: [] };
    const claims = Array.isArray(current.claims) ? current.claims : [];

    if (txHash && claims.some((claim) => String(claim.txHash || "").toLowerCase() === txHash)) {
      send(res, 200, JSON.stringify({ ok: true, deduped: true, address, harvestedRaw: String(current.harvestedRaw || "0") }), { "content-type": "application/json; charset=utf-8" });
      return;
    }

    const next = toBigInt(current.harvestedRaw) + amountRaw;
    ledger[address] = {
      harvestedRaw: next.toString(),
      claims: txHash
        ? claims.concat([{ txHash, amountRaw: amountRaw.toString(), seeded: action === "seedHarvest", recordedAt: new Date().toISOString() }])
        : claims
    };

    await writeLocalHarvestLedger(ledger);
    send(res, 200, JSON.stringify({ ok: true, address, harvestedRaw: ledger[address].harvestedRaw }), { "content-type": "application/json; charset=utf-8" });
    return;
  }

  send(res, 405, JSON.stringify({ ok: false, error: "Method not allowed" }), { "content-type": "application/json; charset=utf-8" });
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      send(res, 200, "ok", { "content-type": "text/plain; charset=utf-8" });
      return;
    }

    if (req.url?.startsWith("/.netlify/functions/quote")) {
      await handleFunction(req, res, quoteHandler);
      return;
    }

    if (req.url?.startsWith("/.netlify/functions/energy-bank-credit")) {
      await handleFunction(req, res, energyBankCreditHandler);
      return;
    }

    if (req.url?.startsWith("/.netlify/functions/harvested-ledger")) {
      await handleLocalHarvestedLedger(req, res);
      return;
    }

    if (req.url?.startsWith("/.netlify/functions/ascension-blueprints")) {
      await handleLocalAscensionBlueprints(req, res);
      return;
    }

    if (req.url === "/swap" || req.url === "/swap/") {
      send(res, 302, "", { location: "/#swap" });
      return;
    }

    if (req.url === "/verify" || req.url === "/verify/") {
      send(res, 200, await readFile(path.join(root, "verify.html")), { "content-type": "text/html; charset=utf-8" });
      return;
    }

    if (req.url === "/blueprint-checker" || req.url === "/blueprint-checker/") {
      send(res, 200, await readFile(path.join(root, "blueprint-checker.html")), { "content-type": "text/html; charset=utf-8" });
      return;
    }

    const filePath = safeFilePath(req.url || "/");
    if (!filePath || !existsSync(filePath)) {
      send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
      return;
    }

    const body = await readFile(filePath);
    const type = types.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    send(res, 200, body, { "content-type": type });
  } catch (err) {
    console.error(err);
    send(res, 500, "Local dev server error", { "content-type": "text/plain; charset=utf-8" });
  }
});

function listen(port, attempts = [4173, 3000, 5173, 8080]) {
  server.once("error", (err) => {
    const nextPort = attempts.shift();
    if (nextPort && (err.code === "EADDRINUSE" || err.code === "EPERM")) {
      console.warn(`Port ${port} unavailable (${err.code}). Trying ${nextPort}...`);
      listen(nextPort, attempts);
      return;
    }
    console.error(`Could not start local server on port ${port}.`);
    console.error(err);
    process.exit(1);
  });

  server.listen(port, () => {
    const actual = server.address().port;
    console.log("");
    console.log("DYOOR local dev server is running.");
    console.log(`Open:     http://localhost:${actual}`);
    console.log(`Fallback: http://127.0.0.1:${actual}`);
    console.log(`Health:   http://localhost:${actual}/health`);
    console.log("");
    console.log("Keep this terminal open while testing locally.");
  });
}

listen(preferredPort);
