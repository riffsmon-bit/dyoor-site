import { readFile, writeFile } from "node:fs/promises";

const BLUEPRINTS_PATH = "data/ascension-blueprints.json";
const WALLETS_PATH = "data/ascension-blueprint-wallets.json";

function normalizeAddress(address) {
  const value = String(address || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
}

async function main() {
  const text = await readFile(BLUEPRINTS_PATH, "utf8").catch(() => "[]");
  const blueprints = JSON.parse(text || "[]");
  if (!Array.isArray(blueprints)) throw new Error(`${BLUEPRINTS_PATH} must contain an array.`);
  const wallets = [...new Set(blueprints.map((entry) => normalizeAddress(entry.wallet)).filter(Boolean))];
  await writeFile(WALLETS_PATH, `${JSON.stringify(wallets, null, 2)}\n`, "utf8");
  console.log(`Exported ${wallets.length} Ascension Blueprint wallet(s) to ${WALLETS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
