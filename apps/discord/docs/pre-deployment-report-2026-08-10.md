# DYØØR Discord pre-deployment report

Status: **READ-ONLY INSPECTION COMPLETE — LIVE DEPLOYMENT NOT RUN**

Target guild: `DYOOR` (`1462783318004338837`)
Existing application/bot: `DYOOR Verification` (`1488722061038715101`)
Guild owner: `1164591872396775508`
Inspection date: 2026-08-10
Configuration snapshot: `../backups/discord/2026-08-10T152435Z.json`

The live server has not been modified. The local deploy command is interactive, fails closed on security prerequisites, requires the exact phrase `DEPLOY DYOOR TO 1462783318004338837`, and plans zero deletions.

## 1. Existing bot architecture

- The supplied token authenticates as the existing `DYOOR Verification` bot and matches application ID `1488722061038715101`.
- The live application currently has six guild commands: `/verify-request`, `/verify-confirm`, `/refresh`, `/status`, `/unlink`, and `/admin-refresh-user`.
- `/verify-confirm` asks the member to paste a wallet signature into Discord. This fails the security audit and will be replaced by a private browser signing flow.
- The application is public, has no interactions endpoint, has the Server Members intent disabled, and retains one old Netlify OAuth redirect URI.
- No local source implementing the current six-command bot was found in the DYØØR repositories inspected. The repository did contain legacy `netlify/functions/discord-*` endpoints.
- The legacy endpoints relied on unsigned/base64 browser state, accepted arbitrary wallet refresh input, supported one wallet, had no durable replay-safe nonce store, and only evaluated Season 1/Ascended tiers.
- Those unsafe local legacy routes now fail closed with HTTP 410. Nothing has been deployed to Netlify.
- The replacement is implemented locally in `apps/discord` and reuses the existing bot identity. It includes:
  - a config-driven Discord plan/audit/deploy system;
  - secure short-lived wallet sessions and SIWE-style signed messages;
  - single-use nonces bound to Discord user, guild, requested action, domain, URI, chain, issued-at, and expiry;
  - multi-wallet persistence and duplicate-wallet protection;
  - independent S1, Ascended, S2, and HoodYØØR evaluation;
  - role-specific overrides, RPC-safe revalidation, and a 24-hour/two-confirmation removal grace period;
  - private tickets, moderation commands, native AutoMod configuration, anti-raid controls, and audit logs;
  - validated/deduplicated S1 and S2 sales posting.

## 2. Existing role list

The server currently has 49 roles. The exact name, ID, position, permission bitfield, color, managed state, and tags for every role are preserved in the configuration snapshot.

| Purpose        | Existing role      | ID                    | Position | Result                         |
| -------------- | ------------------ | --------------------- | -------: | ------------------------------ |
| Bot            | DYOOR Verification | `1488862373727961180` |       35 | Reused; permissions incomplete |
| Founder        | DYOOR FOUNDER      | `1464219213064306792` |       45 | Protected above bot            |
| Admin          | Admin              | `1463876628190068736` |       37 | Protected above bot            |
| Moderator      | DYOOR Mod          | `1463876628747784212` |       36 | Protected above bot            |
| Staff          | DYOOR STAFF        | `1463876618903752889` |       33 | **Unsafe below bot**           |
| Basic verified | DYOORyfied         | `1463877305171710063` |       18 | Reuse                          |
| Season 1       | DYOOR HODLER       | `1463876633743200342` |       21 | Reuse                          |
| Ascended       | Ascended           | `1463876629544701992` |       34 | Reuse                          |
| Season 2       | —                  | —                     |        — | Create `Season 2 Holder`       |
| HoodYØØR       | —                  | —                     |        — | Create `HoodYØØR`              |

Other current roles, including tiers, bots, separators, cosmetics, and legacy roles, are classified as `UNMANAGED` and will not be deleted or edited automatically. Two privileged roles below the bot are unsafe: `Dyoor-Verify` and `D.Y.O.O.R Xtraordinaire` each have Kick, Ban, Moderate, Manage Messages, and Mention Everyone.

Third-party bots with Administrator-level access were found: Verifier, Rumble Royale, GarticBOT, Invite Tracker, NFT Whitelist Wallet Bot, MEE6, Collab.Land, and UndeadDancer. This is an audit warning only; the deployment does not remove them.

## 3. Existing channel/category structure

The server currently has 31 channels: 8 categories, 19 text channels, 3 voice channels, and 1 forum. The full ID/position/parent/overwrite inventory is in the snapshot.

- Start area: existing DYØØR category with rules, official links, major/minor announcements, and raids; welcome and verify are currently uncategorized.
- Lounge: `gdyoor`, `general-chat`, current private `dyoor-holders`, and voice channels.
- Support: existing Ticket Tool panel plus Open Tickets and Closed Tickets categories.
- Team Only: team chat, team voice, and game-development forum.
- Sales: `sales-listings` is uncategorized and currently inherits public view/write access.
- Bocto: hub and alerts.

Current entry permissions are reversed: welcome, rules, and official links are hidden from new members, while `#verify` is visible. The plan corrects the funnel without deleting channels.

## 4. Existing holder verification

- Current verification is split between legacy DYØØR Netlify endpoints, stale/external bot commands, and an external Verifier presence in `#verify`.
- It does not safely provide S2 or HoodYØØR role sync, multi-wallet aggregation, duplicate-wallet controls, durable nonces, replay prevention, a holder-loss grace period, or fail-safe RPC behavior.
- The replacement evaluator returns independent flags for `dyoorified`, `season1Holder`, `ascended`, `season2Holder`, and `hoodYoorHolder`; no holder roles are mutually exclusive.
- An RPC error never becomes a zero balance and cannot remove a role. Only successful authoritative reads can start removal; removal requires a second successful zero after the configurable grace period.

## 5. Existing Season 1 contract

- Address: `0x2C79c9E233fEa4b4DcFE6561D9209dc292cD932f`
- Chain: Monad Mainnet (`143`)
- Validated: deployed bytecode, ERC-721 `balanceOf`, name `DYOOR`, symbol `DYOOR`
- Qualification: aggregate `balanceOf(wallet) > 0` across every linked wallet
- Discord role: reuse `DYOOR HODLER`

## 6. Existing Ascension source

- Address: `0xf9611226c1CcCcCa37951938d6f358D3d5106549`
- Chain: Monad Mainnet (`143`)
- Validated: deployed bytecode and authoritative staking reads
- Qualification: current `tokensOfStaker(wallet).length > 0` (with `stakedBalance` available as the established staking source)
- Ascended is evaluated independently from S1 ownership.
- Discord role: reuse `Ascended`

## 7. Verified Season 2 contract

- Address: `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A`
- Chain: Monad Mainnet (`143`)
- Validated: deployed bytecode, ERC-721 `balanceOf`, name `D.Y.O.O.R`, symbol `DYOOR`
- Qualification: aggregate `balanceOf(wallet) > 0`
- Discord role: create `Season 2 Holder`

## 8. Verified HoodYØØR contract

- Address: `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25`
- Actual chain: **Robinhood Chain (`4663`)**, not Monad
- Validated: deployed bytecode, ERC-721 `balanceOf`, name `HoodYØØR`, symbol `HOOD`
- Qualification: aggregate `balanceOf(wallet) > 0`
- Discord role: create `HoodYØØR`
- HoodYØØR sales are not added to the sales feed.

## 9. Proposed DYØØRified role

Reuse the established `DYOORyfied` role (`1463877305171710063`); no duplicate role is created. It remains a zero-privilege access role and is preserved after a member sells all NFTs.

## 10. Proposed Waiting Room permissions

Rename/reuse `#💬「✦-general-chat-✦」` (`1462783319979593752`) as `#waiting-room`.

- `@everyone`: deny View Channel
- `DYOORyfied` and every holder role: view, history, chat, reactions, safe attachments/embeds, and threads
- authorized staff and bot: view/write
- slowmode: 3 seconds
- managed welcome/wallet-sync panel: one tracked message, edited rather than duplicated

## 11. Proposed S1 + Ascended combined chat

Reuse `#🔐「✦-dyoor-holders-✦」` (`1475482197413728367`). Direct role overwrites implement OR logic:

- `DYOOR HODLER`: view/write
- `Ascended`: view/write
- either role is sufficient; no redundant combined role
- `@everyone`: deny View Channel
- authorized staff and bot: view/write
- slowmode: 3 seconds

## 12. Proposed Season 2 holder chat

Create `#season-2-holders` in the existing Lounge category.

- `Season 2 Holder`: view/write
- authorized staff and bot: view/write
- `@everyone`, DYØØRified-only, S1-only, Ascended-only, and Hood-only members: no access unless they also hold S2
- slowmode: 3 seconds

## 13. Proposed HoodYØØR channel

Create `#hoodyoor` in the existing Lounge category.

- `HoodYØØR`: view/write
- authorized staff and bot: view/write
- `@everyone` and unrelated roles: no access
- slowmode: 3 seconds

## 14. Exact sales-channel modifications

Reuse `#sales-listings` (`1475119645743648789`); no new sales channel.

- Move it into the existing DYØØR/start category.
- Deny `@everyone` view access; allow DYØØRified/holder roles read-only access; bot/staff may post.
- Preserve Season 1 and add Season 2.
- Label posts `SEASON 1 SALE` or `SEASON 2 SALE`.
- Validate chain, configured contract, transaction receipt, token ID, seller, buyer, and matching ERC-721 Transfer log before posting.
- Deduplicate on chain ID + transaction hash + log index + contract + token ID.
- Include price, marketplace when known, transaction link, and reliable image metadata.
- Current Bocto sales posts appear blank/broken; the new feed does not trust or repost those messages.

## 15. Exact role changes

- Create `Season 2 Holder` with zero server permissions, hoisted, non-mentionable.
- Create `HoodYØØR` with zero server permissions, hoisted, non-mentionable.
- Reuse `DYOORyfied`, `DYOOR HODLER`, and `Ascended`.
- Move `DYOOR STAFF` above the bot before deployment.
- Move or de-privilege `Dyoor-Verify` and `D.Y.O.O.R Xtraordinaire` so a compromised bot cannot control privileged roles.
- Do not alter unrelated cosmetic, tier, staff, or third-party roles automatically.

## 16. Exact permission changes

- Make welcome, rules, and official links visible/read-only to new members.
- Keep `#verify` visible/read-only to unverified users and hide it after DYØØRified/holder access is assigned.
- Keep announcements and sales private to DYØØRified/holder roles and staff; read-only for members.
- Convert general chat to the DYØØRified `#waiting-room`.
- Add direct OR access for S1/Ascended to the existing holder chat.
- Add isolated S2 and HoodYØØR holder-channel overwrites.
- Keep the ticket panel DYØØRified/holder-visible and member read-only.
- Restrict staff chat and five new log channels to configured staff and the bot.
- Create no delete operations; unknown overwrites/resources stay unmanaged.

## 17. Security findings

Critical/blocking findings:

1. Server Members privileged intent is disabled.
2. Moderator 2FA requirement is disabled (`mfa_level = 0`).
3. Bot permission set is incomplete.
4. `DYOOR STAFF` is below the bot.
5. Two privileged roles are manageable by the bot.
6. Bot cannot inspect/manage AutoMod with its current permissions.
7. Current `/verify-confirm` asks users to paste signatures into Discord.
8. Welcome/rules/official-links entry access is incorrect.
9. Sales channel is publicly visible/writable through inherited permissions.
10. Required S2/Hood roles, holder channels, and security/log channels do not exist.
11. The application is public and has a stale legacy redirect URI.
12. Eight third-party bots currently have Administrator-level access.

Positive findings:

- `@everyone` has no dangerous guild-level Administrator/Manage/Kick/Ban/Mention permissions.
- The DYØØR bot does not have Administrator.
- Founder, Admin, and Mod roles are above the bot.
- Community mode, verification level 2, and explicit media filter level 2 are enabled.
- Existing S1/Ascended holder roles have no moderation/admin permissions.
- The bot token is ignored by Git and the local `.env.local` mode was tightened to owner-only (`0600`).

## 18. Security fixes implemented locally

- Signed, short-lived, single-use wallet verification; no transaction, approval, transfer, or payment.
- Server-side verification-session binding; no trusted `?discordUserId=` input.
- Multiple wallets per Discord ID and one-Discord-account-per-wallet enforcement.
- Centralized role evaluator and granular role sync.
- RPC error/confirmed-zero separation plus safe removal grace period.
- Configured role-only management; unrelated roles are untouched.
- Server-side command authorization and audit logging.
- Private holder-status responses and private ticket channels.
- Ticket safety warnings that staff never need wallet secrets.
- Native wallet-safety, invite-review, mention-protection, and spam AutoMod plans.
- `/raidmode enable|disable|status` without automatic mass bans.
- Central contract/sales registry; no repeated hard-coded addresses throughout services.
- Receipt validation and durable sale-event deduplication.
- Managed-message IDs so panels are edited instead of duplicated.
- Pre-mutation snapshot, idempotent plan, explicit confirmation phrase, post-deploy verification, and zero automatic deletions.

## 19. Bot permission findings

Current bot role permissions are insufficient. The least-privilege production set is:

- Manage Server (required for native AutoMod configuration)
- Manage Roles
- Manage Channels
- View Channels / Read Message History / Send Messages
- Manage Messages / Embed Links / Attach Files
- Kick / Ban / Moderate Members
- Manage Threads
- Use Application Commands

Explicitly excluded: Administrator, Manage Webhooks, and Mention Everyone.

The generated existing-bot install URL requests only the configured permission bitfield and is locked to guild `1462783318004338837`. It does not contain the bot token.

## 20. `npm run discord:plan` output

```text
Target: DYOOR (1462783318004338837)
FAIL PERMISSIONS: DYOOR Verification — missing required permission bitfield 1116691505206
CREATE ROLE: Season 2 Holder
CREATE ROLE: HoodYØØR
FAIL ROLE: DYOOR STAFF — staff role must be above bot; staff 33, bot 35
FAIL ROLE: Dyoor-Verify — privileged role is manageable by bot: KickMembers, BanMembers, ModerateMembers, ManageMessages, MentionEveryone
FAIL ROLE: D.Y.O.O.R Xtraordinaire — privileged role is manageable by bot: KickMembers, BanMembers, ModerateMembers, ManageMessages, MentionEveryone
UPDATE CHANNEL: #👋-welcome — category placement, topic, permission overwrites after role creation
UPDATE CHANNEL: #👮「✦-rules-✦」 — topic, permission overwrites after role creation
UPDATE CHANNEL: #🔗「✦-official-links-✦」 — topic, permission overwrites after role creation
UPDATE CHANNEL: #🔐verify — category placement, topic, permission overwrites after role creation
UPDATE CHANNEL: #📢「✦-major-announcements-✦」 — topic, permission overwrites after role creation
UPDATE CHANNEL: #sales-listings — category placement, topic, permission overwrites after role creation
UPDATE CHANNEL: #💬「✦-general-chat-✦」 — name → waiting-room, topic, slowmode, permission overwrites after role creation
UPDATE CHANNEL: #🔐「✦-dyoor-holders-✦」 — topic, slowmode, permission overwrites after role creation
CREATE CHANNEL: #season-2-holders — Lounge; season2-chat
CREATE CHANNEL: #hoodyoor — Lounge; hoodyoor-chat
UPDATE CHANNEL: #🎟️「✦-create-a-ticket-✦」 — topic, permission overwrites after role creation
UPDATE CHANNEL: #👩‍🔧「✦-team-chat-✦」 — permission overwrites after role creation
CREATE CHANNEL: #verification-log — Team Only; staff-readonly
CREATE CHANNEL: #moderation-log — Team Only; staff-readonly
CREATE CHANNEL: #ticket-log — Team Only; staff-readonly
CREATE CHANNEL: #bot-log — Team Only; staff-readonly
CREATE CHANNEL: #security-alerts — Team Only; staff-readonly
FAIL SERVER: Moderator 2FA — not required; enable before deployment
FAIL SERVER: Server Members intent — enable in the existing bot application before deployment
WARN SERVER: Webhooks inspection — Missing Permissions
WARN SERVER: Integrations inspection — Missing Permissions
FAIL SERVER: AutoMod inspection — Missing Permissions
CREATE MESSAGE: welcome-panel — #welcome
CREATE MESSAGE: rules-panel — #rules
CREATE MESSAGE: waiting-room-panel — #waiting-room
CREATE MESSAGE: ticket-panel — #open-a-ticket
CREATE MESSAGE: security-panel — #official-links
CREATE AUTOMOD: DYØØR · Wallet safety
CREATE AUTOMOD: DYØØR · Invite review
CREATE AUTOMOD: DYØØR · Mention protection
CREATE AUTOMOD: DYØØR · Spam protection
UPDATE COMMANDS: DYØØR guild slash commands — 26 commands

Creates: 18
Updates: 11
Unchanged: 12
Deletes: 0
Unmanaged: 43
Warnings: 2
Failures: 7
```

## Validation results

- Contract/RPC validation: all four holder modules passed; Monad `143` and Robinhood Chain `4663` matched.
- Bot/guild/owner identity validation: passed.
- Database migration/query: passed.
- Repository tests: 176 passed.
- Discord service tests: 38 passed across 10 files.
- Root TypeScript, lint, and production build: passed.
- Discord TypeScript, lint, formatting, tests, and build: passed.
- Live Discord audit: 46 pass, 5 warn, 26 fail before deployment; failures match current missing resources and security prerequisites.
- Deployment status: **not run**.

## Remaining environment prerequisites

Present: `DISCORD_BOT_TOKEN`, `OPENSEA_API_KEY`.
Still required before runtime/deployment: `SESSION_HMAC_SECRET` and the final HTTPS `VERIFICATION_BASE_URL`. Stable app/guild/owner IDs, public RPC fallbacks, database path, and sales-channel ID are already config-defined but may also be set explicitly in `.env.local`.

## Security-remediation update

Verified after the initial report:

- Server Members privileged intent enabled.
- `DYOOR STAFF`, `Dyoor-Verify`, and `D.Y.O.O.R Xtraordinaire` moved above the bot.
- Existing bot reauthorized with the least-privilege production permission set; Administrator remains excluded.
- Moderator 2FA requirement enabled.
- Existing `Block Mention Spam` AutoMod rule adopted as the managed mention-protection rule; its stable Discord resource is preserved.
- Latest read-only plan: 17 creates, 11 updates, 16 unchanged, 45 unmanaged, 2 warnings, **0 failures, 0 deletions**.

Railway was approved as the hosting direction. The local production package is documented in `railway-production-setup.md`; no Railway service and no live Discord deployment had been created at the time of this update.
