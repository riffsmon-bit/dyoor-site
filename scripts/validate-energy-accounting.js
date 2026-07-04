const ONE = 10n ** 18n;

function entry(id, type, amountRaw) {
  return { id, type, amountRaw: String(amountRaw) };
}

function balance(entries) {
  const seen = new Set();
  let harvested = 0n;
  let airdropped = 0n;
  let otherCredits = 0n;
  let spent = 0n;
  let adjustment = 0n;

  for (const item of entries) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const amount = BigInt(item.amountRaw);
    if (item.type === "CREDIT_HARVEST") harvested += amount;
    if (item.type === "CREDIT_AIRDROP") airdropped += amount;
    if (item.type === "CREDIT_RECHARGE" || item.type === "CREDIT_TRANSFER") otherCredits += amount;
    if (item.type === "DEBIT_REROLL" || item.type === "DEBIT_UPGRADE" || item.type === "DEBIT_MARKETPLACE" || item.type === "DEBIT_TRANSFER") spent += amount;
    if (item.type === "ADJUSTMENT_ADMIN") adjustment += amount;
  }

  const lifetime = harvested + airdropped + otherCredits;
  const spendable = harvested + airdropped + otherCredits + adjustment - spent;
  return {
    harvested,
    airdropped,
    otherCredits,
    spent,
    adjustment,
    lifetime,
    spendable: spendable > 0n ? spendable : 0n,
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected.toString()}, got ${actual.toString()}`);
  }
}

const entries = [
  entry("harvest:0xaaa:1", "CREDIT_HARVEST", 100n * ONE),
  entry("harvest:0xaaa:1", "CREDIT_HARVEST", 100n * ONE),
  entry("airdrop:test-campaign", "CREDIT_AIRDROP", 25n * ONE),
  entry("recharge:0xbbb", "CREDIT_RECHARGE", 50n * ONE),
  entry("transfer:0xccc:credit", "CREDIT_TRANSFER", 15n * ONE),
  entry("reroll:token-7:op-1", "DEBIT_REROLL", 10n * ONE),
  entry("upgrade:token-7:op-2", "DEBIT_UPGRADE", 5n * ONE),
  entry("transfer:0xddd:debit", "DEBIT_TRANSFER", 15n * ONE),
];

const result = balance(entries);
assertEqual(result.harvested, 100n * ONE, "duplicate harvest prevention");
assertEqual(result.airdropped, 25n * ONE, "airdrop credit");
assertEqual(result.otherCredits, 65n * ONE, "recharge and transfer credits");
assertEqual(result.spent, 30n * ONE, "spend debits");
assertEqual(result.lifetime, 190n * ONE, "lifetime formula");
assertEqual(result.spendable, 160n * ONE, "spendable formula");

const overSpent = balance([
  entry("harvest:0xbbb:1", "CREDIT_HARVEST", 5n * ONE),
  entry("reroll:token-1:op-1", "DEBIT_REROLL", 10n * ONE),
]);
assertEqual(overSpent.spendable, 0n, "negative spendable clamp");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "duplicate harvest prevention",
    "airdrop credit",
    "recharge credit",
    "transfer credit",
    "reroll debit",
    "transfer debit",
    "spendable formula",
    "lifetime formula",
    "negative spendable clamp",
  ],
}, null, 2));
