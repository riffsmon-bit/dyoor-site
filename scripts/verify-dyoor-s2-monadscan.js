#!/usr/bin/env node
import "dotenv/config";

import { config as loadDotenv } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { getAddress } from "ethers";

const CONTRACT = "contracts/DYOORSeason2SeaDrop.sol:DYOORSeason2SeaDrop";
const COMPILER = "v0.8.17+commit.8df45f5f";
const OPTIMIZER_RUNS = "1";
const MONAD_MAINNET_CHAIN_ID = "143";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) loadDotenv({ path: file, override: false });
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function requireEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function alreadyVerified(address, apiUrl, apiKey) {
  if (!apiUrl || !apiKey) return null;
  const url = new URL(apiUrl);
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getsourcecode");
  url.searchParams.set("address", address);
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null);
  const source = body?.result?.[0]?.SourceCode || "";
  return Boolean(source);
}

function constructorArgsCommand(name, symbol, seaDrop) {
  return [
    "cast",
    "abi-encode",
    "constructor(string,string,address[])",
    JSON.stringify(name),
    JSON.stringify(symbol),
    `[${seaDrop}]`,
  ];
}

async function main() {
  const contractAddress = getAddress(requireEnv("DYOOR_S2_CONTRACT_ADDRESS"));
  const chainId = env("CHAIN_ID", env("EXPECTED_CHAIN_ID", env("NEXT_PUBLIC_DYOOR_S2_CHAIN_ID", "10143")));
  if (chainId === MONAD_MAINNET_CHAIN_ID && env("MAINNET_VERIFY_CONFIRMATION") !== "VERIFY_DYOOR_MAINNET") {
    throw new Error("Refusing Monad mainnet verification without MAINNET_VERIFY_CONFIRMATION=VERIFY_DYOOR_MAINNET.");
  }
  const rpcUrl = chainId === "143"
    ? env("MONAD_MAINNET_RPC_URL", env("MONAD_RPC_URL", ""))
    : env("MONAD_TESTNET_RPC_URL", env("DYOOR_S2_RPC_URL", env("NEXT_PUBLIC_DYOOR_S2_RPC_URL", "")));
  if (!rpcUrl) throw new Error("MONAD_MAINNET_RPC_URL, MONAD_RPC_URL, MONAD_TESTNET_RPC_URL, or DYOOR_S2_RPC_URL is required.");
  const apiKey = requireEnv("MONADSCAN_API_KEY");
  const verifierUrl = env("MONADSCAN_VERIFIER_URL", "");
  const apiUrl = env("MONADSCAN_API_URL", "");
  const seaDrop = getAddress(requireEnv("SEADROP_ADDRESS"));
  const execute = env("EXECUTE_VERIFY") === "1";
  const reportPath = env("VERIFY_REPORT_PATH", `deployments/dyoor-s2-verification-${chainId}-${contractAddress}.json`);

  const verified = await alreadyVerified(contractAddress, apiUrl, apiKey);
  const constructorArgs = constructorArgsCommand("D.Y.O.O.R", "DYOOR", seaDrop);
  const command = [
    "forge",
    "verify-contract",
    contractAddress,
    CONTRACT,
    "--chain-id",
    chainId,
    "--compiler-version",
    COMPILER,
    "--num-of-optimizations",
    OPTIMIZER_RUNS,
    "--constructor-args",
    `$(${constructorArgs.join(" ")})`,
    "--etherscan-api-key",
    "$MONADSCAN_API_KEY",
    "--watch",
  ];
  if (verifierUrl) command.push("--verifier-url", verifierUrl);

  const report = {
    generatedAt: new Date().toISOString(),
    contractAddress,
    contract: CONTRACT,
    chainId,
    rpcUrl,
    compiler: COMPILER,
    optimizer: true,
    optimizerRuns: Number(OPTIMIZER_RUNS),
    seaDrop,
    alreadyVerified: verified,
    execute,
    command: command.join(" "),
    output: "",
    error: "",
  };

  if (verified) {
    report.output = "Contract already appears verified.";
  } else if (execute) {
    const encoded = spawnSync(constructorArgs[0], constructorArgs.slice(1), { encoding: "utf8" });
    if (encoded.status !== 0) {
      report.error = encoded.stderr || encoded.stdout || "cast abi-encode failed";
    } else {
      const args = [
        "verify-contract",
        contractAddress,
        CONTRACT,
        "--chain-id",
        chainId,
        "--compiler-version",
        COMPILER,
        "--num-of-optimizations",
        OPTIMIZER_RUNS,
        "--constructor-args",
        encoded.stdout.trim(),
        "--etherscan-api-key",
        apiKey,
        "--watch",
      ];
      if (verifierUrl) args.push("--verifier-url", verifierUrl);
      const result = spawnSync("forge", args, { encoding: "utf8", env: process.env });
      report.output = result.stdout;
      report.error = result.stderr;
      if (result.status !== 0) process.exitCode = result.status || 1;
    }
  } else {
    report.output = "Dry run only. Set EXECUTE_VERIFY=1 to call forge verify-contract.";
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  if (!existsSync("out/DYOORSeason2SeaDrop.sol/DYOORSeason2SeaDrop.json")) {
    console.error("Warning: local Foundry artifact not found. Run forge build first.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
