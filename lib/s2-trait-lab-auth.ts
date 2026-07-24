type TraitLabPreviewAuthorization = {
  wallet: string;
  tokenId: string | number;
  traitType: string;
  action: string;
  timestamp: string;
  nonce: string;
};

type TraitLabConfirmationAuthorization = {
  wallet: string;
  tokenId: string | number;
  traitType: string;
  action: string;
  paymentMode: string;
  proposedValue: string;
  costLabel: string;
  costRaw: string;
  rewardLabel?: string;
  rewardRaw?: string;
  previewId: string;
  timestamp: string;
  nonce: string;
};

export function canonicalTraitLabPreviewAction(action: string) {
  if (action === "remove") return "recycle";
  if (action === "reroll-all") return "rerollAll";
  return action;
}

export function traitLabPreviewAuthorizationMessage(input: TraitLabPreviewAuthorization) {
  return [
    "DYOOR Trait Lab Roll Authorization",
    `Wallet: ${input.wallet.toLowerCase()}`,
    `Token ID: ${String(input.tokenId)}`,
    `Trait: ${input.traitType}`,
    `Action: ${canonicalTraitLabPreviewAction(input.action)}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

export function traitLabConfirmationAuthorizationMessage(input: TraitLabConfirmationAuthorization) {
  const lines = [
    "DYOOR Trait Lab",
    `Wallet: ${input.wallet.toLowerCase()}`,
    `Token ID: ${String(input.tokenId)}`,
    `Trait: ${canonicalTraitLabPreviewAction(input.action) === "rerollAll" ? "All Filled Traits" : input.traitType}`,
    `Action: ${canonicalTraitLabPreviewAction(input.action)}`,
    `Payment: ${input.paymentMode}`,
    `Value: ${input.proposedValue}`,
    `Cost: ${input.costLabel}`,
    `CostRaw: ${input.costRaw}`,
  ];
  if (input.rewardLabel) {
    lines.push(`Reward: ${input.rewardLabel}`);
    lines.push(`RewardRaw: ${input.rewardRaw || "0"}`);
  }
  lines.push(`Preview ID: ${input.previewId}`);
  lines.push(`Timestamp: ${input.timestamp}`);
  lines.push(`Nonce: ${input.nonce}`);
  return lines.join("\n");
}
