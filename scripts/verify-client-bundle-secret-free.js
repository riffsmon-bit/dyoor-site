import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

const repositoryRoot = process.cwd();
const buildRoot = path.resolve(process.argv[2] || path.join(repositoryRoot, ".next", "static"));
const environmentFiles = [
  ".env",
  ".env.local",
  ".env.production",
  "netlify-dyoor-world.env",
  "netlify-dyoor-world-functions.env",
  "netlify-trait-lab-functions.env",
].map((file) => path.join(repositoryRoot, file)).filter((file) => fs.existsSync(file));

function secretName(name) {
  return !name.startsWith("NEXT_PUBLIC_")
    && /(PRIVATE_KEY|MNEMONIC|SEED|PASSWORD|SECRET|AUTH_TOKEN|ACCESS_TOKEN|API_KEY)$/i.test(name);
}

const secrets = [];
for (const file of environmentFiles) {
  const values = parse(fs.readFileSync(file, "utf8"));
  for (const [name, value] of Object.entries(values)) {
    const normalized = String(value || "").trim();
    if (secretName(name) && normalized.length >= 16) {
      secrets.push({ name, value: normalized });
    }
  }
}

function filesUnder(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (/\.(?:js|css|json|html|map)$/i.test(entry.name)) files.push(entryPath);
    }
  }
  return files;
}

if (!fs.existsSync(buildRoot)) throw new Error(`Client bundle directory does not exist: ${buildRoot}`);
const bundleFiles = filesUnder(buildRoot);
const exposed = new Set();
for (const file of bundleFiles) {
  const contents = fs.readFileSync(file, "utf8");
  for (const secret of secrets) {
    if (contents.includes(secret.value)) exposed.add(secret.name);
  }
}

if (exposed.size) {
  console.error(JSON.stringify({
    ok: false,
    secretValuesPrinted: false,
    exposedVariableNames: [...exposed].sort(),
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  scannedBundleFiles: bundleFiles.length,
  checkedSecretVariables: secrets.length,
  environmentFilesRead: environmentFiles.map((file) => path.basename(file)),
  secretValuesPrinted: false,
}, null, 2));
