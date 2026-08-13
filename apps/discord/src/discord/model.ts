export type RoleKey = "dyoorified" | "season1" | "ascended" | "season2" | "hoodyoor";

export type HolderRoleKey = Exclude<RoleKey, "dyoorified">;

export type StaffRoleKey = "founder" | "admin" | "moderator" | "staff";

export type AccessPolicy =
  | "entry-readonly"
  | "entry-verification"
  | "dyoorified-readonly"
  | "dyoorified-chat"
  | "season1-ascended-chat"
  | "season2-chat"
  | "hoodyoor-chat"
  | "sales-readonly"
  | "ticket-panel"
  | "staff-chat"
  | "staff-readonly";

export interface DesiredRole {
  key: RoleKey;
  name: string;
  existingId?: string;
  aliases?: readonly string[];
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: bigint;
}

export interface ReferencedStaffRole {
  key: StaffRoleKey;
  name: string;
  existingId: string;
}

export type ManagedPanelKey =
  "welcome" | "rules" | "wallet-verification" | "waiting-room" | "tickets" | "security";

export interface DesiredChannel {
  key: string;
  name: string;
  existingId?: string;
  aliases?: readonly string[];
  type: "text" | "voice";
  topic?: string;
  slowmodeSeconds?: number;
  access: AccessPolicy;
  panel?: ManagedPanelKey;
}

export interface DesiredCategory {
  key: string;
  name: string;
  existingId?: string;
  aliases?: readonly string[];
  channels: readonly DesiredChannel[];
}

export interface DesiredAutomodRule {
  key: string;
  name: string;
  kind: "keyword" | "spam" | "mention-spam";
  keywords?: readonly string[];
  mentionLimit?: number;
  blockMessage: string;
}

export interface DesiredScheduledEvent {
  key: string;
  name: string;
  description: string;
  startAt: string;
  endAt: string;
  location: string;
}

export interface ChainDefinition {
  key: "monad" | "robinhood";
  name: string;
  id: number;
  currency: string;
  explorer: string;
  defaultRpcUrl: string;
  rpcEnvKey: "MONAD_RPC_URL" | "ROBINHOOD_RPC_URL";
}

export interface ContractDefinition {
  key: HolderRoleKey;
  label: string;
  chainKey: ChainDefinition["key"];
  address: `0x${string}`;
  standard: "ERC721" | "ASCENSION";
  expectedName?: string;
  expectedSymbol?: string;
  ownershipMethod: "balanceOf" | "tokensOfStaker";
}

export interface SalesCollectionDefinition {
  key: "season1" | "season2";
  label: string;
  chainKey: "monad";
  address: `0x${string}`;
}

export interface ProjectConfig {
  name: string;
  description: string;
  expected: {
    applicationId: string;
    guildId: string;
    ownerId: string;
    guildName: string;
  };
  roles: readonly DesiredRole[];
  staffRoles: readonly ReferencedStaffRole[];
  categories: readonly DesiredCategory[];
  chains: readonly ChainDefinition[];
  contracts: readonly ContractDefinition[];
  salesCollections: readonly SalesCollectionDefinition[];
  scheduledEvents: readonly DesiredScheduledEvent[];
  automodRules: readonly DesiredAutomodRule[];
  sync: {
    recheckIntervalHours: number;
    gracePeriodHours: number;
    concurrency: number;
    rpcTimeoutMs: number;
  };
  officialDomains: readonly string[];
  copy: {
    welcome: { title: string; body: string };
    rules: { title: string; rules: readonly string[] };
    waitingRoom: { title: string; body: string };
    security: { title: string; body: string };
  };
}
