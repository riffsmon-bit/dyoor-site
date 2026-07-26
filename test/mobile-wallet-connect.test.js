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
    /const uiReady = authReady \|\| readyTimedOut \|\| hasInjectedWallet \|\| Boolean\(privyAddress\)/,
  );
  assert.match(walletService, /if \(authReady\) {\s+login\(\);\s+return;/);
  assert.match(walletService, /Privy is still loading/);
  assert.doesNotMatch(walletService, /authReady && !readyTimedOut/);
  assert.doesNotMatch(walletService, /uiReady = .*injected\.ready/);
  assert.doesNotMatch(walletService, /Privy connection timed out/);
});

test("mobile-friendly named wallets precede desktop detection and QR fallbacks", () => {
  const metamask = providers.indexOf('"metamask"');
  const coinbase = providers.indexOf('"coinbase_wallet"');
  const rainbow = providers.indexOf('"rainbow"');
  const detected = providers.indexOf('"detected_ethereum_wallets"');
  const walletConnect = providers.indexOf('"wallet_connect"');
  const desktopQr = providers.indexOf('"wallet_connect_qr"');

  assert.ok(metamask > -1);
  assert.ok(coinbase > metamask);
  assert.ok(rainbow > coinbase);
  assert.ok(detected > rainbow);
  assert.ok(walletConnect > detected);
  assert.ok(desktopQr > walletConnect);
});
