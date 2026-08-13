# DYØØR Discord Railway production setup

This service runs the existing DYØØR bot application, secure wallet-verification website, holder revalidation, tickets, moderation commands, and validated sales feed in one persistent Railway service.

It does not create a second Discord application.

## Railway service configuration

Use these exact settings:

| Setting                   | Value                                                     |
| ------------------------- | --------------------------------------------------------- |
| Service name              | `dyoor-discord`                                           |
| Repository root directory | `/apps/discord`                                           |
| Config-as-code path       | `/apps/discord/railway.json`                              |
| Builder                   | Dockerfile, supplied by `railway.json`                    |
| Replicas                  | `1` — required for SQLite and one Discord gateway session |
| Health check              | `/health`                                                 |
| Restart policy            | Always                                                    |
| Public networking         | Generate one Railway HTTPS domain                         |
| Volume                    | One persistent volume mounted at `/data`                  |

The deployment intentionally refuses to start without the `/data` volume. Railway provides `PORT`, `RAILWAY_PUBLIC_DOMAIN`, and `RAILWAY_VOLUME_MOUNT_PATH`; the app uses them to bind the HTTP server, build `https://<domain>/verify`, and store SQLite at `/data/dyoor-discord.db`.

## Required Railway variables

Add these in the service Variables tab. Never paste secret values into chat or commit them.

```dotenv
NODE_ENV=production
DISCORD_BOT_TOKEN=<existing-DYOOR-bot-token>
DISCORD_CLIENT_ID=1488722061038715101
DISCORD_GUILD_ID=1462783318004338837
DISCORD_OWNER_ID=1164591872396775508
SESSION_HMAC_SECRET=<at-least-32-random-characters>
OPENSEA_API_KEY=<existing-OpenSea-key>
WEBSITE_URL=https://dyoor.xyz
MONAD_RPC_URL=https://rpc.monad.xyz
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
SALES_CHANNEL_ID=1475119645743648789
```

Generate `SESSION_HMAC_SECRET` directly in a private terminal or Railway variable field. One safe local command is:

```sh
openssl rand -hex 32
```

Seal `DISCORD_BOT_TOKEN`, `SESSION_HMAC_SECRET`, and `OPENSEA_API_KEY` after saving them in Railway. Do not set `VERIFICATION_BASE_URL`, `DATABASE_PATH`, `HTTP_HOST`, or `HTTP_PORT` on Railway unless intentionally overriding the safe Railway-derived values.

Optional variables:

```dotenv
X_URL=
MARKETPLACE_URL=
LOG_LEVEL=info
HOLDER_RECHECK_INTERVAL_HOURS=6
HOLDER_GRACE_PERIOD_HOURS=24
HOLDER_SYNC_CONCURRENCY=4
RPC_TIMEOUT_MS=10000
SALES_POLL_INTERVAL_SECONDS=120
```

## Production validation order

1. Create the Railway project and `dyoor-discord` service.
2. Configure root directory and config-as-code path.
3. Attach the `/data` volume before deployment.
4. Add and seal variables.
5. Generate the Railway HTTPS domain.
6. Deploy the service and require `/health` to return HTTP 200.
7. Confirm the logs show the expected bot ID and guild ID without printing secrets.
8. Set the local `VERIFICATION_BASE_URL` to the generated Railway URL ending in `/verify` for the Discord provisioning plan.
9. Rerun `npm run holder:check`, `npm run discord:plan`, and `npm run discord:audit`.
10. Only after an explicit owner approval, run the interactive `npm run discord:deploy` command.

The Discord deployment and the Railway service deployment are intentionally separate approvals.
