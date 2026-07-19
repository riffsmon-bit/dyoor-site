#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const DEFAULT_CHAIN_ID = 143;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

function arg(name, fallback = "") {
  const prefix = `${name}=`;
  const exact = process.argv.indexOf(name);
  if (exact >= 0 && process.argv[exact + 1]) return process.argv[exact + 1];
  const inline = process.argv.find((item) => item.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function env(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function formatMon(wei) {
  const formatted = ethers.formatEther(wei);
  return formatted.includes(".") ? formatted.replace(/0+$/, "").replace(/\.$/, "") : formatted;
}

function loadExecutionState(filePath) {
  if (!fs.existsSync(filePath)) {
    return { startedAt: new Date().toISOString(), completed: {}, failed: {} };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function saveExecutionState(filePath, state) {
  fs.writeFileSync(filePath, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

async function main() {
  const dateStamp = arg("--date", new Date().toISOString().slice(0, 10));
  const manifestPath = arg("--manifest", path.join("data/reports", `s2-overpay-refund-manifest-${dateStamp}.json`));
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing refund manifest: ${manifestPath}`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const refunds = Array.isArray(manifest.refunds) ? manifest.refunds : [];
  if (!refunds.length) throw new Error("Refund manifest contains no recipients.");

  const expectedPhrase = manifest.confirmationPhrase;
  const dryRun = process.env.EXECUTE_S2_REFUNDS !== "1";
  const suppliedPhrase = env("S2_REFUND_CONFIRMATION");
  const rpcUrl = arg("--rpc", env("MONAD_MAINNET_RPC_URL", "ALCHEMY_MONAD_RPC_URL", "MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL"));
  if (!rpcUrl) throw new Error("Missing RPC URL. Set MONAD_MAINNET_RPC_URL, ALCHEMY_MONAD_RPC_URL, or MONAD_RPC_URL.");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== DEFAULT_CHAIN_ID) {
    throw new Error(`Expected Monad mainnet chain ${DEFAULT_CHAIN_ID}; got ${network.chainId}.`);
  }

  const totalRefundWei = BigInt(manifest.totalRefundWei);
  console.log(JSON.stringify({
    dryRun,
    chainId: Number(network.chainId),
    manifestPath,
    walletCount: refunds.length,
    totalRefundMON: manifest.totalRefundMON,
    expectedConfirmation: expectedPhrase,
  }, null, 2));

  const keyEnvName = arg("--key-env", "S2_REFUND_PRIVATE_KEY");
  const privateKey = env(keyEnvName, "DYOOR_REFUND_PRIVATE_KEY");
  if (!privateKey) {
    console.log(`No refund private key found. Dry-run validation only. Set ${keyEnvName} locally only when ready to broadcast.`);
    return;
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 0n;
  const estimatedGasCost = 21_000n * BigInt(refunds.length) * gasPrice;
  console.log(JSON.stringify({
    sender: wallet.address,
    senderBalanceMON: formatMon(balance),
    totalRefundMON: formatMon(totalRefundWei),
    roughGasBufferMON: formatMon(estimatedGasCost),
  }, null, 2));

  if (balance < totalRefundWei + estimatedGasCost) {
    throw new Error(`Sender balance is too low. Need at least ${formatMon(totalRefundWei + estimatedGasCost)} MON for refunds plus rough gas.`);
  }

  if (dryRun) {
    console.log("Dry run complete. Set EXECUTE_S2_REFUNDS=1 and S2_REFUND_CONFIRMATION exactly to broadcast.");
    return;
  }
  if (suppliedPhrase !== expectedPhrase) {
    throw new Error(`Wrong or missing S2_REFUND_CONFIRMATION. Expected exactly: ${expectedPhrase}`);
  }

  const statePath = arg("--state", path.join("data/reports", `s2-overpay-refund-execution-${dateStamp}.json`));
  const state = loadExecutionState(statePath);
  state.manifestPath = manifestPath;
  state.sender = wallet.address;
  state.chainId = Number(network.chainId);

  for (const refund of refunds) {
    const recipient = ethers.getAddress(refund.wallet);
    const amountWei = BigInt(refund.refundWei);
    const key = recipient.toLowerCase();
    if (state.completed[key]) {
      console.log(`Skipping completed refund ${recipient}: ${state.completed[key].txHash}`);
      continue;
    }
    try {
      const tx = await wallet.sendTransaction({ to: recipient, value: amountWei });
      state.pending = { ...(state.pending || {}), [key]: { txHash: tx.hash, amountWei: amountWei.toString(), amountMON: refund.refundMON } };
      saveExecutionState(statePath, state);
      console.log(`Sent ${refund.refundMON} MON to ${recipient}: ${tx.hash}`);
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error(`Transaction failed: ${tx.hash}`);
      state.completed[key] = {
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        amountWei: amountWei.toString(),
        amountMON: refund.refundMON,
      };
      if (state.pending) delete state.pending[key];
      saveExecutionState(statePath, state);
    } catch (error) {
      state.failed[key] = {
        amountWei: amountWei.toString(),
        amountMON: refund.refundMON,
        error: error?.shortMessage || error?.message || String(error),
      };
      saveExecutionState(statePath, state);
      throw error;
    }
  }

  console.log(`Refund execution complete. State saved to ${statePath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
