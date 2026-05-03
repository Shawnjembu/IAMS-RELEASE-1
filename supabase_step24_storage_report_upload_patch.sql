-- IAMS Step 24: Storage + report/logbook file viewing patch
-- Run this once in Supabase SQL Editor before testing report/logbook uploads.

-- 1) Keep report/logbook file columns available.
alter table public.industrial_reports add column if not exists file_url text;
alter table public.industrial_reports add column if not exists title text;
alter table public.industrial_reports add column if not exists content text;
alter table public.industrial_reports add column if not exists score numeric;
alter table public.industrial_reports add column if not exists comments text;
alter table public.industrial_reports add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.industrial_reports add column if not exists reviewed_at timestamptz;
alter table public.industrial_reports add column if not exists submitted_at timestamptz;
alter table public.industrial_reports add column if not exists status text default 'submitted';

alter table public.logbook_entries add column if not exists file_url text;
alter table public.logbook_entries add column if not exists supervisor_comments text;
alter table public.logbook_entries add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.logbook_entries add column if not exists reviewed_at timestamptz;

-- 2) Ensure one active final report row per student, because the app updates by student_id.
with ranked as (
  select id,
         row_number() over (
           partition by student_id
           order by coalesce(submitted_at, reviewed_at, now()) desc, id desc
         ) as rn
  from public.industrial_reports
)
delete from public.industrial_reports ir
using ranked r
where ir.id = r.id and r.rn > 1;

create unique index if not exists industrial_reports_student_unique
on public.industrial_reports(student_id);

create unique index if not exists logbook_entries_student_week_unique
on public.logbook_entries(student_id, week_number);

create index if not exists idx_reports_student_status on public.industrial_reports(student_id, status);
create index if not exists idx_logbooks_student_status on public.logbook_entries(student_id, status);
create index if not exists idx_supervisor_assignments_uni on public.supervisor_assignments(university_supervisor_id, student_id);

-- 3) Create the private storage bucket used by report/logbook/profile uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'iams-attachments',
  'iams-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 4) Storage policies for authenticated users. The app mostly uses signed upload/download URLs,
-- but these policies help direct authenticated uploads/views during testing.
drop policy if exists "iams_upload_own_folder" on storage.objects;
create policy "iams_upload_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'iams-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "iams_update_own_folder" on storage.objects;
create policy "iams_update_own_folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'iams-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'iams-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "iams_select_own_folder" on storage.objects;
create policy "iams_select_own_folder"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'iams-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- File viewing for supervisors is handled by the server using short-lived signed URLs after checking assignments.
