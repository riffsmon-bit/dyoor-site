import { createServer } from "node:http";
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
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
  const filePath = cleanPath === "/" ? "/index.html" : cleanPath;
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

    if (req.url === "/swap" || req.url === "/swap/") {
      send(res, 302, "", { location: "/#swap" });
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
