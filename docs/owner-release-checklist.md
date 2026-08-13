# HoodYØØR owner release checklist

Status: **AUDIT REQUIRED — NO DEPLOYMENT AUTHORIZED**

Checked engineering-evidence items are complete. Every authorization item remains unchecked. Code approval does not authorize deployment; deployment does not authorize configuration; configuration does not authorize activation.

## Engineering evidence

- [x] Release scope classified without discarding user files
- [x] Clean source commit created: `b7c22ce11a9da833c2900c68937d20c547bf5f8a`
- [x] Artifact drift explained field-by-field
- [x] Build A equals Build B
- [x] Third clean-room build equals A/B
- [x] Secret-free preflights and build path established
- [x] New artifact freeze issued; old approvals invalidated
- [x] Live Monad/Robinhood read-only checkpoints refreshed
- [ ] Independent audit started
- [ ] Independent audit passed for every in-scope candidate
- [ ] Updated Revenue Vault independently reviewed
- [ ] All critical/high findings resolved and retested

## A. Monad contracts

| Candidate | Artifact reviewed | Audit passed | Constructor approved | Deployer approved | Gas approved | Deployment approved |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical ERC-6551 Registry | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Immutable `DroidAccountV1` | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Immutable collection `DroidAccountRegistry` | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

> **IMMUTABLE DEPLOYMENT:** Review exact hashes and constructor values. Ordinary upgrade mechanisms cannot correct these deployments.

`MONAD_DROID_ACCOUNT_DEPLOYMENT_APPROVED = false`

## B. Monad canary

- [ ] Project-controlled token ID approved
- [ ] Wallet A approved
- [ ] Wallet B approved
- [ ] Maximum MON funding approved
- [ ] Test asset/dust amount approved or explicitly skipped
- [ ] NFT transfer and optional return approved
- [ ] 24–72-hour observers and incident owner approved
- [ ] Canary authorized separately

```text
MONAD_CANARY_TOKEN_ID = UNSET
MONAD_CANARY_OWNER_A = UNSET
MONAD_CANARY_OWNER_B = UNSET
CANARY_MAX_MON_FUNDING = UNSET
CANARY_APPROVED_TEST_ASSET = UNSET
MONAD_CANARY_APPROVED = false
```

## C. Robinhood

- [x] Full collection address/live bytecode confirmed
- [x] Zero-supply pre-mint state confirmed
- [x] Existing Account V1 wiring confirmed
- [ ] Six economic artifacts owner-reviewed
- [ ] Updated Revenue Vault independently reviewed
- [ ] Main Governance Safe approved
- [ ] Treasury Safe approved
- [ ] Restricted Operations Safe approved, if used
- [ ] Signers/thresholds/recovery approved
- [ ] Collection/treasury/royalty Safe migration approved
- [ ] Least-privilege roles approved
- [ ] Treasury split approved
- [ ] Assets approved
- [ ] Revenue sources approved
- [ ] Strategies/routes approved
- [ ] Gas limits/budget approved
- [ ] Economic deployment authorized separately

`ROBINHOOD_ECONOMIC_DEPLOYMENT_APPROVED = false`

## D. Activation

- [ ] Monad general Droid activation
- [ ] Monad rewards
- [ ] Monad strategies
- [ ] Robinhood Droid activation
- [ ] Robinhood rewards
- [ ] Robinhood strategies
- [ ] Shared treasury accounting view
- [ ] Agent
- [ ] Bridge

All matching machine authorization fields are `false`. Rewards remain unfunded; strategies, agents, and bridges remain disabled.

## Owner references

```text
CODE_APPROVAL_REFERENCE = UNSET
INDEPENDENT_AUDIT_REPORT = UNSET
MONAD_DEPLOYMENT_APPROVAL_REFERENCE = UNSET
MONAD_CANARY_APPROVAL_REFERENCE = UNSET
ROBINHOOD_DEPLOYMENT_APPROVAL_REFERENCE = UNSET
ECONOMIC_CONFIGURATION_APPROVAL_REFERENCE = UNSET
FEATURE_ACTIVATION_APPROVAL_REFERENCE = UNSET
```
