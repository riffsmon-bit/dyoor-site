export const HOODYOOR_CHAIN_ID = 4_663;
export const HOODYOOR_EXPLORER_URL = "https://robinhoodchain.blockscout.com";
export const HOODYOOR_MAX_SUPPLY = 3_333;
export const HOODYOOR_MINT_PRICE_ETH = "0.0025";
export const HOODYOOR_MINT_ENERGY_REWARD = 1_000;
export const HOODYOOR_ROYALTY_BPS = 300;
export const HOODYOOR_PROVENANCE_HASH =
  "0x2b3049a8235d705dba39542b53990e584e3815e4e6a32efae6ecb810b8f506a3";

export const HOODYOOR_COLLECTION_ADDRESS =
  "0x8277F8126722B11D7b44C5C453bcF62A78AAFa25";
export const HOODYOOR_RENDERER_ADDRESS =
  "0xb9cB0563013D9741f76a802d2F658EbF3433eE12";
export const HOODYOOR_TRAIT_STORE_ADDRESS =
  "0xaD7be6b27efDF619759375aF719A9D69e25818c1";
export const HOODYOOR_TRAIT_RULES_ADDRESS =
  "0xd4E7F224539e628f58c4A6159A7a0eeE27991640";
export const HOODYOOR_ENERGY_BANK_ADDRESS =
  "0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3";
export const HOODYOOR_REROLL_CONTROLLER_ADDRESS =
  "0x6cf24a0119b7286ad88855Baa9CB220DF628FD11";
export const HOODYOOR_DROID_IMPLEMENTATION_ADDRESS =
  "0x0FFDc6ACb41D39ee7b535026202AA8fe0054F52A";
export const HOODYOOR_DROID_REGISTRY_ADDRESS =
  "0x190602Aa70199ec3623ad3bc97a10B534b26fE48";
export const HOODYOOR_DROID_START_BLOCK = 33_356_761;
export const HOODYOOR_CANONICAL_ERC6551_REGISTRY_ADDRESS =
  "0x000000006551c19487814612e58FE06813775758";

export const HOODYOOR_CONTRACTS = Object.freeze([
  {
    label: "HoodYØØR Collection",
    address: HOODYOOR_COLLECTION_ADDRESS,
    description: "The parent ERC-721, fully onchain identity, mint, transfer, and metadata authority.",
  },
  {
    label: "Droid Account Registry",
    address: HOODYOOR_DROID_REGISTRY_ADDRESS,
    description: "Calculates and activates each HoodYØØR's deterministic smart account.",
  },
  {
    label: "Droid Account V1",
    address: HOODYOOR_DROID_IMPLEMENTATION_ADDRESS,
    description: "Immutable NFT-controlled account logic for holding and moving Droid inventory.",
  },
  {
    label: "Reroll Controller V2",
    address: HOODYOOR_REROLL_CONTROLLER_ADDRESS,
    description: "Owner-bound, replay-protected trait rerolls using Energy, ETH, or USDG.",
  },
  {
    label: "Energy Bank",
    address: HOODYOOR_ENERGY_BANK_ADDRESS,
    description: "The existing non-transferable HoodYØØR Energy ledger.",
  },
  {
    label: "Pixel Renderer",
    address: HOODYOOR_RENDERER_ADDRESS,
    description: "Builds each 128×128 Droid and token metadata entirely onchain.",
  },
  {
    label: "Packed Trait Store",
    address: HOODYOOR_TRAIT_STORE_ADDRESS,
    description: "Frozen bytecode-backed pixel art for the 201 committed traits.",
  },
  {
    label: "Trait Rules",
    address: HOODYOOR_TRAIT_RULES_ADDRESS,
    description: "Frozen compatibility rules enforced by the reroll system.",
  },
] as const);

export function hoodyoorExplorerAddress(address: string) {
  return `${HOODYOOR_EXPLORER_URL}/address/${address}`;
}

export function shortHoodYoorAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
