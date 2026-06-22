create extension if not exists pgcrypto;

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  display_name text not null default '',
  blessing_type text not null,
  period_type text not null,
  period_key text not null,
  checked_in_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint checkins_blessing_type_check
    check (blessing_type in ('morningPrayer', 'smallGroup', 'sunday', 'tithe')),
  constraint checkins_period_type_check
    check (period_type in ('day', 'week', 'month')),
  constraint checkins_unique_task_period
    unique (line_user_id, blessing_type, period_key)
);

create index if not exists checkins_line_user_id_idx
  on public.checkins (line_user_id);

create index if not exists checkins_period_key_idx
  on public.checkins (period_key);

create table if not exists public.user_task_status (
  line_user_id text not null,
  display_name text not null default '',
  blessing_type text not null,
  period_type text not null,
  period_key text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint user_task_status_primary
    primary key (line_user_id, blessing_type, period_key),
  constraint user_task_status_blessing_type_check
    check (blessing_type in ('morningPrayer', 'smallGroup', 'sunday', 'tithe')),
  constraint user_task_status_period_type_check
    check (period_type in ('day', 'week', 'month'))
);

create index if not exists user_task_status_line_user_id_idx
  on public.user_task_status (line_user_id);

create index if not exists user_task_status_period_key_idx
  on public.user_task_status (period_key);

alter table public.checkins enable row level security;
alter table public.user_task_status enable row level security;
