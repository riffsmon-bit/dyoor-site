import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const providers = fs.readFileSync("providers/AppProviders.tsx", "utf8");
const walletService = fs.readFileSync(
  "providers/WalletServiceProvider.tsx",
  "utf8",
);
const walletChooser = fs.readFileSync(
  "components/wallet/WalletAppChooser.tsx",
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

test("Privy is the primary wallet chooser when its app ID is configured", () => {
  assert.match(
    walletService,
    /function PrivyWalletServiceProvider/,
  );
  assert.match(
    walletService,
    /connectWallet\(\{\s+description: "Choose the wallet that holds your D\.Y\.O\.O\.R\."/,
  );
  assert.match(
    walletService,
    /walletList: \["detected_ethereum_wallets", "wallet_connect"\]/,
  );
  assert.match(
    walletService,
    /privyEnabled\s+\? <PrivyWalletServiceProvider>\{children\}<\/PrivyWalletServiceProvider>/,
  );
});

test("direct injected-wallet support remains available as the no-Privy fallback", () => {
  assert.match(
    walletService,
    /if \(injectedProvider\(\)\) \{\s+await injected\.connect\(\);/,
  );
  assert.match(walletService, /method: "eth_requestAccounts"/);
  assert.match(walletService, /eip6963:requestProvider/);
  assert.match(walletService, /eip6963:announceProvider/);
  assert.doesNotMatch(walletService, /providers\.find\([^)]*isMetaMask/);
  assert.doesNotMatch(walletService, /@walletconnect|Reown|walletConnectProjectId/);
});

test("standard mobile browsers get equal, service-free wallet app handoffs", () => {
  assert.match(walletChooser, /data-wallet-app="?\{wallet\.name\}"?/);
  assert.match(walletChooser, /https:\/\/metamask\.app\.link\/dapp\//);
  assert.match(walletChooser, /https:\/\/web3\.okx\.com\/download\?deeplink=/);
  assert.match(walletChooser, /https:\/\/phantom\.app\/ul\/browse\//);
  assert.match(walletChooser, /https:\/\/link\.trustwallet\.com\/open_url\?coin_id=60/);
  assert.match(walletChooser, /Copy exact page link/);
  assert.match(walletChooser, /No transaction, token approval, relay account, or paid service is requested/);
  assert.doesNotMatch(walletChooser, /Connect with MetaMask|Open in MetaMask/);
});

test("app provider mounts Privy without requiring a separate Reown project", () => {
  assert.match(providers, /import \{ PrivyProvider, type WalletListEntry \} from "@privy-io\/react-auth"/);
  assert.match(providers, /process\.env\.NEXT_PUBLIC_PRIVY_APP_ID/);
  assert.match(providers, /<PrivyProvider[\s\S]*appId=\{appId\}/);
  assert.match(providers, /"detected_ethereum_wallets",\s+"wallet_connect"/);
  assert.match(providers, /<WalletServiceProvider privyEnabled=\{Boolean\(appId\)\}>/);
  assert.doesNotMatch(providers, /NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID|walletConnectProjectId/);
  assert.doesNotMatch(providers, /Reown|WalletConnect/);
});
