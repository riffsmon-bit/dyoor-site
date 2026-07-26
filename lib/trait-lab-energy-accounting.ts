export type EffectiveEnergyBalance = {
  spendableRaw: string;
  spentRaw: string;
  serverSettledDebitRaw: string;
};

export type ServerEnergyDebitCandidate = {
  id: string;
  amountRaw: string;
  createdAt: string;
  status: "pending" | "charged" | "voided";
};

function unsignedRaw(value: unknown, label: string) {
  const raw = String(value ?? "0");
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be an unsigned integer string.`);
  return BigInt(raw);
}

export function effectiveEnergyBalance(input: {
  energyBankSpendableRaw: unknown;
  energyBankSpentRaw: unknown;
  serverSettledDebitRaw: unknown;
}): EffectiveEnergyBalance {
  const bankSpendable = unsignedRaw(input.energyBankSpendableRaw, "energyBankSpendableRaw");
  const bankSpent = unsignedRaw(input.energyBankSpentRaw, "energyBankSpentRaw");
  const serverDebit = unsignedRaw(input.serverSettledDebitRaw, "serverSettledDebitRaw");
  return {
    spendableRaw: (bankSpendable > serverDebit ? bankSpendable - serverDebit : 0n).toString(),
    spentRaw: (bankSpent + serverDebit).toString(),
    serverSettledDebitRaw: serverDebit.toString(),
  };
}

export function admittedServerEnergyDebitIds(
  records: ServerEnergyDebitCandidate[],
  availableRaw: unknown,
) {
  const available = unsignedRaw(availableRaw, "availableRaw");
  const charged = records.filter((record) => record.status === "charged");
  const pending = records
    .filter((record) => record.status === "pending")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const admitted = new Set<string>();
  let committed = 0n;

  // A charged debit may already have returned a result to its caller, so a
  // later request must never displace it even if both records share a clock
  // timestamp. Pending records compete only for the remaining balance.
  for (const record of charged) {
    const amount = unsignedRaw(record.amountRaw, "amountRaw");
    if (amount <= 0n) continue;
    committed += amount;
    admitted.add(record.id);
  }
  for (const record of pending) {
    const amount = unsignedRaw(record.amountRaw, "amountRaw");
    if (amount <= 0n || committed + amount > available) continue;
    committed += amount;
    admitted.add(record.id);
  }
  return {
    admitted,
    committedRaw: committed.toString(),
  };
}
