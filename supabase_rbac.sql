-- AI use: Claude Sonnet 5 (Claude Code) helped write this migration for Sprint 3's RBAC concern.
-- FeedFlow RBAC migration
-- Run once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Adds real roles backed by Supabase Auth + Postgres RLS, replacing the
-- role-picker demo and the previously-open anon read/write access.

-- 1. Profiles: one row per auth user, holding their FeedFlow role + display name.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('tech','manager','cfo')),
  name text not null
);

alter table profiles enable row level security;

create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());

-- Helper: current user's FeedFlow role, used by every policy below.
create or replace function current_role_id()
returns text
language sql stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

-- 2. movements: RLS replaces the open anon-key access noted in the README.
alter table movements enable row level security;

-- Everyone signed in can see all movements (dashboard needs cross-role visibility).
create policy "movements_select_authenticated" on movements
  for select using (auth.role() = 'authenticated');

-- Food Production (tech) may only log "to_mix" batches.
create policy "movements_insert_tech" on movements
  for insert with check (
    current_role_id() = 'tech' and type = 'to_mix'
  );

-- Plant Manager may log any movement type.
create policy "movements_insert_manager" on movements
  for insert with check (
    current_role_id() = 'manager'
  );

-- GM (cfo) is read-only: no insert policy for that role.

-- 3. opening_balances: readable by anyone signed in, writable only by the manager.
alter table opening_balances enable row level security;

create policy "opening_balances_select_authenticated" on opening_balances
  for select using (auth.role() = 'authenticated');

create policy "opening_balances_write_manager" on opening_balances
  for insert with check (current_role_id() = 'manager');

create policy "opening_balances_update_manager" on opening_balances
  for update using (current_role_id() = 'manager');

-- 4. Seed the three real accounts.
-- First create each user in Supabase Dashboard → Authentication → Users → Add user
-- (email + password, "Auto Confirm User" checked). Then link each to a role by
-- email — no need to look up or copy UUIDs by hand:
--
-- insert into profiles (id, role, name)
--   select id, 'tech', 'Paige' from auth.users where email = 'paige123@gmail.com';
-- insert into profiles (id, role, name)
--   select id, 'manager', 'Todd' from auth.users where email = 'todd@gmail.com';
-- insert into profiles (id, role, name)
--   select id, 'cfo', 'Jamey' from auth.users where email = 'jamey123@gmail.com';
