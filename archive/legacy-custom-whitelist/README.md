# Legacy Custom Whitelist Tooling

These files are archived because D.Y.O.O.R Season 2 no longer uses a custom
D.Y.O.O.R Merkle allowlist in the NFT contract or website.

Paid mint allowlists, presale schedules, per-wallet limits, and prices are now
intended to be configured through OpenSea/SeaDrop where supported.

Archived files:

- `scripts/generate-whitelist-merkle.js`
- `scripts/regular-whitelist-merkle-lib.js`
- `scripts/verify-whitelist-merkle.js`
- `scripts/generate-s2-direct-allowlist.js`
- `scripts/generate-s2-merkle.js`
- `test/regular-whitelist-merkle.test.js`
- `docs/DYOOR_S2_WHITELIST_MERKLE.md`

Do not treat generated Merkle roots or proofs from this archive as production
inputs for the current SeaDrop refactor.

Historical wallet source files should remain outside this archive when present
so they can be converted into OpenSea-compatible presale uploads.
