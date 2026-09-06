# Deployment scope and MON budget

Original read-only observations: 6 September 2026. Later, separately authorized ASSIST registry + test badge deployment cost **0.49270896 MON**: [receipt and scope](11-assist-canary.md). Account activation and mint are separate owner-approved transactions, quoted afresh in the preview. This is not the cost of a complete autonomous Droid OS stack.

## Original read-only UI preview: 0 MON

The UI review requires no contract deployment, wallet activation or funding. Season 2, the canonical ERC-6551 registry, Account V1 implementation and collection registry already exist; see the current-state audit for fixed-block verification. Existing account 11 is already deployed.

The next read-only identity/portfolio integration also does not require replacing those contracts. Future capability/execution contracts are not yet implemented or approved; quoting a total deployment budget now would be speculative. Fully on-chain art is a separate, uncosted design track.

## Existing per-Droid activation reference—not new shared infrastructure

The successful historical activation transaction `0xa796c880a92a6d9b3de493cb794035b8e220f603a1e77ebab6a6bc8c578f76eb` was re-read from Monad mainnet. Receipt gas charged: 180,000; effective gas price: 102,000,000,000 wei; fee: **0.01836 MON**. This was a single account activation, not deployment of the entire Droid OS contract stack.

At `2026-09-06T14:38:58.273Z`, a public Monad RPC returned chain 143 and `eth_gasPrice = 102,000,000,000 wei` (102 MON-gwei). At that price, a hypothetical 1,000,000-gas transaction would cost 0.102 MON. This arithmetic is a reference, not a quote for an unspecified future contract.

Monad charges the selected gas limit, not just work actually consumed. Budgets must include realistic gas limits, fees, constructor arguments, configuration transactions and a separately stated buffer. See [official gas pricing documentation](https://docs.monad.xyz/developer-essentials/gas-pricing). Do not include speculative trading capital, user deposits, AI bills or on-chain artwork storage in a deployment-gas estimate without labeling them separately.

Before requesting deployment funds: finalize required contracts; compile exact versions; estimate/simulate deployments and setup; show the per-contract gas/fee breakdown and buffer; obtain separate production authorization. Do not replace the collection or silently change an existing Droid Wallet address to make a deployment easier.
