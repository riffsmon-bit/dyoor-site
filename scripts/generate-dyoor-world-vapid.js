import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import webpush from "web-push";

if (process.env.GENERATE_DYOOR_WORLD_VAPID !== "1") {
  throw new Error(
    "Refusing to create notification credentials. Set GENERATE_DYOOR_WORLD_VAPID=1 explicitly.",
  );
}

const root = process.cwd();
const files = [
  path.join(root, ".env"),
  path.join(root, "netlify-dyoor-world.env"),
  path.join(root, "netlify-dyoor-world-functions.env"),
];

function readSource(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function upsert(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.replace(/\s*$/, "")}\n${line}\n`;
}

function writeSecure(filePath, contents) {
  const temporary = `${filePath}.tmp`;
  writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
  chmodSync(filePath, 0o600);
}

const sources = files.map(readSource);
const values = sources.map((source) => parse(source));
const configuredPublicKeys = new Set(
  values.map((value) => String(value.DYOOR_WORLD_VAPID_PUBLIC_KEY || "").trim())
    .filter(Boolean),
);
const configuredPrivateKeys = new Set(
  values.map((value) => String(value.DYOOR_WORLD_VAPID_PRIVATE_KEY || "").trim())
    .filter(Boolean),
);
if (configuredPublicKeys.size > 1 || configuredPrivateKeys.size > 1) {
  throw new Error("Existing dYOOR World VAPID values disagree between local environment files.");
}
if ((configuredPublicKeys.size === 1) !== (configuredPrivateKeys.size === 1)) {
  throw new Error("A partial VAPID pair exists. Restore both matching values before continuing.");
}

const generated = configuredPublicKeys.size === 1
  ? {
      publicKey: [...configuredPublicKeys][0],
      privateKey: [...configuredPrivateKeys][0],
    }
  : webpush.generateVAPIDKeys();
const subject = values
  .map((value) => String(value.DYOOR_WORLD_VAPID_SUBJECT || "").trim())
  .find(Boolean)
  || "https://dyoor.netlify.app";

for (let index = 0; index < files.length; index += 1) {
  let source = sources[index];
  source = upsert(source, "DYOOR_WORLD_PUSH_ENABLED", "true");
  source = upsert(source, "DYOOR_WORLD_VAPID_PUBLIC_KEY", generated.publicKey);
  source = upsert(source, "DYOOR_WORLD_VAPID_PRIVATE_KEY", generated.privateKey);
  source = upsert(source, "DYOOR_WORLD_VAPID_SUBJECT", subject);
  writeSecure(files[index], source);
}

console.log(JSON.stringify({
  ok: true,
  created: configuredPublicKeys.size === 0,
  updatedFiles: files.map((filePath) => path.relative(root, filePath)),
  privateKeyPrinted: false,
  nextStep: "npm run netlify:dyoor-world:preview-env",
}, null, 2));
