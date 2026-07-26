import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const providers = fs.readFileSync("providers/AppProviders.tsx", "utf8");
const walletService = fs.readFileSync(
  "providers/WalletServiceProvider.tsx",
  "utf8",
);
const worldClient = fs.readFileSync(
  "components/dyoor-world/DyoorWorldClient.tsx",
  "utf8",
);

test("mobile World navigation keeps DMs separate from the decorative glyph", () => {
  assert.match(
    worldClient,
    /className="hidden min-w-0 items-center gap-3 sm:flex"/,
  );
  assert.match(
    worldClient,
    /aria-label={`Open direct messages/,
  );
});

test("wallet service waits for WalletConnect initialization without blocking injected wallets", () => {
  assert.match(
    walletService,
    /const ready = Boolean\(injected\.providerName\) \|\| walletConnect\.ready;/,
  );
  assert.match(
    walletService,
    /if \(injectedProvider\(\)\) \{\s+await injected\.connect\(\);/,
  );
  assert.match(walletService, /await walletConnect\.connect\(\);/);
  assert.doesNotMatch(walletService, /usePrivy|useConnectWallet|PrivyFirst/);
});

test("injected wallets connect directly when the browser exposes a provider", () => {
  assert.match(
    walletService,
    /if \(injectedProvider\(\)\) \{\s+await injected\.connect\(\);/,
  );
  assert.match(walletService, /method: "eth_requestAccounts"/);
  assert.match(walletService, /eip6963:requestProvider/);
  assert.match(walletService, /eip6963:announceProvider/);
  assert.doesNotMatch(walletService, /providers\.find\([^)]*isMetaMask/);
  assert.doesNotMatch(walletService, /link\.metamask\.io|Open in MetaMask|MobileWalletBridge/);
});

test("standard browsers use a wallet-neutral WalletConnect modal", () => {
  assert.match(walletService, /import\("@walletconnect\/ethereum-provider"\)/);
  assert.match(walletService, /showQrModal: true/);
  assert.match(walletService, /enableExplorer: true/);
  assert.match(walletService, /enableMobileFullScreen: true/);
  assert.match(walletService, /optionalChains: \[MONAD_CHAIN_ID\]/);
  assert.match(walletService, /await provider\.enable\(\)/);
  assert.doesNotMatch(walletService, /chains: \[MONAD_CHAIN_ID\]/);
});

test("app provider passes the public WalletConnect project ID without a branded wallet preference", () => {
  assert.match(providers, /NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID/);
  assert.match(providers, /walletConnectProjectId=\{walletConnectProjectId\}/);
  assert.doesNotMatch(providers, /PrivyProvider|NEXT_PUBLIC_PRIVY_APP_ID/);
  assert.doesNotMatch(providers, /"metamask"|"coinbase_wallet"|"rainbow"/);
});
