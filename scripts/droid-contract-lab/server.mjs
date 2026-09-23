import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const exec = promisify(execFile);
const root = new URL("../../", import.meta.url);
export async function runLocalScenario() {
  const { stdout } = await exec(process.execPath, [new URL("../test-droid-contract-lab.mjs", import.meta.url).pathname], {
    cwd: root, env: { PATH: process.env.PATH }, timeout: 60000, maxBuffer: 524288,
  });
  const report = JSON.parse(stdout);
  if (report.version !== 1 || report.status !== "PASS" || report.chainId !== 31337 ||
      report.publicDeployment !== false || report.environment !== "EPHEMERAL_LOCAL_ANVIL" ||
      !Array.isArray(report.receipts) || !Array.isArray(report.verified)) throw Error("Invalid local evidence");
  return report;
}

export function createLabServer(run = runLocalScenario) {
  let running = false;
  let latest = null;
  const assets = new Map([["/", ["index.html", "text/html"]], ["/client.js", ["client.js", "text/javascript"]], ["/style.css", ["style.css", "text/css"]]]);
  const server = http.createServer(async (request, response) => {
    const port = server.address()?.port;
    const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    if (!hosts.includes(request.headers.host)) { json(403, { error: "Loopback host required" }); return; }
    const pathname = request.url;
    if (request.method === "GET" && pathname === "/status") { json(200, { running, latest }); return; }
    if (request.method === "GET" && assets.has(pathname)) {
      const [filename, type] = assets.get(pathname);
      try { response.writeHead(200, { "Content-Type": type }); response.end(await readFile(new URL(filename, import.meta.url))); }
      catch { response.end(); }
      return;
    }
    if (pathname !== "/run") { json(404, { error: "Unknown route" }); return; }
    if (request.method !== "POST") { json(405, { error: "POST required" }); return; }
    if (request.headers.origin !== `http://${request.headers.host}` ||
        (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") ||
        request.headers["content-type"] !== "application/json") { json(403, { error: "Same-origin JSON request required" }); return; }
    let body = "";
    for await (const chunk of request) {
      body += chunk.toString();
      if (body.length > 128) { json(413, { error: "No scenario parameters accepted" }); return; }
    }
    if (body.trim() !== "{}") { json(400, { error: "No wallet, RPC, key or transaction parameters accepted" }); return; }
    if (running) { json(409, { error: "One local run at a time" }); return; }
    running = true;
    latest = null;
    try { latest = await run(); json(200, latest); }
    catch { json(500, { error: "Local scenario failed. Run npm run test:droid-contract-flow for diagnostics. No success is assumed." }); }
    finally { running = false; }
  });
  server.requestTimeout = 70000;
  server.headersTimeout = 10000;
  return server;
}
