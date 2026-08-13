import { getEnv } from "../src/config/env.js";
import { dyoorDiscordConfig } from "../config/dyoor-discord.js";
import { requiredBotPermissions } from "../src/discord/permissions.js";

const env = getEnv();
const url = new URL("https://discord.com/oauth2/authorize");
url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
url.searchParams.set("scope", "bot applications.commands");
url.searchParams.set("permissions", requiredBotPermissions(dyoorDiscordConfig).toString());
url.searchParams.set("integration_type", "0");
url.searchParams.set("guild_id", env.DISCORD_GUILD_ID);
url.searchParams.set("disable_guild_select", "true");

console.log("Official guild-install URL (contains no bot token):");
console.log(url.toString());
