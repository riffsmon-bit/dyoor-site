# Release source snapshot

Status: **CLEAN / REPRODUCIBLE / AUDIT REQUIRED**

Source commit: `d272a55e78219e993015a2df31facc0f153af827`

Branch: `release/hoodyoor-audit-rc-20260812`

This snapshot is suitable for independent audit. It is not code approval, deployment authorization, economic configuration authorization, or feature activation authorization. The machine record is `deployments/authorization/release-source-snapshot.json`.

## Source-control result

The release tree contains 4,053 tracked files and no tracked or untracked changes in the isolated checkouts used for release builds. There are no Git submodules. The original authoring worktree’s excluded local/generated/unrelated files were preserved and never hidden inside the release commit; their classification is in `docs/release-change-classification.md` and `deployments/release-freeze/worktree-classification.json`.

The release was prepared through these reviewable source checkpoints:

- `054a1bdafff8532917b5c097cf7e1cf650009889` — reviewed release contents and secret-free tooling;
- `b7c22ce11a9da833c2900c68937d20c547bf5f8a` — final reproducibility-package correction and frozen source snapshot.
- `d272a55e78219e993015a2df31facc0f153af827` — exact historical compiler-context restoration and keyless legacy artifact builder.

Relevant lock hashes:

| Lock | SHA-256 |
| --- | --- |
| Root `package-lock.json` | `6e2c0d42a5d0d82672c81e6132423ba875c1d3f7893d97ef2029cb1db396b743` |
| Game lock | `c828246957f051143dd565535aa91618a71e9fafa586ae3e22d9377175b29b6c` |
| Discord lock | `d6207a32f6f35ca32caecba43dee2a4bfe0ff9e0bee37ada08ab1d262fa7756d` |

## Pinned release toolchain

| Tool | Version/settings |
| --- | --- |
| Node | `v24.14.1` |
| npm | `11.11.0` |
| Hardhat | `3.11.1` |
| Forge/Cast | `1.5.1-stable`, commit `b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2` |
| Solidity release compiler | `0.8.24+commit.e11b9ed9` |
| Optimizer | enabled, 200 runs |
| Via IR | enabled |
| EVM | `paris` |
| Metadata bytecode hash | `ipfs` |
| Release scope | `src/droid` and `src/economic` |

The root Hardhat compiler profiles are used for the wider repository suite; they are not the artifact-authority pipeline for these candidates.

## Reproducibility

Build A and Build B each began from the exact source commit with no build cache. Output and cache directories were deleted between runs. A third build used a separate fresh detached worktree of the same commit, a fresh output/cache location, no generated artifact reuse, no root environment files, and only locked runtime/compiler dependencies.

All three builds matched for every candidate across:

- source hash;
- complete artifact JSON hash;
- canonical artifact hash;
- ABI and constructor schema;
- creation and runtime bytecode;
- storage layout;
- link references;
- immutable reference locations.

Evidence:

- `deployments/release-freeze/reproducibility.json`
- `deployments/release-freeze/clean-room-check.json`
- `deployments/release-freeze/contract-artifacts.json`

## Prior artifact drift

The six old whole-artifact failures are fully explained in `docs/artifact-drift-analysis.md`. Compiler AST/source identifiers changed with compilation scope while source, ABI, constructor, creation/runtime bytecode, storage semantics, link references, and immutable patch locations remained unchanged. The old files were reconstructed exactly to their prior hashes, proving the changed fields. The wider root suite also found legacy Robinhood launch metadata drift caused solely by a newly introduced remapping value; a separate historical profile now reproduces those already-deployed artifacts exactly without weakening their sentinels.

The old freeze and every approval against it are explicitly invalidated. The replacement release profile produces deterministic full JSON artifacts, and the canonical hash independently binds all deployment/security-critical fields while excluding only proven debug/AST identifiers.

## Secret isolation

The prior blocked pass’s legacy Robinhood preflight loaded local deployer key material merely to derive a public address. It did not print the key, sign, connect a signer, or broadcast, but the read violated the release boundary.

Remediation is complete:

- release preflights do not load `.env`, `.env.local`, production env files, or private reveal data;
- Hardhat no longer imports dotenv implicitly;
- address-only simulations use explicit public `HOODYOOR_DEPLOYER_ADDRESS` configuration;
- signing-variable names are rejected without dereferencing their values;
- keyless child processes receive only allowlisted public variables;
- `BROADCAST=false` and financial/autonomy feature flags are forced off;
- a preload sentinel blocks secret-file content reads;
- automated isolation tests pass.

See `docs/release-environment-separation.md`.

## Gate

Independent audit status remains `NOT STARTED`. The clean/reproducible engineering blockers are resolved, but production remains blocked at `PASS_AUDIT_REQUIRED`.
