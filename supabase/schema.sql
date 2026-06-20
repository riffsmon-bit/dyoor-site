create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  x_user_id text unique,
  x_username text,
  discord_user_id text unique,
  discord_username text,
  m3sh_connected boolean not null default false,
  total_points integer not null default 0,
  referral_code text unique,
  referred_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quests (
  id text primary key,
  title text not null,
  description text not null,
  quest_type text not null,
  points integer not null default 0,
  verification_method text not null,
  external_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  target text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quest_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  quest_id text not null references public.quests(id) on delete cascade,
  status text not null check (status in ('pending', 'verified', 'rejected')),
  proof_url text,
  proof_text text,
  tx_hash text unique,
  verification_details jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, quest_id)
);

create table if not exists public.suspicious_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  wallet_address text,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'reviewed', 'cleared')),
  created_at timestamptz not null default now()
);

create or replace view public.leaderboard as
select
  u.id as user_id,
  u.wallet_address,
  u.x_username,
  u.discord_username,
  u.m3sh_connected,
  u.total_points,
  count(qc.id) filter (where qc.status = 'verified') as completed_quest_count,
  dense_rank() over (order by u.total_points desc, u.created_at asc) as rank
from public.users u
left join public.quest_completions qc on qc.user_id = u.id
group by u.id;

create index if not exists idx_users_wallet_lower on public.users (lower(wallet_address));
create index if not exists idx_quest_completions_user on public.quest_completions (user_id);
create index if not exists idx_quest_completions_status on public.quest_completions (status);
