import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  describeEvmChain,
  evmChainId,
  isMonadMainnetChain,
  switchProviderToMonadMainnet,
} from "../lib/monad.ts";

test("Monad wallet detection accepts canonical hex and numeric mainnet IDs", () => {
  assert.equal(evmChainId("0x8f"), 143);
  assert.equal(evmChainId("143"), 143);
  assert.equal(evmChainId(143), 143);
  assert.equal(isMonadMainnetChain("0x8f"), true);
  assert.equal(isMonadMainnetChain(143), true);
  assert.equal(isMonadMainnetChain("0x279f"), false);
  assert.equal(describeEvmChain("0x279f"), "Monad testnet (10143)");
});

test("wallet switching targets Monad mainnet and verifies the resulting chain", async () => {
  let chainId = "0x279f";
  const calls = [];
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "wallet_switchEthereumChain") chainId = request.params[0].chainId;
      if (request.method === "eth_chainId") return chainId;
      return null;
    },
  };

  await switchProviderToMonadMainnet(provider);
  assert.equal(chainId, "0x8f");
  assert.deepEqual(calls[0], {
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x8f" }],
  });
});

test("unknown-chain wallets receive the Monad mainnet configuration", async () => {
  let chainId = "0x1";
  let added = false;
  const calls = [];
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "wallet_switchEthereumChain") {
        if (!added) throw Object.assign(new Error("Unknown chain"), { code: 4902 });
        chainId = request.params[0].chainId;
      }
      if (request.method === "wallet_addEthereumChain") added = true;
      if (request.method === "eth_chainId") return chainId;
      return null;
    },
  };

  await switchProviderToMonadMainnet(provider);
  const addRequest = calls.find((request) => request.method === "wallet_addEthereumChain");
  assert.equal(addRequest.params[0].chainId, "0x8f");
  assert.deepEqual(addRequest.params[0].nativeCurrency, { name: "MON", symbol: "MON", decimals: 18 });
  assert.equal(chainId, "0x8f");
});

test("network-switch failures are visible instead of being swallowed", () => {
  const button = fs.readFileSync("components/wallet/WalletButton.tsx", "utf8");
  const marketplace = fs.readFileSync("components/s2/TraitMarketplaceClient.tsx", "utf8");

  assert.doesNotMatch(button, /wallet\.switchChain\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(button, /role="alert"/);
  assert.match(marketplace, /MON purchases require Monad mainnet/);
});
