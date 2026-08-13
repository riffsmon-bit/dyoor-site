# Release Change Classification

The mixed authoring worktree was inspected before creating the release source commit. The machine-readable inventory is `deployments/release-freeze/worktree-classification.json`.

The inventory covered 1,098 changed paths against base commit `e498144f033ef3c302a2bab73225552d290fd033`:

| Classification | Disposition | Files |
|---|---:|---:|
| REQUIRED FOR RELEASE | include | 228 |
| DOCUMENTATION ONLY | include | 39 |
| GENERATED | include | 321 |
| UNRELATED | include and mark outside contract-audit scope | 205 |
| LOCAL/DEVELOPER | exclude and preserve in authoring worktree | 251 |
| SHOULD NOT SHIP | exclude and preserve in authoring worktree | 54 |

The counts describe the initial classification snapshot. Remediation source, tests, and release documents created after that snapshot are release-required additions.

## Included

- Droid Account and economic contract source, interfaces, tests, and Foundry configuration;
- shared/Monad/Robinhood frontend and API integration;
- keyless release tooling and sentinels;
- deterministic on-chain art payloads, launch manifests, required local trait layers, and live deployment evidence;
- release/readiness/security documentation;
- existing game and Discord work so the repository remains complete and those requested suites can be validated. Those applications are explicitly outside the smart-contract audit scope.

## Excluded without deletion

- airdrop execution logs and wallet-list exports;
- Energy reconciliation operation reports;
- local launchd configuration;
- duplicated generated security-review bundle and tar archive;
- `.DS_Store` files;
- generated Robinhood previews, intermediate generations, pixel-pilot working output, and source-art workspace copies;
- unrelated report exports.

These files remain untouched in the original authoring worktree. They are absent from the clean release commit by selection, not by hiding, deleting, or rewriting them.

## Release cleanliness meaning

The original authoring checkout remains a preservation workspace. The release branch is created from an exact selected tree and is verified in a separate Git worktree with `git status --porcelain=v1 --untracked-files=all` empty. This prevents unrelated local state from being presented as part of the audit candidate while retaining every excluded file for owner review.
