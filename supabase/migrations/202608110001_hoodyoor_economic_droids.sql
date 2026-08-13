-- Additive index/cache schema for chain-qualified Economic Droids.
-- On-chain ownership, balances, vault accounting, roots, and claims remain authoritative.

create table if not exists public.droids (
  chain_id bigint not null check (chain_id > 0),
  collection_address text not null check (collection_address ~ '^0x[0-9a-f]{40}$'),
  token_id numeric(78, 0) not null check (token_id >= 0),
  droid_key text not null unique check (droid_key ~ '^0x[0-9a-f]{64}$'),
  native_chain_name text not null,
  cached_owner_address text check (cached_owner_address is null or cached_owner_address ~ '^0x[0-9a-f]{40}$'),
  owner_checked_block numeric(78, 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, collection_address, token_id)
);

create table if not exists public.droid_accounts (
  chain_id bigint not null,
  collection_address text not null,
  token_id numeric(78, 0) not null,
  account_version integer not null check (account_version > 0),
  account_address text not null check (account_address ~ '^0x[0-9a-f]{40}$'),
  resolver_address text not null check (resolver_address ~ '^0x[0-9a-f]{40}$'),
  active boolean not null default false,
  activated_block numeric(78, 0),
  activated_tx_hash text check (activated_tx_hash is null or activated_tx_hash ~ '^0x[0-9a-f]{64}$'),
  last_indexed_block numeric(78, 0),
  updated_at timestamptz not null default now(),
  primary key (chain_id, collection_address, token_id, account_version),
  foreign key (chain_id, collection_address, token_id)
    references public.droids(chain_id, collection_address, token_id) on delete cascade
);

create table if not exists public.approved_assets (
  chain_id bigint not null check (chain_id > 0),
  asset_address text not null check (asset_address ~ '^0x[0-9a-f]{40}$'),
  asset_type text not null check (asset_type in ('native', 'erc20')),
  symbol text not null,
  name text not null,
  decimals integer not null check (decimals between 0 and 36),
  enabled boolean not null default false,
  strategy_eligible boolean not null default false,
  router_supported boolean not null default false,
  metadata_uri text,
  registry_tx_hash text check (registry_tx_hash is null or registry_tx_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  primary key (chain_id, asset_address)
);

create table if not exists public.strategies (
  chain_id bigint not null check (chain_id > 0),
  strategy_id text not null check (strategy_id ~ '^0x[0-9a-f]{64}$'),
  version integer not null check (version > 0),
  enabled boolean not null default false,
  display_metadata_uri text,
  risk_metadata_uri text,
  execution_adapter text check (execution_adapter is null or execution_adapter ~ '^0x[0-9a-f]{40}$'),
  allocations jsonb not null default '[]'::jsonb,
  configured_tx_hash text check (configured_tx_hash is null or configured_tx_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (chain_id, strategy_id, version)
);

create table if not exists public.droid_strategies (
  chain_id bigint not null,
  collection_address text not null,
  token_id numeric(78, 0) not null,
  strategy_id text not null,
  strategy_version integer not null,
  selected_at timestamptz not null,
  selected_block numeric(78, 0),
  selected_tx_hash text check (selected_tx_hash is null or selected_tx_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  primary key (chain_id, collection_address, token_id),
  foreign key (chain_id, collection_address, token_id)
    references public.droids(chain_id, collection_address, token_id) on delete cascade,
  foreign key (chain_id, strategy_id, strategy_version)
    references public.strategies(chain_id, strategy_id, version)
);

create table if not exists public.reward_epochs (
  chain_id bigint not null check (chain_id > 0),
  epoch_id text not null check (epoch_id ~ '^0x[0-9a-f]{64}$'),
  distributor_address text not null check (distributor_address ~ '^0x[0-9a-f]{40}$'),
  asset_address text not null check (asset_address ~ '^0x[0-9a-f]{40}$'),
  merkle_root text not null check (merkle_root ~ '^0x[0-9a-f]{64}$'),
  manifest_hash text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  manifest_uri text,
  total_allocated numeric(78, 0) not null check (total_allocated > 0),
  total_claimed numeric(78, 0) not null default 0 check (total_claimed >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('prepared', 'open', 'closed', 'cancelled')),
  created_tx_hash text check (created_tx_hash is null or created_tx_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, epoch_id),
  check (ends_at > starts_at),
  check (total_claimed <= total_allocated)
);

create table if not exists public.reward_allocations (
  chain_id bigint not null,
  epoch_id text not null,
  collection_address text not null,
  token_id numeric(78, 0) not null,
  droid_key text not null check (droid_key ~ '^0x[0-9a-f]{64}$'),
  account_version integer not null check (account_version > 0),
  droid_account text not null check (droid_account ~ '^0x[0-9a-f]{40}$'),
  strategy_id text not null check (strategy_id ~ '^0x[0-9a-f]{64}$'),
  reward_weight numeric(78, 0) not null check (reward_weight >= 0),
  amount numeric(78, 0) not null check (amount > 0),
  merkle_leaf text not null check (merkle_leaf ~ '^0x[0-9a-f]{64}$'),
  merkle_proof jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (chain_id, epoch_id, droid_key),
  foreign key (chain_id, epoch_id)
    references public.reward_epochs(chain_id, epoch_id) on delete cascade,
  foreign key (chain_id, collection_address, token_id)
    references public.droids(chain_id, collection_address, token_id) on delete cascade
);

create table if not exists public.reward_claims (
  chain_id bigint not null,
  epoch_id text not null,
  droid_key text not null,
  claimant_address text not null check (claimant_address ~ '^0x[0-9a-f]{40}$'),
  droid_account text not null check (droid_account ~ '^0x[0-9a-f]{40}$'),
  asset_address text not null check (asset_address ~ '^0x[0-9a-f]{40}$'),
  amount numeric(78, 0) not null check (amount > 0),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number numeric(78, 0) not null,
  claimed_at timestamptz,
  indexed_at timestamptz not null default now(),
  primary key (chain_id, epoch_id, droid_key),
  unique (chain_id, tx_hash, log_index),
  foreign key (chain_id, epoch_id)
    references public.reward_epochs(chain_id, epoch_id) on delete cascade
);

create table if not exists public.revenue_events (
  chain_id bigint not null,
  vault_address text not null check (vault_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  revenue_id text not null check (revenue_id ~ '^0x[0-9a-f]{64}$'),
  source_address text not null check (source_address ~ '^0x[0-9a-f]{40}$'),
  asset_address text not null check (asset_address ~ '^0x[0-9a-f]{40}$'),
  gross_amount numeric(78, 0) not null check (gross_amount > 0),
  treasury_amount numeric(78, 0) not null check (treasury_amount >= 0),
  rewards_amount numeric(78, 0) not null check (rewards_amount >= 0),
  block_number numeric(78, 0) not null,
  indexed_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index),
  check (treasury_amount + rewards_amount = gross_amount)
);

create table if not exists public.achievements (
  chain_id bigint not null check (chain_id > 0),
  achievement_id text not null check (achievement_id ~ '^0x[0-9a-f]{64}$'),
  version integer not null check (version > 0),
  enabled boolean not null default false,
  reward_modifier_bps integer not null check (reward_modifier_bps between 0 and 500),
  metadata_uri text,
  updated_at timestamptz not null default now(),
  primary key (chain_id, achievement_id, version)
);

create table if not exists public.droid_achievements (
  chain_id bigint not null,
  collection_address text not null,
  token_id numeric(78, 0) not null,
  achievement_id text not null,
  achievement_version integer not null,
  evidence_hash text not null check (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  reward_modifier_bps integer not null check (reward_modifier_bps between 0 and 500),
  awarded_tx_hash text check (awarded_tx_hash is null or awarded_tx_hash ~ '^0x[0-9a-f]{64}$'),
  awarded_at timestamptz not null,
  primary key (chain_id, collection_address, token_id, achievement_id),
  foreign key (chain_id, collection_address, token_id)
    references public.droids(chain_id, collection_address, token_id) on delete cascade,
  foreign key (chain_id, achievement_id, achievement_version)
    references public.achievements(chain_id, achievement_id, version)
);

create table if not exists public.treasuries (
  chain_id bigint not null check (chain_id > 0),
  vault_address text not null check (vault_address ~ '^0x[0-9a-f]{40}$'),
  treasury_address text not null check (treasury_address ~ '^0x[0-9a-f]{40}$'),
  reward_distributor_address text not null check (reward_distributor_address ~ '^0x[0-9a-f]{40}$'),
  enabled boolean not null default false,
  last_indexed_block numeric(78, 0),
  updated_at timestamptz not null default now(),
  primary key (chain_id, vault_address)
);

create table if not exists public.treasury_balances (
  chain_id bigint not null,
  vault_address text not null,
  asset_address text not null check (asset_address ~ '^0x[0-9a-f]{40}$'),
  treasury_accrued numeric(78, 0) not null default 0,
  rewards_accrued numeric(78, 0) not null default 0,
  observed_balance numeric(78, 0) not null default 0,
  observed_block numeric(78, 0) not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, vault_address, asset_address),
  foreign key (chain_id, vault_address)
    references public.treasuries(chain_id, vault_address) on delete cascade
);

-- Record-only future abstraction. No bridge adapter or automatic bridge is enabled.
create table if not exists public.cross_chain_transfers (
  transfer_id text primary key,
  source_chain_id bigint not null,
  destination_chain_id bigint not null,
  source_vault_address text not null,
  destination_address text not null,
  asset_address text not null,
  amount numeric(78, 0) not null check (amount > 0),
  status text not null check (status in ('disabled', 'proposed', 'submitted', 'confirmed', 'failed')),
  source_tx_hash text,
  destination_tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_chain_id <> destination_chain_id)
);

create index if not exists idx_droids_cached_owner
  on public.droids (chain_id, lower(cached_owner_address));
create index if not exists idx_reward_allocations_droid
  on public.reward_allocations (chain_id, collection_address, token_id);
create index if not exists idx_reward_claims_account
  on public.reward_claims (chain_id, lower(droid_account));
create index if not exists idx_revenue_events_asset
  on public.revenue_events (chain_id, asset_address, block_number);

alter table public.droids enable row level security;
alter table public.droid_accounts enable row level security;
alter table public.approved_assets enable row level security;
alter table public.strategies enable row level security;
alter table public.droid_strategies enable row level security;
alter table public.reward_epochs enable row level security;
alter table public.reward_allocations enable row level security;
alter table public.reward_claims enable row level security;
alter table public.revenue_events enable row level security;
alter table public.achievements enable row level security;
alter table public.droid_achievements enable row level security;
alter table public.treasuries enable row level security;
alter table public.treasury_balances enable row level security;
alter table public.cross_chain_transfers enable row level security;

comment on table public.droids is
  'Chain-qualified Droid index. Current NFT ownership must always be revalidated on-chain.';
comment on table public.reward_allocations is
  'Cache of allocations committed by an on-chain Merkle root; not an independent financial ledger.';
comment on table public.cross_chain_transfers is
  'Future record-only abstraction. CROSS_CHAIN_BRIDGE_ENABLED remains false.';
