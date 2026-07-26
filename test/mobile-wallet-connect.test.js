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

test("Privy waits for initialization instead of falling into a missing injected wallet", () => {
  assert.match(
    walletService,
    /const privyReady = authReady && walletsReady;/,
  );
  assert.match(
    walletService,
    /const uiReady = privyReady \|\| readyTimedOut \|\| hasInjectedWallet \|\| Boolean\(privyAddress\)/,
  );
  assert.match(walletService, /if \(privyReady\) {\s+connectWallet\(\{/);
  assert.match(walletService, /useConnectWallet\(\{/);
  assert.doesNotMatch(walletService, /\blogin\(\)/);
  assert.match(walletService, /Privy is still loading/);
  assert.doesNotMatch(walletService, /authReady && !readyTimedOut/);
  assert.doesNotMatch(walletService, /uiReady = .*injected\.ready/);
  assert.doesNotMatch(walletService, /Privy connection timed out/);
});

test("mobile wallet handoff excludes desktop-only detection and QR connectors", () => {
  const mobileList = walletService.match(
    /const MOBILE_WALLET_LIST[^=]*= \[([\s\S]*?)\];/,
  )?.[1] || "";
  const desktopList = walletService.match(
    /const DESKTOP_WALLET_LIST[^=]*= \[([\s\S]*?)\];/,
  )?.[1] || "";

  assert.match(mobileList, /"metamask"/);
  assert.match(mobileList, /"coinbase_wallet"/);
  assert.match(mobileList, /"rainbow"/);
  assert.doesNotMatch(mobileList, /"detected_ethereum_wallets"/);
  assert.doesNotMatch(mobileList, /"wallet_connect"/);
  assert.doesNotMatch(mobileList, /"wallet_connect_qr"/);
  assert.match(desktopList, /"detected_ethereum_wallets"/);
  assert.match(desktopList, /"wallet_connect_qr"/);
  assert.match(
    walletService,
    /walletList: isMobileBrowser\(\) \? MOBILE_WALLET_LIST : DESKTOP_WALLET_LIST/,
  );
});

test("provider does not force Monad during the external-wallet pairing handshake", () => {
  assert.doesNotMatch(providers, /\bdefaultChain:/);
  assert.match(providers, /supportedChains: \[monadMainnet\]/);
});

test("mobile-friendly named wallets precede desktop fallbacks", () => {
  const metamask = providers.indexOf('"metamask"');
  const coinbase = providers.indexOf('"coinbase_wallet"');
  const rainbow = providers.indexOf('"rainbow"');
  const detected = providers.indexOf('"detected_ethereum_wallets"');
  const desktopQr = providers.indexOf('"wallet_connect_qr"');

  assert.ok(metamask > -1);
  assert.ok(coinbase > metamask);
  assert.ok(rainbow > coinbase);
  assert.ok(detected > rainbow);
  assert.ok(desktopQr > detected);
  assert.doesNotMatch(providers, /"wallet_connect",/);
});
