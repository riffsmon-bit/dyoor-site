import fs from "node:fs";
import path from "node:path";

export const SIGNING_ENVIRONMENT_VARIABLES = Object.freeze([
  "DEPLOYER_PRIVATE_KEY",
  "HOODYOOR_DEPLOYER_PRIVATE_KEY",
  "HOODYOOR_DROID_DEPLOYER_PRIVATE_KEY",
  "HOODYOOR_RESULT_SIGNER_PRIVATE_KEY",
  "HOODYOOR_RELAYER_PRIVATE_KEY",
  "ENERGY_BANK_OPERATOR_PRIVATE_KEY",
  "ENERGY_CREDIT_SIGNER_PRIVATE_KEY",
  "MNEMONIC",
]);

export const BROADCAST_ENVIRONMENT_VARIABLES = Object.freeze([
  "BROADCAST",
  "EXECUTE_MONAD_DROID_DEPLOYMENT",
  "ALLOW_MONAD_DROID_MAINNET",
  "EXECUTE_HOODYOOR_ECONOMIC_DEPLOYMENT",
  "EXECUTE_HOODYOOR_DROID_DEPLOYMENT",
  "EXECUTE_HOODYOOR_MAINNET_DEPLOYMENT",
  "EXECUTE_HOODYOOR_SEADROP_V2_DEPLOYMENT",
  "EXECUTE_HOODYOOR_CORE_DEPLOYMENT",
  "EXECUTE_HOODYOOR_ART_DEPLOYMENT",
  "EXECUTE_HOODYOOR_REROLL_DEPLOYMENT",
  "EXECUTE_HOODYOOR_ENERGY_MIGRATION",
  "EXECUTE_HOODYOOR_LAUNCH_FINALIZATION",
]);

export const PUBLIC_RELEASE_ENVIRONMENT_VARIABLES = Object.freeze([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "NODE_ENV",
  "MONAD_RPC_URL",
  "MONAD_DROID_RPC_URL",
  "DYOOR_S2_RPC_URL",
  "HOODYOOR_RPC_URL",
  "HOODYOOR_DROID_RPC_URL",
  "ROBINHOOD_RPC_URL",
  "DEPLOYER_ADDRESS",
  "HOODYOOR_DEPLOYER_ADDRESS",
]);

const SECRET_FILE_PATHS = Object.freeze([
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  path.join("data", "game", "private", "hoodyoor-mainnet.env"),
]);

export function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

/**
 * Fail without dereferencing a signing variable's value. Merely exporting a
 * signing-variable name is incompatible with the keyless verification mode.
 */
export function assertReadOnlyReleaseEnvironment(environment = process.env) {
  for (const name of SIGNING_ENVIRONMENT_VARIABLES) {
    if (Object.hasOwn(environment, name)) {
      throw new Error(`Secret isolation failed: ${name} must be absent in read-only mode.`);
    }
  }
  for (const name of BROADCAST_ENVIRONMENT_VARIABLES) {
    if (truthy(environment[name])) {
      throw new Error(`Release safety failed: ${name} cannot be enabled in read-only mode.`);
    }
  }
  return true;
}

export function findRepositoryRoot(start = process.cwd()) {
  let current = path.resolve(start);
  for (;;) {
    if (
      fs.existsSync(path.join(current, "package.json"))
      && fs.existsSync(path.join(current, ".git"))
    ) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Unable to locate repository root.");
    current = parent;
  }
}

export function assertNoLocalEnvironmentFiles(root) {
  const present = SECRET_FILE_PATHS.filter((relativePath) =>
    fs.existsSync(path.join(root, relativePath)));
  if (present.length > 0) {
    throw new Error(
      `Keyless release command refused local environment files: ${present.join(", ")}. Run from the clean release worktree.`,
    );
  }
  return true;
}

export function keylessChildEnvironment(environment = process.env) {
  const child = Object.create(null);
  for (const name of PUBLIC_RELEASE_ENVIRONMENT_VARIABLES) {
    if (Object.hasOwn(environment, name)) child[name] = environment[name];
  }
  child.RELEASE_READ_ONLY = "1";
  child.BROADCAST = "0";
  child.DROID_REWARDS_ENABLED = "false";
  child.DROID_STRATEGIES_ENABLED = "false";
  child.SHARED_TREASURY_ENABLED = "false";
  child.CROSS_CHAIN_BRIDGE_ENABLED = "false";
  child.DROID_AGENT_ENABLED = "false";
  child.NEXT_PUBLIC_DROID_REWARDS_ENABLED = "false";
  child.NEXT_PUBLIC_DROID_STRATEGIES_ENABLED = "false";
  child.NEXT_PUBLIC_SHARED_TREASURY_ENABLED = "false";
  child.NEXT_PUBLIC_CROSS_CHAIN_BRIDGE_ENABLED = "false";
  child.NEXT_PUBLIC_DROID_AGENT_ENABLED = "false";
  return child;
}

export function secretFileBasenames() {
  return SECRET_FILE_PATHS.map((value) => path.basename(value));
}
