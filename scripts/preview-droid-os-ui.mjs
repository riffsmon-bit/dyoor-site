// Local UI harness: public artwork GETs only; no wallet, signing or mutation API.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ARTWORK_TOKEN_IDS, readLiveArtwork } from "../lib/droid-os/live-artwork.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const loadConfig = require("tailwindcss/loadConfig");
const port = 3202;
let bundle;
let css;
async function compile() {
  const result = await build({
    stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {DroidOsPreview} from "@/components/droid-os/DroidOsPreview"; createRoot(document.getElementById("root")).render(<DroidOsPreview />);', loader: "tsx", resolveDir: root },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    absWorkingDir: root, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "local-alias", setup(builder) {
      builder.onResolve({ filter: /^@\// }, async ({ path: specifier }) => {
        const base = path.join(root, specifier.slice(2));
        for (const extension of [".tsx", ".ts"]) {
          if (await fs.stat(base + extension).catch(() => null)) return { path: base + extension };
        }
        throw Error(`Missing preview import: ${specifier}`);
      });
    } }],
  });
  const styles = await postcss([tailwind({ ...loadConfig(path.join(root, "tailwind.config.ts")), content: [path.join(root, "components/droid-os/**/*.tsx")] }), require("autoprefixer")]).process(
    await fs.readFile(path.join(root, "app/globals.css"), "utf8") + "\n" + await fs.readFile(path.join(root, "app/droid-os/droid-os.css"), "utf8"),
    { from: path.join(root, "app/droid-os/droid-os.css") },
  );
  bundle = result.outputFiles[0].text;
  css = styles.css;
}
await compile();
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Droid OS · Local UI Review</title><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>';
const server = http.createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' https://dyoor.netlify.app https://ipfs.dyoor.fun; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'none'");
  if (request.method !== "GET") { response.writeHead(405); response.end("Wallet and API actions are disabled in this local UI review."); return; }
  const url = new URL(request.url || "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/droid-os/artwork/")) {
      const id = url.pathname.slice("/api/droid-os/artwork/".length);
      if (!ARTWORK_TOKEN_IDS.includes(id)) { response.writeHead(404); response.end("Unsupported token"); return; }
      response.setHeader("Content-Type", "application/json");
      try { response.end(JSON.stringify(await readLiveArtwork(id))); }
      catch { response.writeHead(502); response.end(JSON.stringify({ error: "Live artwork unavailable" })); }
      return;
    }
    if (url.pathname === "/rebuild") { await compile(); response.end("rebuilt"); return; }
    if (url.pathname === "/ui.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle); return; }
    if (url.pathname === "/ui.css") { response.setHeader("Content-Type", "text/css"); response.end(css); return; }
    if (/^\/droid-os\/droid-(11|16|7|3)\.png$/.test(url.pathname)) { response.setHeader("Content-Type", "image/png"); response.end(await fs.readFile(path.join(root, "public", url.pathname))); return; }
    if (url.pathname === "/" || url.pathname === "/droid-os") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
    response.writeHead(404); response.end("No live API or route is exposed by this UI harness.");
  } catch (error) { response.writeHead(500); response.end("Local preview failed. See terminal output."); console.error(error.message); }
});
server.listen(port, "127.0.0.1", () => console.log(`Droid OS UI review: http://localhost:${port}/droid-os\nLive public artwork; sample balances. No wallet, mutation API or AI connection.`));
