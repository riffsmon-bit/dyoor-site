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

test("wallet service opens a direct wallet-app chooser without blocking injected wallets", () => {
  assert.match(
    walletService,
    /if \(injectedProvider\(\)\) \{\s+await injected\.connect\(\);/,
  );
  assert.match(
    walletService,
    /setWalletChooserOpen\(true\);/,
  );
  assert.match(
    walletService,
    /<WalletAppChooser[\s\S]*onClose=\{closeWalletChooser\}[\s\S]*open=\{walletChooserOpen && !injected\.providerName\}/,
  );
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
  assert.doesNotMatch(walletService, /walletConnect|WalletConnect|Reown/);
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

test("app provider no longer needs a WalletConnect or Reown project ID", () => {
  assert.match(providers, /<WalletServiceProvider>\{children\}<\/WalletServiceProvider>/);
  assert.doesNotMatch(providers, /NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID|walletConnectProjectId/);
  assert.doesNotMatch(providers, /PrivyProvider|NEXT_PUBLIC_PRIVY_APP_ID/);
  assert.doesNotMatch(providers, /Reown|WalletConnect/);
});
