# Local mint-permission contract experiment

Status: local-only prototype, not audited, not deployed on any public chain, and NOT an upgrade or replacement for an existing Droid Wallet. The constructors and account authority checks reject chains other than 31337. No stored owner key, production secret, NFT role or metadata was used or changed.

## What exists

- `LabCollection`: a test identity with a monotonic ownership epoch. It is deliberately not Season 2 or a complete marketplace-compatible ERC-721.
- `LabMint`: a fixed inspectable mint fixture, supporting zero or nonzero prices. No approvals, operators or arbitrary external calls.
- `DroidMintAccountLab`: direct NFT-bound custody for this experiment, current-owner grant/withdrawal, one typed `NFT_MINT` permission, separate executor/reviewer, reserve/per-action/daily value/action limits, seven-day maximum grant lifetime, exact-action hash, revision, nonce, short simulation-attestation lifetime, pinned fixture bytecode and post-mint recipient/balance checks.

The executor supplies a nonce only. It cannot select target, calldata, recipient or value. The mint recipient is the account. Default state has no grant. Owner withdrawal is separate and may withdraw the owner's protected reserve; delegated execution cannot. No AI provider or unrestricted signing tool is attached.

## Run without a wallet or real funds

```sh
forge test --root contracts/droid-os-lab -vv
forge build --root contracts/droid-os-lab
node scripts/test-droid-contract-lab.mjs
```

The runner creates a fresh loopback Anvil on an ephemeral port and uses its disposable unlocked accounts. It does not load dotenv, accept a remote RPC argument, read a wallet file or expose private keys. Local RPC transactions deploy the three fixtures, fund directly, grant, attest, simulate and mint; replay and transfer failures are checked. The node is terminated afterward. Its addresses/receipts are local test evidence, not public deployments or preview wallet destinations.

The Foundry suite passed 28 tests including 256 reserve-fuzz cases: default denial, grant roles/expiry/revocation, reviewed actions, reserve/value/action caps, zero-price mint caps, stale simulation, nonce replay, bytecode change, wrong recipient, unrestricted-call rejection, withdrawals, A→B transfer, A→B→A and explicit mainnet blocking.

## Unresolved production boundaries

1. Season 2 does not expose this fixture's ownership epoch. The prototype does NOT solve transfer-epoch verification for the existing immutable collection or V1 wallets. No wrapping, NFT escrow or wallet migration has been chosen.
2. Reviewer attestation is a trusted software assertion, not cryptographic proof of simulation. The runner additionally checks an account-context eth_call. Production needs independently validated effects, provenance, freshness, receipt reconciliation and durable off-chain evidence.
3. The fixed mint fixture is not a Seaport, launchpad or DEX adapter. Memecoin buy/sell, NFT sniping, approvals, token exits, pricing and autonomous discovery are not implemented.
4. Gas is paid by disposable executor/reviewer accounts in the lab, not reimbursed from the Droid. Real relayer funding/reimbursement and gas budgets are unresolved. Native reserve accounting here covers mint value, not a claim about future relayer fees.
5. UTC-day counters persist across grant replacement. Owner-authorized new limits can change the budget; grant renewal cannot erase prior spend. Concurrent nonce use permits only one successful execution. Failed real transactions may still cost executor gas.
6. This minimal fixture account has native withdrawal only; NFT withdrawal/production custody interoperability and additional reentrancy/adversarial/independent review are not complete. Do not put real assets into it.

Public testing requires a separate network choice and a dedicated test-wallet setup. The current lab cannot deploy to Monad testnet or mainnet. The existing public preview remains read-only; merely adding these source files cannot activate financial execution. Broader execution and wallet migration design must be reviewed before lifting any chain guard.
