-- IAMS FINAL POLISH PATCH
-- Safe, non-destructive patch for final release security/workflow features.
-- Run this after the base schema and demo seed, if needed.

-- 1) Messages compatibility: support both receiver_id and recipient_id naming.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists receiver_id uuid references public.profiles(id) on delete cascade;
alter table public.messages add column if not exists recipient_id uuid references public.profiles(id) on delete cascade;
alter table public.messages add column if not exists read_at timestamptz;

update public.messages set receiver_id = recipient_id where receiver_id is null and recipient_id is not null;
update public.messages set recipient_id = receiver_id where recipient_id is null and receiver_id is not null;

create or replace function public.iams_sync_message_receiver_columns()
returns trigger language plpgsql as $$
begin
  if new.receiver_id is null and new.recipient_id is not null then
    new.receiver_id := new.recipient_id;
  end if;
  if new.recipient_id is null and new.receiver_id is not null then
    new.recipient_id := new.receiver_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_iams_sync_message_receiver_columns on public.messages;
create trigger trg_iams_sync_message_receiver_columns
before insert or update on public.messages
for each row execute function public.iams_sync_message_receiver_columns();

create index if not exists idx_messages_sender_receiver_created on public.messages(sender_id, receiver_id, created_at desc);
create index if not exists idx_messages_receiver_sender_created on public.messages(receiver_id, sender_id, created_at desc);

-- 2) Deadline typing for report/logbook/other submission locks.
alter table public.deadlines add column if not exists deadline_type text not null default 'other';
alter table public.deadlines add column if not exists target_student_id uuid references public.profiles(id) on delete cascade;
alter table public.deadlines add column if not exists created_by uuid references public.profiles(id) on delete set null;

update public.deadlines
set deadline_type = 'report'
where deadline_type = 'other' and lower(coalesce(title,'')) like '%report%';

update public.deadlines
set deadline_type = 'logbook'
where deadline_type = 'other' and lower(coalesce(title,'')) like '%logbook%';

create index if not exists idx_deadlines_type_due on public.deadlines(deadline_type, due_date);
create index if not exists idx_deadlines_created_by on public.deadlines(created_by);
create index if not exists idx_deadlines_target_student on public.deadlines(target_student_id);

-- 3) Reports: ensure review fields exist.
alter table public.industrial_reports add column if not exists score numeric;
alter table public.industrial_reports add column if not exists comments text;
alter table public.industrial_reports add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.industrial_reports add column if not exists reviewed_at timestamptz;
alter table public.industrial_reports add column if not exists submitted_at timestamptz;
alter table public.industrial_reports add column if not exists file_url text;
create index if not exists idx_reports_student_status on public.industrial_reports(student_id, status);

-- 4) Logbook quality fields.
alter table public.logbook_entries add column if not exists file_url text;
alter table public.logbook_entries add column if not exists supervisor_comments text;
alter table public.logbook_entries add column if not exists reviewed_at timestamptz;
create index if not exists idx_logbook_student_week on public.logbook_entries(student_id, week_number);

-- 5) Supervisor limit: max 10 active students per supervisor.
create or replace function public.iams_enforce_supervisor_max_10()
returns trigger language plpgsql as $$
declare
  industrial_count integer;
  university_count integer;
begin
  if new.industrial_supervisor_id is not null then
    select count(*) into industrial_count
    from public.supervisor_assignments
    where industrial_supervisor_id = new.industrial_supervisor_id
      and student_id <> coalesce(new.student_id, '00000000-0000-0000-0000-000000000000'::uuid);
    if industrial_count >= 10 then
      raise exception 'Industrial supervisor already has 10 assigned students';
    end if;
  end if;

  if new.university_supervisor_id is not null then
    select count(*) into university_count
    from public.supervisor_assignments
    where university_supervisor_id = new.university_supervisor_id
      and student_id <> coalesce(new.student_id, '00000000-0000-0000-0000-000000000000'::uuid);
    if university_count >= 10 then
      raise exception 'University supervisor already has 10 assigned students';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_iams_enforce_supervisor_max_10 on public.supervisor_assignments;
create trigger trg_iams_enforce_supervisor_max_10
before insert or update on public.supervisor_assignments
for each row execute function public.iams_enforce_supervisor_max_10();

-- 6) Useful profile/avatar columns.
alter table public.profiles add column if not exists avatar_url text;
alter table public.organization_profiles add column if not exists logo_url text;
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_placements_student_status on public.placements(student_id, status);
create index if not exists idx_placements_org_status on public.placements(org_id, status);
create index if not exists idx_supervisor_assignments_student on public.supervisor_assignments(student_id);
create index if not exists idx_supervisor_assignments_industrial on public.supervisor_assignments(industrial_supervisor_id);
create index if not exists idx_supervisor_assignments_university on public.supervisor_assignments(university_supervisor_id);

-- Optional RLS note:
-- This local project uses server-side service-role APIs for access checks.
-- If deploying publicly, enable RLS and mirror the same rules in Supabase policies.


-- 7) Optional UI settings table. Store background image PATHS here if you want
-- admins to swap dashboard backgrounds later. Keep actual image files in
-- public/assets/backgrounds/ or Supabase Storage; do not store image binaries
-- in database rows because that slows page rendering.
create table if not exists public.iams_ui_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into public.iams_ui_settings(key, value) values
  ('background.student', '/assets/backgrounds/student-dashboard.jpeg'),
  ('background.organization', '/assets/backgrounds/organisation-dashboard.jpeg'),
  ('background.coordinator', '/assets/backgrounds/coordinator-dashboard.jpeg'),
  ('background.industrial_supervisor', '/assets/backgrounds/industrial-supervisor-dashboard.jpeg'),
  ('background.university_supervisor', '/assets/backgrounds/university-supervisor-dashboard.jpeg'),
  ('background.landing', '/assets/backgrounds/landing-bg.jpeg')
on conflict (key) do update set value = excluded.value, updated_at = now();
