import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { concatHex, getAddress, isAddress, keccak256 } from "viem";

function usage() {
  console.error(`Usage: node ${basename(process.argv[1])} <wallet-file>`);
  console.error("");
  console.error("The wallet file may contain one address per line or addresses embedded in CSV/text.");
}

function walletLeaf(address) {
  return keccak256(`0x${getAddress(address).slice(2).toLowerCase()}`);
}

function hashPair(left, right) {
  const pair = [left, right].sort((a, b) => a.localeCompare(b));
  return keccak256(concatHex(pair));
}

function buildLayers(leaves) {
  const layers = [leaves];

  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1];
    const next = [];

    for (let index = 0; index < current.length; index += 2) {
      const left = current[index];
      const right = current[index + 1];
      next.push(right ? hashPair(left, right) : left);
    }

    layers.push(next);
  }

  return layers;
}

function proofForIndex(layers, leafIndex) {
  const proof = [];
  let index = leafIndex;

  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    const layer = layers[layerIndex];
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;

    if (siblingIndex < layer.length) {
      proof.push(layer[siblingIndex]);
    }

    index = Math.floor(index / 2);
  }

  return proof;
}

const walletFile = process.argv[2];
if (!walletFile) {
  usage();
  process.exit(1);
}

const contents = readFileSync(walletFile, "utf8");
const rawAddresses = contents.match(/0x[a-fA-F0-9]{40}/g) || [];
const addresses = Array.from(new Set(rawAddresses.map((address) => getAddress(address))));

if (addresses.length === 0) {
  console.error(`No valid wallet addresses found in ${walletFile}.`);
  process.exit(1);
}

const invalid = rawAddresses.find((address) => !isAddress(address));
if (invalid) {
  console.error(`Invalid wallet address: ${invalid}`);
  process.exit(1);
}

const leaves = addresses
  .map((address) => ({ address, leaf: walletLeaf(address) }))
  .sort((a, b) => a.leaf.localeCompare(b.leaf));

const layers = buildLayers(leaves.map((entry) => entry.leaf));
const root = layers[layers.length - 1][0];

const output = {
  count: leaves.length,
  root,
  wallets: leaves
    .map((entry, index) => ({
      address: entry.address,
      leaf: entry.leaf,
      proof: proofForIndex(layers, index),
    }))
    .sort((a, b) => a.address.localeCompare(b.address)),
};

console.log(JSON.stringify(output, null, 2));
