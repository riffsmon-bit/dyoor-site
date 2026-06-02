import { readFile, writeFile } from "node:fs/promises";

const BLUEPRINTS_PATH = "data/ascension-blueprints.json";

async function main() {
  const text = await readFile(BLUEPRINTS_PATH, "utf8").catch(() => "[]");
  const blueprints = JSON.parse(text || "[]");
  if (!Array.isArray(blueprints)) throw new Error(`${BLUEPRINTS_PATH} must contain an array.`);
  await writeFile(BLUEPRINTS_PATH, `${JSON.stringify(blueprints, null, 2)}\n`, "utf8");
  console.log(`Exported ${blueprints.length} Ascension Blueprint registration(s) to ${BLUEPRINTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
