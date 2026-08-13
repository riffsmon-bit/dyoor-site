export const HOODYOOR_COLLECTION_NAME = "HoodYØØR";
export const HOODYOOR_MAX_SUPPLY = 3_333;
export const HOODYOOR_PREVIEW_TTL_MS = 5 * 60 * 1_000;
export const HOODYOOR_ACTION_SINGLE = 1;
export const HOODYOOR_ACTION_ALL = 2;
export const HOODYOOR_ALL_LAYERS = 255;
export const HOODYOOR_PAYMENT_ENERGY = 1;
export const HOODYOOR_PAYMENT_ETH = 2;
export const HOODYOOR_PAYMENT_USDG = 3;

export const HOODYOOR_LAYERS = [
  "Background",
  "Droid",
  "Conditions",
  "Clothes",
  "Mouth",
  "Eyes",
  "Hat",
  "Accessories",
  "Accessories 2",
] as const;

export const HOODYOOR_MUTABLE_LAYERS = [2, 3, 4, 5, 6, 7, 8] as const;

export const HOODYOOR_LAYER_COSTS: Readonly<Record<number, number>> = {
  2: 200,
  3: 200,
  4: 100,
  5: 100,
  6: 200,
  7: 300,
  8: 300,
};

export const HOODYOOR_REROLL_ALL_COST = 1_000;

export type HoodYoorRerollAction = "single" | "all";
export type HoodYoorRerollPayment = "energy" | "eth" | "usdg";

export type HoodYoorRerollAuthorization = {
  tokenId: string;
  tokenOwner: string;
  expectedTraits: string;
  nextTraits: string;
  action: number;
  layer: number;
  paymentMethod: number;
  paymentToken: string;
  paymentAmount: string;
  nonce: string;
  deadline: string;
};

export type HoodYoorTypedDataDomain = {
  name: "HoodYOORRerollController";
  version: "2";
  chainId: number;
  verifyingContract: string;
};

export const HOODYOOR_REROLL_TYPES = {
  RerollAuthorization: [
    { name: "tokenId", type: "uint256" },
    { name: "tokenOwner", type: "address" },
    { name: "expectedTraits", type: "uint256" },
    { name: "nextTraits", type: "uint256" },
    { name: "action", type: "uint8" },
    { name: "layer", type: "uint8" },
    { name: "paymentMethod", type: "uint8" },
    { name: "paymentToken", type: "address" },
    { name: "paymentAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function normalizeHoodYoorWallet(value: unknown) {
  const wallet = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

export function parseHoodYoorTokenId(value: unknown) {
  const tokenId = Number(value);
  return Number.isSafeInteger(tokenId) && tokenId >= 1 && tokenId <= HOODYOOR_MAX_SUPPLY
    ? tokenId
    : 0;
}

export function hoodYoorPaymentCode(payment: HoodYoorRerollPayment) {
  if (payment === "energy") return HOODYOOR_PAYMENT_ENERGY;
  if (payment === "eth") return HOODYOOR_PAYMENT_ETH;
  return HOODYOOR_PAYMENT_USDG;
}

export function hoodYoorPaymentLabel(payment: HoodYoorRerollPayment) {
  if (payment === "energy") return "Energy";
  if (payment === "eth") return "ETH";
  return "USDG";
}

export function hoodYoorPreviewRequestMessage({
  wallet,
  tokenId,
  action,
  layer,
  payment,
  issuedAt,
  nonce,
}: {
  wallet: string;
  tokenId: number;
  action: HoodYoorRerollAction;
  layer: number | null;
  payment: HoodYoorRerollPayment;
  issuedAt: string;
  nonce: string;
}) {
  const normalizedWallet = normalizeHoodYoorWallet(wallet);
  const actionLabel = action === "all"
    ? "Reroll All Filled Traits"
    : `Reroll ${HOODYOOR_LAYERS[layer ?? -1] || "Trait"}`;

  return [
    `${HOODYOOR_COLLECTION_NAME} Trait Lab Preview`,
    "Authorize one compatibility-checked preview. This signature does not spend anything or change the NFT.",
    `Wallet: ${normalizedWallet}`,
    `Token: ${tokenId}`,
    `Action: ${actionLabel}`,
    `Payment: ${hoodYoorPaymentLabel(payment)}`,
    `Issued At: ${issuedAt}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function hoodYoorRerollTypedData({
  chainId,
  controller,
  authorization,
}: {
  chainId: number;
  controller: string;
  authorization: HoodYoorRerollAuthorization;
}) {
  const domain: HoodYoorTypedDataDomain = {
    name: "HoodYOORRerollController",
    version: "2",
    chainId,
    verifyingContract: controller,
  };

  return {
    domain,
    types: HOODYOOR_REROLL_TYPES,
    primaryType: "RerollAuthorization" as const,
    message: authorization,
  };
}

export function hoodYoorWalletTypedDataPayload({
  chainId,
  controller,
  authorization,
}: {
  chainId: number;
  controller: string;
  authorization: HoodYoorRerollAuthorization;
}) {
  const typedData = hoodYoorRerollTypedData({ chainId, controller, authorization });
  return JSON.stringify({
    ...typedData,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...typedData.types,
    },
  });
}
