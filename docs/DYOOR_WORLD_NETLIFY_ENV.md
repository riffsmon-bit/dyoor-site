# dYOOR World Netlify environment

Use Netlify **Project configuration → Environment variables**. Apply server
secrets to Functions/runtime. Apply `NEXT_PUBLIC_*` values to Builds as well.
On a Netlify plan that does not support granular scopes, use all scopes and keep
secret values marked as secret.

Set production values in the Production context. Repeat the required values in
Deploy Preview only when a preview should exercise the live World systems.

## Required for holder access

| Variable | Scope | Source |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Builds | Privy dashboard → Apps → the D.Y.O.O.R web app. Add `https://dyoor.netlify.app` and each intentionally tested preview origin to Privy’s allowed origins. |
| `DYOOR_WORLD_SESSION_SECRET` | Secret, Functions/runtime | Generate one stable 32-byte value locally with `openssl rand -hex 32`. Do not rotate it casually; rotation signs everyone out. |
| `ALCHEMY_MONAD_RPC_URL` | Secret, Functions/runtime | Alchemy dashboard → Monad Mainnet app → HTTPS endpoint. `DYOOR_S2_RPC_URL` or `MONAD_RPC_URL` can be used instead. |
| `NEXT_PUBLIC_MONAD_RPC_URL` | Builds | A browser-safe Monad Mainnet RPC URL. Never place an admin-only RPC credential here. |

The production S2 collection, dYOOR name registry, trade escrow, Energy Bank,
chain ID, and explorer are code-pinned defaults. They do not need duplicate
Netlify variables unless a reviewed deployment intentionally replaces them.

## Persistent chat and image uploads

Netlify automatically supplies Blob runtime context to the deployed Next.js
site. Keep these existing values if this site already uses explicit Blob
credentials:

| Variable | Scope | Source |
| --- | --- | --- |
| `NETLIFY_BLOBS_SITE_ID` | Functions/runtime | Netlify project/site ID. |
| `NETLIFY_BLOBS_TOKEN` | Secret, Functions/runtime | A Netlify personal access token restricted to the account/site workflow. |

Do not expose either value with a `NEXT_PUBLIC_` prefix.

## Energy rewards

| Variable | Scope | Source |
| --- | --- | --- |
| `DYOOR_WORLD_REWARDS_ENABLED=true` | Functions/runtime | Feature flag after the operator preflight succeeds. |
| `ENERGY_BANK_OPERATOR_PRIVATE_KEY` | Secret, Functions/runtime | Private key for a dedicated low-balance operator wallet that has the required Energy Bank role. Do not use the owner/deployer wallet. |
| `DYOOR_WORLD_REWARD_SECRET` | Secret, Functions/runtime | Optional dedicated 32-byte secret. If omitted, a purpose-separated key is derived from `DYOOR_WORLD_SESSION_SECRET`. |
| `ENERGY_BANK_ADDRESS` | Functions/runtime | Optional explicit value. Production default: `0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767`. |

The operator key alone is not enough: its address must already have the
contract role expected by the Energy Bank. Never grant a role merely because a
key was pasted into Netlify.

## Sales, burns, and automation

| Variable | Scope | Source |
| --- | --- | --- |
| `DYOOR_WORLD_SALES_BOT_ENABLED=true` | Functions/runtime | Enables the verified OpenSea relay. |
| `OPENSEA_API_KEY` | Secret, Functions/runtime | OpenSea developer portal API key. |
| `DYOOR_WORLD_AUTOMATION_SECRET` | Secret, Functions/runtime | Optional dedicated 32-byte secret for scheduled automation. If omitted, a purpose-separated key is derived from the session secret. |

## Holder notifications

| Variable | Scope | Source |
| --- | --- | --- |
| `DYOOR_WORLD_PUSH_ENABLED=true` | Functions/runtime | Enables Web Push after the VAPID pair is installed. |
| `DYOOR_WORLD_VAPID_PUBLIC_KEY` | Functions/runtime | Stable public half of one VAPID pair. |
| `DYOOR_WORLD_VAPID_PRIVATE_KEY` | Secret, Functions/runtime | Matching private half of that VAPID pair. |
| `DYOOR_WORLD_VAPID_SUBJECT=https://dyoor.netlify.app` | Functions/runtime | Production site identity/contact URI. |

The repository can create or reuse a matching VAPID pair with:

```bash
npm run prepare:dyoor-world:push
```

That script writes ignored local environment files and does not print the
private key.

## Optional GIF search

| Variable | Scope | Source |
| --- | --- | --- |
| `KLIPY_API_KEY` | Secret, Functions/runtime | KLIPY Partner Panel → API Keys → Add Platform. |
| `DYOOR_WORLD_KLIPY_CLIENT_KEY=dyoor_world` | Functions/runtime | Stable integration identifier; this default is sufficient. |

The key stays server-side. The holder-only proxy rate-limits and caches search
results. KLIPY test keys are limited to 100 calls per hour; request production
access in its Partner Panel after testing.

## Optional owner override

`DYOOR_WORLD_OWNER_WALLET` is only needed when the announcements wallet should
differ from the owner returned by the S2 contract. Otherwise the app resolves
the owner directly on Monad.

## Never add to Netlify for World runtime

- deployer or owner private keys
- seed phrases
- bounty deployment/configuration flags
- local filesystem paths
- `DYOOR_WORLD_NAMES_START_BLOCK`
- `DYOOR_WORLD_NAMES_METADATA_BASE_URI`
- `DYOOR_WORLD_OPEN_CLAIMS`
- a second copy of contract addresses unless a reviewed migration requires it
