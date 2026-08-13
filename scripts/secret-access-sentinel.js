import fs from "node:fs";
import path from "node:path";
import { secretFileBasenames } from "./lib/release-safety.js";

const blockedBasenames = new Set(secretFileBasenames());
const privateDirectoryMarker = `${path.sep}data${path.sep}game${path.sep}private${path.sep}`;

function blocked(input) {
  if (typeof input !== "string" && !Buffer.isBuffer(input) && !(input instanceof URL)) return false;
  const value = input instanceof URL ? input.pathname : String(input);
  return blockedBasenames.has(path.basename(value)) || value.includes(privateDirectoryMarker);
}

function guard(name, original) {
  return function guardedSecretFileAccess(input, ...args) {
    if (blocked(input)) {
      throw new Error(`SECRET_ACCESS_SENTINEL blocked ${name} for ${path.basename(String(input))}`);
    }
    return original.call(this, input, ...args);
  };
}

for (const name of ["readFileSync", "openSync", "createReadStream"]) {
  fs[name] = guard(name, fs[name]);
}
for (const name of ["readFile", "open"]) {
  fs[name] = guard(name, fs[name]);
}
if (fs.promises) {
  for (const name of ["readFile", "open"]) {
    fs.promises[name] = guard(`promises.${name}`, fs.promises[name]);
  }
}

process.env.HOODYOOR_SECRET_ACCESS_SENTINEL_ACTIVE = "1";
