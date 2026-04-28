import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import quoteHandler from "./netlify/functions/quote.js";

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

async function handleFunction(req, res) {
  const body = await readRequestBody(req);
  const host = req.headers.host || `localhost:${preferredPort}`;
  const request = new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: body.length ? body : undefined,
  });
  const response = await quoteHandler(request);
  const responseBody = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(response.headers.entries());
  send(res, response.status, responseBody, headers);
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      send(res, 200, "ok", { "content-type": "text/plain; charset=utf-8" });
      return;
    }

    if (req.url?.startsWith("/.netlify/functions/quote")) {
      await handleFunction(req, res);
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
