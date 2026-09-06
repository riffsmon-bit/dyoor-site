import type { WalletListEntry } from "@privy-io/react-auth";

// Put intentional choices ahead of browser-detected extensions. In particular,
// a detected extension must not silently become the user's selected wallet.
// WalletConnect remains available last for wallets not represented explicitly.
export const PRIVY_WALLET_LIST: WalletListEntry[] = [
  "metamask",
  "coinbase_wallet",
  "robinhood_wallet",
  "rainbow",
  "phantom",
  "okx_wallet",
  "wallet_connect_qr",
  "detected_ethereum_wallets",
  "wallet_connect",
];
