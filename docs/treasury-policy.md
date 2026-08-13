# HoodYØØR treasury policy

Status: **policy recommendation only — not configured or approved**

The HoodYØØR treasury is a unified accounting view over independent chain-local treasuries. Monad assets stay on Monad; Robinhood Chain assets stay on Robinhood Chain. Aggregated fiat values are display-only. No bridge, shared custody contract, or cross-chain allowance is part of this release.

## Revenue allocation

Recommended launch proposal:

| Allocation | Basis points | Share | Owner approved |
| --- | ---: | ---: | --- |
| Project Treasury | 6,000 | 60% | No |
| Droid Rewards | 3,000 | 30% | No |
| Other Approved Allocation | 1,000 | 10% | No |
| Total | 10,000 | 100% | — |

Potential steady-state consideration after approximately 60–90 days of meaningful revenue history:

| Allocation | Basis points | Share |
| --- | ---: | ---: |
| Project Treasury | 5,500 | 55% |
| Droid Rewards | 3,500 | 35% |
| Other Approved Allocation | 1,000 | 10% |

The later target is not automatic. It requires a fresh cost, reserve, risk, and governance review plus explicit owner/governance approval.

The updated `HoodYoorRevenueVault` requires all three values to sum exactly to 10,000 bps and places indivisible rounding dust in Project Treasury. It does **not** enforce the proposed per-bucket operating ranges below:

| Allocation | Recommended minimum | Recommended maximum | Enforcement |
| --- | ---: | ---: | --- |
| Project Treasury | 4,500 bps | 7,000 bps | governance policy only |
| Droid Rewards | 2,000 bps | 4,500 bps | governance policy only |
| Other Approved | 0 bps | 1,500 bps | governance policy only |

The vault’s only on-chain allocation invariant is the exact 10,000-bps total. Adding hard per-bucket bounds would change frozen bytecode and therefore requires a separate owner decision, new artifact freeze, and independent review. Until then, allocation changes should be proposed through a 24–72-hour Safe/timelock process. The current vault candidate does not delay `setAllocationBps` itself.

Human-readable configuration preview:

> You are about to set Project Treasury to 6,000 bps, Droid Rewards to 3,000 bps, and Other Approved Allocation to 1,000 bps. The values total 10,000 bps. This changes how future approved revenue deposits are accounted; it does not move existing Droid assets.

## Project Treasury planning

This is off-chain planning guidance, not a contract allocation:

| Use | Share of Project Treasury budget |
| --- | ---: |
| Development, infrastructure, and operations | 40% |
| Security, audits, and legal/compliance | 25% |
| Long-term reserve and runway | 20% |
| Growth, partnerships, community, and product expansion | 15% |

Do not encode these sub-percentages into contracts unless separately requested and reviewed.

## Other Approved Allocation

The 10% bucket is not an unrestricted discretionary or founder/team withdrawal wallet. Each destination and use must be transparent, auditable, and explicitly approved. Eligible classes may include partnerships, grants, community programs, release/canary operations, strategic integrations, controlled growth experiments, and future protocol incentives.

The destination should be a dedicated Safe with a documented mandate. The Revenue Vault’s three destinations change atomically after a 48-hour on-chain delay. A destination change never grants emergency withdrawal from Droid Accounts.

## Rewards

The invariant is:

```text
available funded reward assets >= reserved claims >= paid claims
```

Rewards are funded distributions. There is no unfunded promise, guaranteed APY, guaranteed appreciation, or automatic right arising from NFT ownership. Energy remains non-financial progression and is never converted into dollars or minted financial assets.

V1 should use manually approved weekly or biweekly Merkle epochs. Each epoch must have a reproducible allocation manifest, chain-qualified Droid identity, funding reconciliation, start/end window, cap, and post-epoch closeout. Real-time distribution on each revenue deposit is intentionally excluded.

After enough revenue history exists, governance may target an undistributed reserve equal to roughly one to three expected future epochs. No reserve amount should be estimated today; use conservative manual epoch funding until actual revenue and claim behavior are known.

## Safe and timelock policy

Prefer 3-of-5 for main governance and meaningful treasury authority. A 2-of-3 restricted operations Safe may be used during an early launch if five independent signers are not operationally viable. Never use 1-of-1 unrestricted treasury administration.

Sensitive actions should normally wait 24–72 hours: allocation changes, treasury destination changes, automatic-execution asset additions, router replacements, major reward-weight changes, strategy implementation changes, and financial upgrades. Emergency pause remains immediate but provides no seizure or withdrawal authority.

Every Safe requires an owner-approved signer inventory, hardware separation, recovery/backup procedure, loss-of-signer procedure, quorum-change procedure, and periodic access review before receiving a production role.
