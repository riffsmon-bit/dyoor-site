# Energy and Droid missions — proposal, not activated

User direction: Droids could consume Energy while pursuing opportunities and earn Energy after successful token trades or acquired free mints. This document interprets “when out” as scouting/research activity. Exact consumption/reward rules remain undecided; no Energy balance, accounting code, rate or reward was changed.

## Preserve the utility boundary

Energy remains non-transferable utility points. It is never gas, money, a yield promise, a claim on profits, a substitute for MON, or financial execution authority. Having Energy cannot create a capability grant or expand a reserve, contract scope or spend cap. A qualifying activity earns a capped utility reward, not financial returns denominated in Energy.

Use Energy to meter optional research, monitoring or mission compute after explicit owner enrollment. Existing balances are owner-wallet scoped. A future per-Droid mission allowance must be an explicit owner allocation against the existing ledger, not a fabricated independent balance. NFT transfers must invalidate former-owner allocations; do not transfer a former owner's Energy balance with the NFT.

When a mission's Energy allowance is exhausted, stop optional new work and notify the owner. Do not stop security checks, pending-transaction reconciliation, grant revocation, owner withdrawals or required position monitoring. Any existing-position exit still requires its own valid authorization and risk controls; Energy never grants an emergency bypass. Reserve sufficient infrastructure budget for these duties independently of reward points.

## Reward eligibility

Define “successful” explicitly. A mined transaction can lose money. Initial rewards should be for verified qualifying mission completion rather than token volume, raw transaction count or profit claims.

- Mint: approved collection/mission, unique verified NFT receipt into the canonical Droid account, zero mint price independently checked (gas still costs MON), no reverted receipt, one reward per qualifying acquisition.
- Trade: approved route/capability/mission and reconciled account-specific effects. A completed buy alone is not a profitable position. Profit-based criteria require reliable cost basis, fees, closed-position accounting and anti-manipulation evidence; unknown profitability earns no profit-specific reward.
- Apply owner and Droid daily caps, cooldowns, collection/mission eligibility and unique chain+transaction+log/mission deduplication. Reject self-trading, related-account wash activity where detectable, repeated transfers of the same NFT, spoofed receipts and repeated mint/burn farming. Detection is imperfect; caps remain necessary.
- Rewards are pending until receipt finality/reorg policy passes. Store eligible evidence, rule version, owner epoch, credit recipient and settlement state. Use idempotent transactional settlement; unknown/reorged evidence must not create duplicate credits.

The AI may explain an award but cannot mint Energy, choose its amount, edit the reward rules or mark an action successful. Existing Energy settlement authority remains isolated from AI, public research and preview routes.

## Decisions before implementation

Agree on which missions consume points, debit/refund semantics for failed service work, consumption cadence, daily caps, qualifying collections/routes, reward sizes, wash-farming controls, finality handling and the definition of a qualifying trade. Budget independent position monitoring and define owner-era accounting at transfer. Start with research and allowlisted mint missions before any speculative trading incentive.
