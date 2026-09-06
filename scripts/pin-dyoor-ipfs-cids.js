#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const cidFile = path.resolve(
  process.env.IPFS_CID_MANIFEST || path.join(root, "infra/ipfs/dyoor-cids.txt"),
);
const apiUrl = String(process.env.IPFS_API_URL || "").replace(/\/+$/, "");
const run = promisify(execFile);

function manifestCids() {
  return fs.readFileSync(cidFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
}

async function post(command, params = {}) {
  const url = new URL(`${apiUrl}/api/v0/${command}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${command} failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return body;
}

async function main() {
  const docker = async (...args) => run("docker", ["compose", "-f", path.join(root, "infra/ipfs/compose.yaml"), "exec", "-T", "ipfs", "ipfs", ...args], { timeout: 30 * 60 * 1000 });
  if (apiUrl) {
    const version = JSON.parse(await post("version"));
    console.log(`Kubo ${version.Version} at ${new URL(apiUrl).host}`);
  } else {
    console.log((await docker("version")).stdout.trim());
  }
  const cids = manifestCids();
  for (const cid of cids) {
    process.stdout.write(`Pinning ${cid} ... `);
    if (!/^[a-zA-Z0-9]+$/.test(cid)) throw new Error("Invalid CID in manifest");
    if (apiUrl) await post("pin/add", { arg: cid, recursive: "true", progress: "true" });
    else await docker("pin", "add", "--recursive", cid);
    console.log("done");
  }
  console.log(`Pinned ${cids.length} canonical DYOOR roots.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
