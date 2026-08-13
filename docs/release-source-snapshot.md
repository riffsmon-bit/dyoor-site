# Release source snapshot

Status: **BLOCKED — no clean release snapshot**
Artifact status: **ARTIFACT FREEZE BROKEN**
Captured: 2026-08-12 15:00:53 UTC

This document records the candidate that was inspected for the dual-chain deployment-authorization package. It is not a production release tag, code approval, deployment approval, or permission to read a key. The machine-readable record is `deployments/authorization/release-source-snapshot.json`.

## Source-control result

| Field | Recorded value |
| --- | --- |
| Branch | `agent/s2-trait-marketplace` |
| HEAD | `e498144f033ef3c302a2bab73225552d290fd033` |
| Worktree | dirty |
| Modified tracked entries | 22 |
| Deleted tracked entries | 8 |
| Untracked entries | 113 |
| Submodules | none reported |
| Clean-source gate | failed |

Release-relevant Solidity, Droid frontend/backend, deployment, documentation, test, package, and environment-template files are uncommitted. The worktree also contains unrelated user work. This pass did not discard, stage, or commit any of it. A commit SHA by itself therefore does not identify the candidate under review.

The status, tracked diff, untracked path list, and tracked index were separately SHA-256 fingerprinted in the machine manifest. Those fingerprints were captured before adding this authorization package and are evidence of the blocked input state, not a releasable tree hash.

## Toolchain

| Tool | Version |
| --- | --- |
| Node | `v24.14.1` |
| npm | `11.11.0` |
| Hardhat | `3.11.1` |
| Forge / Cast | `1.5.1-stable` (`b0a9dd9…`) |
| Git | `2.37.1 (Apple Git-137.1)` |
| Release Solidity compiler | `0.8.24+commit.e11b9ed9` |

The release Solidity profile is `contracts/hoodyoor/foundry.toml`: optimizer enabled, 200 runs, via-IR enabled, EVM target `paris`, no linked libraries. The root Hardhat configuration contains additional compiler profiles; it is not the frozen artifact pipeline for these candidates.

Lock and configuration checksums are recorded in the JSON manifest. The principal package-lock SHA-256 is `6e2c0d42…96b743`; the HoodYØØR Foundry configuration SHA-256 is `0eaaf382…ca097`.

The initial inventory enumerated only environment file names. Afterward, the legacy `preflight:robinhood:seadrop-v2` command was run to confirm sale state. Inspection immediately afterward showed that this nominally read-only script called `loadHoodyoorLocalEnvironment()`, loaded `.env`, and instantiated an unconnected ethers `Wallet` from `HOODYOOR_DEPLOYER_PRIVATE_KEY` to derive an address. It did not print the key, connect that wallet to a provider, sign a transaction, broadcast, or modify credential files. It nevertheless violated this task's no-private-key-read boundary.

The preflight was then patched to remove local environment loading and private reveal-backup inspection, use an empty keyless environment for launch-gate reporting, and explicitly report both secret reads as false. The package verifier enforces this. The historical access remains recorded as `privateKeyRead: true` and is an additional release blocker pending review.

Two other standard validation paths also auto-load root environment files: `hardhat.config.js` imports `dotenv/config` during `npm test`, and Next reported loading `.env.local` and `.env` during `npm run build`. No secret was printed, used to sign, or broadcast. Because a deployer credential is known to be present in the local launch environment, these general commands are not classified as keyless. The release-safe command list is restricted to scripts statically checked not to import the key loader, or they must be run later in an independently prepared secret-free environment.

The documented template is `.env.example`; expected runtime contexts are local/development, Netlify deploy preview, branch deploy, and production.

## Forced rebuild result

The full contract set was rebuilt without network access:

```sh
cd contracts/hoodyoor
forge build --force --offline
```

Solc compiled 86 files successfully in 526.36 seconds. All eight candidate source hashes, creation-bytecode hashes, and runtime-template hashes stayed identical. The whole JSON artifact checksums did not:

| Contract | Frozen artifact SHA-256 | Rebuilt artifact SHA-256 | Creation/runtime bytes |
| --- | --- | --- | --- |
| `DroidAccountV1` | `09328148…693e` | `ee1a9394…890` | unchanged |
| `DroidAccountRegistry` | `50876db0…5e6e` | `9bf0de52…619b` | unchanged |
| `HoodYoorRewardsDistributor` | `a5b33717…76bc` | `a2b95aa1…ce56` | unchanged |
| `HoodYoorRevenueVault` | `9a947708…21fa` | `082a80d9…cab7` | unchanged |
| `HoodYoorStrategyRegistry` | `ac3ca48f…e4f0` | `32da66a7…d45c` | unchanged |
| `HoodYoorAchievementRegistry` | `53f1ccb7…cec2` | `0a2d2b76…805b` | unchanged |

`HoodYoorDroidRegistry` and `HoodYoorAssetRegistry` retained their whole-artifact hashes. The mismatch may be artifact-container/build-metadata drift, but that explanation has not been independently established. The release rule freezes the artifact files as well as executable bytes, so the correct result is:

> **ARTIFACT FREEZE BROKEN**

No old review or approval may be attached to the rebuilt files. The prior manifests remain unchanged as evidence; this pass does not silently replace their hashes.

## Audit status

Independent audit status for all three Monad candidates and all six Robinhood economic modules is `NOT STARTED`. The updated three-allocation `HoodYoorRevenueVault` specifically requires independent review. Any critical or high finding blocks authorization; any bytecode-changing fix requires a new artifact hash, clean rebuild, retest, and new approval.

## Required remediation

1. Review and deliberately stage the complete production scope without absorbing unrelated user work.
2. Create a clean release commit.
3. Rebuild twice from that exact commit with the pinned toolchain.
4. explain or eliminate the whole-artifact JSON drift.
5. Freeze new source, ABI, creation, runtime, and artifact-file hashes.
6. Send those exact hashes for independent review.

Until all six steps pass, code approval and deployment authorization remain unavailable.
