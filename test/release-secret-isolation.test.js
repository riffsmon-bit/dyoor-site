import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  SIGNING_ENVIRONMENT_VARIABLES,
  assertReadOnlyReleaseEnvironment,
  keylessChildEnvironment,
} from "../scripts/lib/release-safety.js";

test("read-only release environment rejects a signing-variable name without reading its value", () => {
  const environment = Object.create(null);
  Object.defineProperty(environment, "DEPLOYER_PRIVATE_KEY", {
    enumerable: true,
    get() {
      throw new Error("secret value was dereferenced");
    },
  });
  assert.throws(
    () => assertReadOnlyReleaseEnvironment(environment),
    /DEPLOYER_PRIVATE_KEY must be absent/,
  );
});

test("keyless child environment excludes every signing variable", () => {
  const environment = {
    PATH: process.env.PATH,
    DEPLOYER_PRIVATE_KEY: "must-not-propagate",
    HOODYOOR_DEPLOYER_PRIVATE_KEY: "must-not-propagate",
    MONAD_RPC_URL: "https://rpc.monad.xyz",
  };
  const child = keylessChildEnvironment(environment);
  for (const name of SIGNING_ENVIRONMENT_VARIABLES) assert.equal(Object.hasOwn(child, name), false);
  assert.equal(child.MONAD_RPC_URL, "https://rpc.monad.xyz");
  assert.equal(child.BROADCAST, "0");
});

test("sentinel blocks secret-file contents", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hoodyoor-secret-sentinel-"));
  const secretPath = path.join(directory, ".env");
  const sentinel = path.resolve("scripts/secret-access-sentinel.js");
  const probeSource = [
    "import fs from 'node:fs';",
    `const secretPath = ${JSON.stringify(secretPath)};`,
    "fs.writeFileSync(secretPath, 'DO_NOT_READ=this-is-a-test-fixture\\n', { mode: 0o600 });",
    `await import(${JSON.stringify(pathToFileURL(sentinel).href)});`,
    "fs.readFileSync(secretPath, 'utf8');",
  ].join("\n");
  const probe = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", probeSource],
    { encoding: "utf8", env: keylessChildEnvironment({ PATH: process.env.PATH }) },
  );
  assert.notEqual(probe.status, 0);
  assert.match(probe.stderr, /SECRET_ACCESS_SENTINEL blocked readFileSync/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("Hardhat and release preflights do not auto-load local environments", () => {
  const hardhat = fs.readFileSync("hardhat.config.js", "utf8");
  assert.doesNotMatch(hardhat, /dotenv\/config|dotenv\.config|loadEnv/);
  for (const filePath of [
    "scripts/preflight-monad-droid-accounts.js",
    "scripts/preflight-hoodyoor-economic-droids.js",
    "scripts/preflight-robinhood-seadrop-v2.js",
    "scripts/preflight-robinhood-mainnet.js",
  ]) {
    const source = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(source, /loadHoodyoorLocalEnvironment|dotenv\/config|dotenv\.config/);
  }
});
