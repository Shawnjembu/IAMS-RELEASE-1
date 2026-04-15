-- =============================================================
-- IAMS — Supabase Schema  (safe to re-run)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- =============================================================

-- =============================================================
-- 1. DROP EXISTING (children first, then parents)
-- =============================================================
drop table if exists public.logbook_entries        cascade;
drop table if exists public.deadlines             cascade;
drop table if exists public.placements            cascade;
drop table if exists public.student_profiles      cascade;
drop table if exists public.organization_profiles cascade;
drop table if exists public.profiles              cascade;
drop table if exists public.assets                cascade;
drop function if exists public.get_my_role()      cascade;

-- =============================================================
-- 2. CREATE TABLES (profiles must exist before the helper function)
-- =============================================================

create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  role        text not null check (role in ('student','organization','coordinator')),
  full_name   text,
  email       text not null,
  phone       text,
  created_at  timestamptz not null default now()
);

create table public.student_profiles (
  id                 uuid primary key references public.profiles on delete cascade,
  program            text,
  year_of_study      int,
  skills             text,
  preferred_location text
);

create table public.organization_profiles (
  id             uuid primary key references public.profiles on delete cascade,
  org_name       text,
  industry       text,
  location       text,
  contact_person text,
  slots          int default 0
);

create table public.placements (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.profiles on delete cascade,
  org_id          uuid not null references public.profiles on delete cascade,
  status          text not null default 'suggested'
                  check (status in ('suggested','assigned','rejected')),
  assigned_by     uuid references public.profiles,
  assigned_at     timestamptz,
  override_reason text,
  created_at      timestamptz not null default now()
);

create table public.deadlines (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  due_date      date,
  audience_role text check (audience_role in ('student','organization','coordinator','all')),
  message       text,
  created_by    uuid references public.profiles,
  created_at    timestamptz not null default now()
);

create table public.logbook_entries (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.profiles on delete cascade,
  week_number       int,
  activities        text not null,
  learning_outcomes text,
  challenges        text,
  status            text not null default 'submitted'
                    check (status in ('submitted','reviewed')),
  submitted_at      timestamptz not null default now(),
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);

create table public.assets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text,
  status     text default 'active',
  created_at timestamptz not null default now()
);

-- =============================================================
-- 3. HELPER FUNCTION (after profiles exists — SQL functions
--    resolve object references at parse time, not runtime)
-- =============================================================
create function public.get_my_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- =============================================================
-- 4. ENABLE RLS
-- =============================================================
alter table public.profiles              enable row level security;
alter table public.student_profiles      enable row level security;
alter table public.organization_profiles enable row level security;
alter table public.placements            enable row level security;
alter table public.deadlines             enable row level security;
alter table public.logbook_entries       enable row level security;
alter table public.assets                enable row level security;

-- =============================================================
-- 5. RLS POLICIES
-- =============================================================

-- ---- profiles ----
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "profiles_select_coordinator" on public.profiles
  for select using (public.get_my_role() = 'coordinator');

-- ---- student_profiles ----
create policy "sp_select_own" on public.student_profiles
  for select using (auth.uid() = id);

create policy "sp_insert_own" on public.student_profiles
  for insert with check (auth.uid() = id);

create policy "sp_update_own" on public.student_profiles
  for update using (auth.uid() = id);

create policy "sp_select_coordinator" on public.student_profiles
  for select using (public.get_my_role() = 'coordinator');

-- ---- organization_profiles ----
create policy "op_select_own" on public.organization_profiles
  for select using (auth.uid() = id);

create policy "op_insert_own" on public.organization_profiles
  for insert with check (auth.uid() = id);

create policy "op_update_own" on public.organization_profiles
  for update using (auth.uid() = id);

create policy "op_select_coordinator" on public.organization_profiles
  for select using (public.get_my_role() = 'coordinator');

-- ---- placements ----
create policy "placements_select_student" on public.placements
  for select using (auth.uid() = student_id);

create policy "placements_all_coordinator" on public.placements
  for all using (public.get_my_role() = 'coordinator');

create policy "placements_select_org" on public.placements
  for select using (auth.uid() = org_id);

-- ---- deadlines ----
create policy "deadlines_select_all" on public.deadlines
  for select using (true);

create policy "deadlines_write_coordinator" on public.deadlines
  for all using (public.get_my_role() = 'coordinator');

-- ---- logbook_entries ----
-- Service role (used by all API functions) bypasses RLS, so these are belt-and-suspenders
create policy "logbook_select_student" on public.logbook_entries
  for select using (auth.uid() = student_id);

create policy "logbook_insert_student" on public.logbook_entries
  for insert with check (auth.uid() = student_id);

create policy "logbook_all_coordinator" on public.logbook_entries
  for all using (public.get_my_role() = 'coordinator');

-- ---- assets (legacy demo) ----
create policy "assets_select_auth" on public.assets
  for select to authenticated using (true);

create policy "assets_insert_auth" on public.assets
  for insert to authenticated with check (true);

create policy "assets_update_auth" on public.assets
  for update to authenticated using (true);

create policy "assets_delete_auth" on public.assets
  for delete to authenticated using (true);
