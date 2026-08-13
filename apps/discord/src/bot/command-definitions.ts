import { SlashCommandBuilder, type SlashCommandOptionsOnlyBuilder } from "discord.js";

const userOption = (builder: SlashCommandBuilder, required = true) =>
  builder.addUserOption((option) =>
    option.setName("user").setDescription("Discord member").setRequired(required),
  );

const reasonOption = (builder: SlashCommandOptionsOnlyBuilder) =>
  builder.addStringOption((option) =>
    option.setName("reason").setDescription("Audit reason").setRequired(true).setMaxLength(500),
  );

export const commandDefinitions = [
  new SlashCommandBuilder().setName("help").setDescription("Show DYØØR bot help"),
  new SlashCommandBuilder().setName("serverstatus").setDescription("Show bot and service status"),
  userOption(
    new SlashCommandBuilder().setName("userinfo").setDescription("Show safe member information"),
    false,
  ),
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Create a private wallet verification link"),
  new SlashCommandBuilder()
    .setName("reverify")
    .setDescription("Link another wallet or reverify roles"),
  new SlashCommandBuilder()
    .setName("verify-status")
    .setDescription("Show your basic DYØØR verification state"),
  new SlashCommandBuilder()
    .setName("holder-status")
    .setDescription("Privately show all linked-wallet holder roles"),
  new SlashCommandBuilder()
    .setName("role-sync")
    .setDescription("Recheck your linked wallets and synchronize your roles"),
  reasonOption(
    userOption(new SlashCommandBuilder().setName("warn").setDescription("Record a warning")),
  ),
  userOption(new SlashCommandBuilder().setName("warnings").setDescription("List active warnings")),
  reasonOption(
    userOption(
      new SlashCommandBuilder().setName("timeout").setDescription("Temporarily timeout a member"),
    ).addIntegerOption((option) =>
      option
        .setName("minutes")
        .setDescription("1-40320 minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320),
    ),
  ),
  userOption(new SlashCommandBuilder().setName("untimeout").setDescription("Remove a timeout")),
  reasonOption(
    userOption(new SlashCommandBuilder().setName("kick").setDescription("Kick a member")),
  ),
  reasonOption(
    userOption(new SlashCommandBuilder().setName("ban").setDescription("Ban a member")),
  ).addIntegerOption((option) =>
    option
      .setName("delete_days")
      .setDescription("Delete 0-7 days of messages")
      .setMinValue(0)
      .setMaxValue(7),
  ),
  reasonOption(
    new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Unban a Discord user ID")
      .addStringOption((option) =>
        option
          .setName("user_id")
          .setDescription("Numeric Discord User ID")
          .setRequired(true)
          .setMinLength(17)
          .setMaxLength(20),
      ),
  ),
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set text-channel slowmode")
    .addChannelOption((option) =>
      option.setName("channel").setDescription("Text channel").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("seconds")
        .setDescription("0-21600 seconds")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21_600),
    ),
  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Temporarily lock a text channel")
    .addChannelOption((option) =>
      option.setName("channel").setDescription("Text channel").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Restore a managed text-channel lock")
    .addChannelOption((option) =>
      option.setName("channel").setDescription("Text channel").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk-delete recent messages")
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setDescription("1-100")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),
  new SlashCommandBuilder()
    .setName("raidmode")
    .setDescription("Control reversible anti-raid restrictions")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Raid mode action")
        .setRequired(true)
        .addChoices(
          { name: "Enable", value: "enable" },
          { name: "Disable", value: "disable" },
          { name: "Status", value: "status" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("permission-audit")
    .setDescription("Audit dangerous server permissions"),
  new SlashCommandBuilder()
    .setName("server-audit")
    .setDescription("Run the DYØØR Discord configuration audit"),
  userOption(
    new SlashCommandBuilder()
      .setName("sync-user")
      .setDescription("Admin: recheck and sync one user"),
  ),
  new SlashCommandBuilder()
    .setName("sync-all")
    .setDescription("Admin: recheck and sync all due linked wallets"),
  new SlashCommandBuilder()
    .setName("holder")
    .setDescription("Protected holder administration")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("lookup")
        .setDescription("Look up private verification state")
        .addUserOption((option) =>
          option.setName("user").setDescription("Discord member").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("refresh")
        .setDescription("Refresh a member's linked-wallet ownership")
        .addUserOption((option) =>
          option.setName("user").setDescription("Discord member").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unlink")
        .setDescription("Admin-assisted wallet unlink")
        .addStringOption((option) =>
          option.setName("wallet").setDescription("Linked wallet address").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Audit reason")
            .setRequired(true)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("override")
        .setDescription("Grant, deny, or clear one logged holder-role override")
        .addUserOption((option) =>
          option.setName("user").setDescription("Discord member").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("role")
            .setDescription("Holder entitlement")
            .setRequired(true)
            .addChoices(
              { name: "Season 1 Holder", value: "season1" },
              { name: "Ascended", value: "ascended" },
              { name: "Season 2 Holder", value: "season2" },
              { name: "HoodYØØR", value: "hoodyoor" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Override action")
            .setRequired(true)
            .addChoices(
              { name: "Grant", value: "grant" },
              { name: "Deny", value: "deny" },
              { name: "Clear", value: "clear" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Audit reason")
            .setRequired(true)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("stats").setDescription("Show verification-record statistics"),
    ),
  new SlashCommandBuilder()
    .setName("dyoor")
    .setDescription("Owner-only DYØØR operations")
    .addSubcommand((subcommand) =>
      subcommand.setName("setup-status").setDescription("Show setup status"),
    )
    .addSubcommand((subcommand) => subcommand.setName("audit").setDescription("Run server audit"))
    .addSubcommand((subcommand) =>
      subcommand.setName("backup").setDescription("Create a configuration snapshot"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("health").setDescription("Run contract health checks"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("deploy-status").setDescription("Show structural deployment drift"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("maintenance")
        .setDescription("Set or view verification maintenance mode")
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Maintenance action")
            .setRequired(true)
            .addChoices(
              { name: "Enable", value: "enable" },
              { name: "Disable", value: "disable" },
              { name: "Status", value: "status" },
            ),
        ),
    ),
] as const;

export const commandJson = commandDefinitions.map((command) => command.toJSON());
