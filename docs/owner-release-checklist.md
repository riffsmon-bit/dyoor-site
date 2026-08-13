# HoodYØØR owner release checklist

Status: **BLOCKED — every box intentionally unchecked**

An unchecked item is not approved. A checked code-review item does not authorize deployment. A checked deployment item does not authorize economic configuration. A checked configuration item does not authorize feature activation.

## Gate A — code approval

- [ ] Clean release commit approved
- [ ] Dirty/untracked production scope fully reviewed
- [ ] Pinned toolchain approved
- [ ] Rebuild reproduced twice from the clean commit
- [ ] `ARTIFACT FREEZE BROKEN` resolved and new artifact manifest approved
- [ ] Whole-artifact drift root cause accepted
- [ ] No-key preflight boundary independently verified
- [ ] Monad independent audit passed
- [ ] Robinhood economic independent audit passed
- [ ] Updated Revenue Vault independently reviewed
- [ ] No unresolved critical/high finding
- [ ] Every bytecode-changing fix has a new hash and retest

Gate A owner approval reference: `UNSET`

## Gate B — Monad contracts

For each immutable deployment:

| Contract | Artifact reviewed | Audit passed | Constructor approved | Deployer approved | Gas approved | Deployment approved |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical ERC-6551 Registry | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| `DroidAccountV1` | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Collection `DroidAccountRegistry` | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

> **IMMUTABLE DEPLOYMENT:** Review the exact artifact/payload hash and constructor values. These contracts cannot be corrected through an ordinary upgrade after deployment.

- [ ] Monad deployer address and nonce plan approved
- [ ] Refreshed fee checkpoint approved
- [ ] Maximum gas per transaction approved
- [ ] MON funding source and exact ceiling approved
- [ ] Post-deploy assertion operator approved
- [ ] Explorer/source verification procedure approved
- [ ] Explicit Monad deployment authorization issued separately

Gate B Monad deployment approval reference: `UNSET`

## Monad canary

- [ ] Project-controlled token ID approved
- [ ] Wallet A approved
- [ ] Wallet B approved
- [ ] Maximum MON funding approved
- [ ] Test asset and dust amount approved, or explicitly skipped
- [ ] NFT transfer and optional return transfer approved
- [ ] Canary observers and incident owner assigned
- [ ] 24–72-hour observation plan approved
- [ ] Canary authorized separately

`MONAD_CANARY_TOKEN_ID = UNSET`
`MONAD_CANARY_OWNER_A = UNSET`
`MONAD_CANARY_OWNER_B = UNSET`
`CANARY_MAX_MON_FUNDING = UNSET`
`CANARY_APPROVED_TEST_ASSET = UNSET`

## Gate B — Robinhood contracts

- [ ] Full collection address and zero-supply sale-closed state confirmed again
- [ ] Existing Account V1 wiring confirmed again
- [ ] Current EOA owner/treasury risk accepted or Safe migration separately approved
- [ ] Droid Registry artifact/audit/constructor approved
- [ ] Asset Registry artifact/audit/constructor approved
- [ ] Reward Distributor artifact/audit/constructor approved
- [ ] Updated Revenue Vault artifact/audit/constructor approved
- [ ] Strategy Registry artifact/audit/constructor approved
- [ ] Achievement Registry artifact/audit/constructor approved
- [ ] Safe addresses approved
- [ ] Deployer and nonce plan approved
- [ ] Final live simulations and gas maxima approved
- [ ] Economic deployment authorized separately

Gate B Robinhood deployment approval reference: `UNSET`

## Gate C — governance and economic configuration

- [ ] Governance Safe and threshold approved
- [ ] Treasury Safe and threshold approved
- [ ] Restricted operations Safe and threshold approved
- [ ] Emergency Safe/pauser approved
- [ ] Other Approved Allocation Safe and mandate approved
- [ ] Signer backup/recovery and rotation procedure approved
- [ ] `DEFAULT_ADMIN` assignment approved
- [ ] `TREASURY_ADMIN` assignment approved
- [ ] `REWARD_ADMIN` assignment approved
- [ ] `STRATEGY_ADMIN` assignment approved
- [ ] `ASSET_ADMIN` assignment approved
- [ ] `ACHIEVEMENT_ADMIN` assignment approved
- [ ] `PAUSER` assignment approved
- [ ] 24–72-hour timelock policy approved
- [ ] 6,000 / 3,000 / 1,000 launch split approved
- [ ] Governance-only allocation bounds approved
- [ ] Every revenue source approved
- [ ] Every asset and canonical address approved
- [ ] Every execution/acquisition route approved
- [ ] Every pricing source approved
- [ ] Every strategy, weights, slippage, fallback, and risk label approved
- [ ] Reward-weight and anti-manipulation policy approved
- [ ] First funded epoch manifest/cap/cadence approved

Gate C configuration approval reference: `UNSET`

## Gate D — feature activation

- [ ] Monad general Droid activation
- [ ] Monad portfolio display
- [ ] Monad rewards
- [ ] Monad strategies
- [ ] Robinhood Droid activation
- [ ] Robinhood portfolio display
- [ ] Robinhood rewards
- [ ] Robinhood strategies
- [ ] Shared treasury accounting view
- [ ] Agent
- [ ] Bridge

`AGENT_APPROVED = false`
`BRIDGE_APPROVED = false`

Gate D activation approval reference: `UNSET`

## Owner decision record

Owner/governance body: `UNSET`
Decision date/time UTC: `UNSET`
Source commit: `UNSET`
Release manifest SHA-256: `UNSET`
Approved stage: `UNSET`
Approved chain: `UNSET`
Approved transaction IDs: `UNSET`
Maximum native-token spend: `UNSET`
Approval evidence/signature reference: `UNSET`

Nothing in this page, including the recommended treasury split, constitutes approval until the appropriate stage reference is deliberately completed against a clean, audited artifact manifest.
