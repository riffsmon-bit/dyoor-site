# Release Environment Separation

HoodYØØR release verification is a keyless, read-only workflow. It is deliberately separate from development and any later authorized broadcast workflow.

## Modes

| Mode | Local environment files | Signing variables | Network | Broadcast |
|---|---|---|---|---|
| Development | allowed by explicit developer command | permitted when needed | optional | command-specific |
| Test | not required | absent for release tests | local only unless a named fork test | false |
| Read-only preflight | prohibited in the clean release worktree | absent | public RPC reads | impossible |
| Deployment simulation | prohibited | absent; use public `DEPLOYER_ADDRESS` / `HOODYOOR_DEPLOYER_ADDRESS` | public RPC or fork | false |
| Production broadcast | outside this package | separately injected after authorization | approved mainnet RPC | requires a separate explicit process |

`scripts/run-keyless-release-command.js` constructs a child environment from a small public allowlist. It never copies signing-variable names. It refuses `--broadcast`, `--private-key`, and `--mnemonic`, sets `BROADCAST=0`, and forces all financial/autonomy feature flags off.

It also refuses to run if the release worktree contains `.env`, `.env.local`, production env files, or the private HoodYØØR launch environment. This is why release tests and Next production builds run from the isolated clean worktree rather than the mixed developer checkout.

Hardhat no longer imports `dotenv/config`. Values must be injected explicitly by the caller. Next’s CLI still probes conventional environment filenames by design; the keyless wrapper and clean worktree ensure those files do not exist, while the Node preload sentinel blocks any attempted content read.

## Public configuration

Public release inputs may include:

- `MONAD_RPC_URL`, `MONAD_DROID_RPC_URL`, or `DYOOR_S2_RPC_URL`;
- `HOODYOOR_RPC_URL`, `HOODYOOR_DROID_RPC_URL`, or `ROBINHOOD_RPC_URL`;
- `DEPLOYER_ADDRESS` or `HOODYOOR_DEPLOYER_ADDRESS` for address-only simulation;
- system process paths and temporary-directory settings.

No private key is needed to estimate gas, derive constructor payloads, inspect live contracts, verify artifacts, run a fork, or build the frontend.

## Secret deployment configuration

Signing material is intentionally excluded from this release package. Variables such as `DEPLOYER_PRIVATE_KEY`, `HOODYOOR_DEPLOYER_PRIVATE_KEY`, `HOODYOOR_DROID_DEPLOYER_PRIVATE_KEY`, mnemonics, relayer keys, result-signer keys, and Energy operator keys must be absent during verification.

The future deployment process must be separately approved and must not reuse the keyless verifier as a broadcast tool.

Historical launch artifacts are rebuilt by `scripts/build-legacy-launch-contracts.js`. It runs both required Foundry compiler contexts in keyless child environments, writes no transaction payload, and has no broadcast path. The older six-contract launch uses the `legacy-launch` profile with an empty remapping list; SeaDrop v2 uses the complete default source context. This preserves the original whole-artifact freezes without exposing signing material.

## Prior incident and remediation

During the blocked authorization pass, the legacy Robinhood preflight called `loadHoodyoorLocalEnvironment()`. It read the local environment and instantiated an unconnected wallet solely to derive an address. No key was printed, no provider was attached, and no transaction was signed or broadcast. Nevertheless, reading signing material for a read-only check violated the release boundary.

Remediation:

- legacy preflight no longer loads local environment files;
- deployer identity for simulations is an explicit public address;
- private reveal backup contents are not read by keyless preflight;
- all release preflights assert the read-only environment;
- the secret-access sentinel blocks environment-file contents;
- automated tests prove a signing variable is rejected without dereferencing its value;
- Hardhat’s implicit dotenv load was removed;
- Next/Node validation runs through the keyless wrapper in a clean worktree.

The development/broadcast scripts that intentionally handle keys remain outside the release-verification command graph and are not executed by this package.
