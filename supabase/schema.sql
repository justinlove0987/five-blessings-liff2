create extension if not exists pgcrypto;

-- Production migration: checkins remains the check-in source of truth.
-- MVP adds users and teams; checkins gains user_id and team_id snapshots.
drop table if exists public.user_task_status;
drop table if exists public.user_daily_status;

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  display_name text not null default '',
  blessing_type text not null,
  period_type text not null,
  period_key text not null,
  checked_in_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.checkins
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists line_user_id text,
  add column if not exists display_name text default '',
  add column if not exists blessing_type text,
  add column if not exists period_type text,
  add column if not exists period_key text,
  add column if not exists checked_in_at timestamptz default now(),
  add column if not exists created_at timestamptz default now();

update public.checkins
set
  id = coalesce(id, gen_random_uuid()),
  display_name = coalesce(display_name, ''),
  checked_in_at = coalesce(checked_in_at, created_at, now()),
  created_at = coalesce(created_at, checked_in_at, now());

delete from public.checkins
where id is null
  or line_user_id is null
  or blessing_type is null
  or period_type is null
  or period_key is null;

alter table public.checkins
  alter column id set default gen_random_uuid(),
  alter column display_name set default '',
  alter column checked_in_at set default now(),
  alter column created_at set default now();

alter table public.checkins
  alter column id set not null,
  alter column line_user_id set not null,
  alter column display_name set not null,
  alter column blessing_type set not null,
  alter column period_type set not null,
  alter column period_key set not null,
  alter column checked_in_at set not null,
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where contype = 'p'
      and conrelid = 'public.checkins'::regclass
  ) then
    alter table public.checkins
      add constraint checkins_pkey primary key (id);
  end if;
end $$;

alter table public.checkins
  drop constraint if exists checkins_blessing_type_check,
  add constraint checkins_blessing_type_check
    check (blessing_type in (
      'morningPrayer',
      'smallGroup',
      'sunday',
      'tithe',
      'prayerMeeting'
    ));

alter table public.checkins
  drop constraint if exists checkins_period_type_check,
  add constraint checkins_period_type_check
    check (period_type in ('day', 'week', 'month'));

delete from public.checkins a
using public.checkins b
where a.line_user_id = b.line_user_id
  and a.blessing_type = b.blessing_type
  and a.period_key = b.period_key
  and (
    a.checked_in_at > b.checked_in_at
    or (a.checked_in_at = b.checked_in_at and a.id::text > b.id::text)
  );

alter table public.checkins
  drop constraint if exists checkins_unique_task_period,
  add constraint checkins_unique_task_period
    unique (line_user_id, blessing_type, period_key);

create index if not exists checkins_line_user_id_idx
  on public.checkins (line_user_id);

create index if not exists checkins_period_key_idx
  on public.checkins (period_key);

alter table public.checkins enable row level security;

-- ---------------------------------------------------------------------------
-- MVP: users, teams, and checkins extensions
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teams enable row level security;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text not null,
  nickname text,
  picture_url text,
  team_id uuid references public.teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  add column if not exists nickname text;

create index if not exists users_team_id_idx
  on public.users (team_id);

alter table public.users enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_created_by_user_id_fkey'
      and conrelid = 'public.teams'::regclass
  ) then
    alter table public.teams
      add constraint teams_created_by_user_id_fkey
        foreign key (created_by_user_id) references public.users(id);
  end if;
end $$;

drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at
  before update on public.teams
  for each row
  execute function public.set_updated_at();

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();

alter table public.checkins
  add column if not exists user_id uuid references public.users(id),
  add column if not exists team_id uuid references public.teams(id);

insert into public.users (line_user_id, display_name)
select distinct on (line_user_id)
  line_user_id,
  display_name
from public.checkins
order by line_user_id, checked_in_at desc
on conflict (line_user_id) do nothing;

update public.checkins c
set user_id = u.id
from public.users u
where c.line_user_id = u.line_user_id
  and c.user_id is null;

delete from public.checkins a
using public.checkins b
where a.user_id is not null
  and b.user_id is not null
  and a.user_id = b.user_id
  and a.blessing_type = b.blessing_type
  and a.period_type = b.period_type
  and a.period_key = b.period_key
  and (
    a.checked_in_at > b.checked_in_at
    or (a.checked_in_at = b.checked_in_at and a.id::text > b.id::text)
  );

alter table public.checkins
  drop constraint if exists checkins_unique_user_task_period,
  add constraint checkins_unique_user_task_period
    unique (user_id, blessing_type, period_type, period_key);

create index if not exists checkins_user_id_idx
  on public.checkins (user_id);

create index if not exists checkins_team_id_idx
  on public.checkins (team_id);

create index if not exists checkins_team_period_idx
  on public.checkins (team_id, period_key);

-- user_id stays nullable until API upserts users and writes user_id on check-in.
-- checkins_unique_task_period remains for current API deduplication by line_user_id.
