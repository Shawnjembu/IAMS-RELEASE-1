-- =============================================================
-- IAMS Step 17 — SEED DATA FOR EXISTING AUTH USERS ONLY (NO ON CONFLICT)
-- IMPORTANT:
-- 1) Create the login accounts first in Supabase Authentication OR through the app.
-- 2) Do NOT insert into auth.users/auth.identities with SQL.
-- 3) This file only creates/updates app tables, profiles, placements,
--    supervisors, messages, deadlines and demo testing data.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================
-- 0. REQUIRED FEATURE SCHEMA / SAFE MIGRATIONS
-- =============================================================

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student','organization','coordinator','industrial_supervisor','university_supervisor'));

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.student_profiles ADD COLUMN IF NOT EXISTS student_number text;
ALTER TABLE public.student_profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.student_profiles ADD COLUMN IF NOT EXISTS cv_url text;
ALTER TABLE public.student_profiles ADD COLUMN IF NOT EXISTS skills text;
ALTER TABLE public.student_profiles ADD COLUMN IF NOT EXISTS interests text;
ALTER TABLE public.organization_profiles ADD COLUMN IF NOT EXISTS required_skills text;
ALTER TABLE public.organization_profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.organization_profiles ADD COLUMN IF NOT EXISTS logo_url text;

CREATE TABLE IF NOT EXISTS public.supervisor_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text,
  supervisor_type text NOT NULL CHECK (supervisor_type IN ('industrial_supervisor','university_supervisor')),
  org_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','cancelled')),
  invite_link text,
  expires_at timestamptz DEFAULT (now() + interval '14 days'),
  accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supervisor_profiles (
  id uuid PRIMARY KEY REFERENCES public.profiles ON DELETE CASCADE,
  department text,
  specialization text,
  phone text,
  org_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invite_id uuid REFERENCES public.supervisor_invites(id) ON DELETE SET NULL
);
ALTER TABLE public.supervisor_profiles ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.supervisor_profiles ADD COLUMN IF NOT EXISTS invite_id uuid REFERENCES public.supervisor_invites(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.supervisor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id uuid NOT NULL REFERENCES public.placements ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  industrial_supervisor_id uuid REFERENCES public.profiles,
  university_supervisor_id uuid REFERENCES public.profiles,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES public.profiles,
  UNIQUE (placement_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.industrial_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  placement_id uuid REFERENCES public.placements,
  title text NOT NULL,
  content text,
  file_url text,
  score numeric(5,2),
  comments text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewed','graded')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id)
);

CREATE TABLE IF NOT EXISTS public.uni_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  supervisor_id uuid NOT NULL REFERENCES public.profiles,
  visit_number int NOT NULL CHECK (visit_number IN (1,2)),
  score numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  comments text,
  visit_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, visit_number)
);

ALTER TABLE public.deadlines ADD COLUMN IF NOT EXISTS target_student_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.deadlines ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.deadlines DROP CONSTRAINT IF EXISTS deadlines_audience_role_check;
ALTER TABLE public.deadlines ADD CONSTRAINT deadlines_audience_role_check
  CHECK (audience_role IN ('all','student','assigned_students','organization','coordinator','industrial_supervisor','university_supervisor'));

CREATE OR REPLACE FUNCTION public.enforce_supervisor_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ind_count integer;
  uni_count integer;
BEGIN
  IF NEW.industrial_supervisor_id IS NOT NULL THEN
    SELECT count(*) INTO ind_count
    FROM public.supervisor_assignments
    WHERE industrial_supervisor_id = NEW.industrial_supervisor_id
      AND id IS DISTINCT FROM NEW.id;
    IF ind_count >= 10 THEN
      RAISE EXCEPTION 'This industrial supervisor already has 10 students assigned.';
    END IF;
  END IF;

  IF NEW.university_supervisor_id IS NOT NULL THEN
    SELECT count(*) INTO uni_count
    FROM public.supervisor_assignments
    WHERE university_supervisor_id = NEW.university_supervisor_id
      AND id IS DISTINCT FROM NEW.id;
    IF uni_count >= 10 THEN
      RAISE EXCEPTION 'This university supervisor already has 10 students assigned.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_supervisor_capacity ON public.supervisor_assignments;
CREATE TRIGGER trg_enforce_supervisor_capacity
BEFORE INSERT OR UPDATE ON public.supervisor_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_supervisor_capacity();

CREATE INDEX IF NOT EXISTS supervisor_assignments_industrial_idx ON public.supervisor_assignments(industrial_supervisor_id);
CREATE INDEX IF NOT EXISTS supervisor_assignments_university_idx ON public.supervisor_assignments(university_supervisor_id);
CREATE INDEX IF NOT EXISTS supervisor_assignments_student_idx ON public.supervisor_assignments(student_id);
CREATE INDEX IF NOT EXISTS messages_sender_idx ON public.messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_receiver_idx ON public.messages(receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS placements_org_status_idx ON public.placements(org_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS logbook_entries_student_week_unique
ON public.logbook_entries(student_id, week_number)
WHERE week_number IS NOT NULL;

-- =============================================================
-- 1. CHECK THAT THE AUTH USERS ALREADY EXIST
-- =============================================================
DO $$
DECLARE
  missing_emails text;
BEGIN
  SELECT string_agg(email, ', ')
  INTO missing_emails
  FROM (
    VALUES
      ('coordinator@iams.test'),
      ('201801639@ub.co.bw'),
      ('201802565@ub.co.bw'),
      ('202004071@ub.co.bw'),
      ('careers@techzone.co.bw'),
      ('hr@datacraft.co.bw'),
      ('thabo@techzone.co.bw'),
      ('naledi@techzone.co.bw'),
      ('mmopi@ub.ac.bw'),
      ('kabo@ub.ac.bw')
  ) AS required(email)
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(required.email)
  );

  IF missing_emails IS NOT NULL THEN
    RAISE EXCEPTION 'Create these users in Supabase Authentication first, then rerun this SQL: %', missing_emails;
  END IF;
END $$;

-- =============================================================
-- 2. CLEAN ONLY DEMO APP DATA. DO NOT TOUCH AUTH USERS.
-- =============================================================
WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.messages
WHERE sender_id IN (SELECT id FROM demo_users) OR receiver_id IN (SELECT id FROM demo_users);

WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.uni_evaluations
WHERE student_id IN (SELECT id FROM demo_users) OR supervisor_id IN (SELECT id FROM demo_users);

WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.industrial_reports
WHERE student_id IN (SELECT id FROM demo_users) OR reviewed_by IN (SELECT id FROM demo_users);

WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.supervisor_assignments
WHERE student_id IN (SELECT id FROM demo_users)
   OR industrial_supervisor_id IN (SELECT id FROM demo_users)
   OR university_supervisor_id IN (SELECT id FROM demo_users)
   OR assigned_by IN (SELECT id FROM demo_users);

WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.supervisor_invites
WHERE lower(email) IN ('thabo@techzone.co.bw','naledi@techzone.co.bw','mmopi@ub.ac.bw','kabo@ub.ac.bw')
   OR invited_by IN (SELECT id FROM demo_users)
   OR accepted_by IN (SELECT id FROM demo_users);

WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.logbook_entries
WHERE student_id IN (SELECT id FROM demo_users);

WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.deadlines
WHERE created_by IN (SELECT id FROM demo_users)
   OR target_student_id IN (SELECT id FROM demo_users)
   OR title LIKE 'Demo:%';

WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.placements
WHERE student_id IN (SELECT id FROM demo_users)
   OR org_id IN (SELECT id FROM demo_users)
   OR assigned_by IN (SELECT id FROM demo_users);

WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.supervisor_profiles WHERE id IN (SELECT id FROM demo_users);
WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.student_profiles WHERE id IN (SELECT id FROM demo_users);
WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.organization_profiles WHERE id IN (SELECT id FROM demo_users);
WITH demo_users AS (
  SELECT id FROM auth.users WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
DELETE FROM public.profiles WHERE id IN (SELECT id FROM demo_users);

-- =============================================================
-- 3. CREATE APP PROFILES FROM EXISTING AUTH USERS
-- =============================================================
WITH auth_map AS (
  SELECT id, lower(email) AS email FROM auth.users
  WHERE lower(email) IN (
    'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
    'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
    'mmopi@ub.ac.bw','kabo@ub.ac.bw'
  )
)
INSERT INTO public.profiles (id, role, full_name, email, phone, avatar_url)
SELECT id,
       CASE
         WHEN email LIKE '%@ub.co.bw' AND email ~ '^[0-9]+@ub\.co\.bw$' THEN 'student'
         WHEN email IN ('careers@techzone.co.bw','hr@datacraft.co.bw') THEN 'organization'
         WHEN email IN ('thabo@techzone.co.bw','naledi@techzone.co.bw') THEN 'industrial_supervisor'
         WHEN email LIKE '%@ub.ac.bw' THEN 'university_supervisor'
         ELSE 'coordinator'
       END AS role,
       CASE email
         WHEN 'coordinator@iams.test' THEN 'IAMS Coordinator'
         WHEN '201801639@ub.co.bw' THEN 'Obvious Njembu'
         WHEN '201802565@ub.co.bw' THEN 'Thatayaone Mogale'
         WHEN '202004071@ub.co.bw' THEN 'Stacey Nthoi'
         WHEN 'careers@techzone.co.bw' THEN 'TechZone Botswana'
         WHEN 'hr@datacraft.co.bw' THEN 'DataCraft Solutions'
         WHEN 'thabo@techzone.co.bw' THEN 'Thabo Molefe'
         WHEN 'naledi@techzone.co.bw' THEN 'Naledi Dube'
         WHEN 'mmopi@ub.ac.bw' THEN 'Dr M. Mmopi'
         WHEN 'kabo@ub.ac.bw' THEN 'Mr Kabo Sebina'
         ELSE email
       END AS full_name,
       email,
       CASE email
         WHEN 'careers@techzone.co.bw' THEN '+267 390 1000'
         WHEN 'hr@datacraft.co.bw' THEN '+267 391 2000'
         WHEN 'thabo@techzone.co.bw' THEN '+267 7111 0001'
         WHEN 'naledi@techzone.co.bw' THEN '+267 7111 0002'
         WHEN 'mmopi@ub.ac.bw' THEN '+267 355 2001'
         WHEN 'kabo@ub.ac.bw' THEN '+267 355 2002'
         ELSE '+267 7000 0000'
       END AS phone,
       NULL AS avatar_url
FROM auth_map;

-- Student profiles
INSERT INTO public.student_profiles (id, student_number, program, year_of_study, skills, interests, preferred_location, phone)
SELECT u.id,
       split_part(lower(u.email), '@', 1),
       'BSc Computer Science',
       3,
       CASE lower(u.email)
         WHEN '201801639@ub.co.bw' THEN 'React, JavaScript, MySQL, UI design'
         WHEN '201802565@ub.co.bw' THEN 'PHP, database design, testing'
         ELSE 'HTML, CSS, documentation, user support'
       END,
       'Industrial attachment, software development, support systems',
       'Gaborone',
       '+267 72 000 000'
FROM auth.users u
WHERE lower(u.email) IN ('201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw')
;

-- Organisation profiles
INSERT INTO public.organization_profiles (id, org_name, industry, location, contact_person, slots, required_skills, phone, logo_url)
SELECT u.id,
       CASE lower(u.email)
         WHEN 'careers@techzone.co.bw' THEN 'TechZone Botswana'
         ELSE 'DataCraft Solutions'
       END,
       CASE lower(u.email)
         WHEN 'careers@techzone.co.bw' THEN 'Software Development and ICT Support'
         ELSE 'Data Systems and Business Applications'
       END,
       'Gaborone',
       CASE lower(u.email)
         WHEN 'careers@techzone.co.bw' THEN 'Ms Neo Pule'
         ELSE 'Mr Kabelo Moremi'
       END,
       CASE lower(u.email)
         WHEN 'careers@techzone.co.bw' THEN 3
         ELSE 2
       END,
       CASE lower(u.email)
         WHEN 'careers@techzone.co.bw' THEN 'React, JavaScript, technical support, database basics'
         ELSE 'SQL, reporting, systems analysis, documentation'
       END,
       CASE lower(u.email)
         WHEN 'careers@techzone.co.bw' THEN '+267 390 1000'
         ELSE '+267 391 2000'
       END,
       NULL
FROM auth.users u
WHERE lower(u.email) IN ('careers@techzone.co.bw','hr@datacraft.co.bw')
;

-- Accepted supervisor invite records for testing
WITH ids AS (
  SELECT lower(email) email, id FROM auth.users
  WHERE lower(email) IN ('coordinator@iams.test','careers@techzone.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw','mmopi@ub.ac.bw','kabo@ub.ac.bw')
)
INSERT INTO public.supervisor_invites (email, full_name, supervisor_type, org_id, invited_by, token, status, invite_link, accepted_by, accepted_at)
VALUES
  ('thabo@techzone.co.bw', 'Thabo Molefe', 'industrial_supervisor',
    (SELECT id FROM ids WHERE email='careers@techzone.co.bw'),
    (SELECT id FROM ids WHERE email='careers@techzone.co.bw'),
    'demo-industrial-thabo', 'accepted', '/supervisor-invite.html?token=demo-industrial-thabo',
    (SELECT id FROM ids WHERE email='thabo@techzone.co.bw'), now()),
  ('naledi@techzone.co.bw', 'Naledi Dube', 'industrial_supervisor',
    (SELECT id FROM ids WHERE email='careers@techzone.co.bw'),
    (SELECT id FROM ids WHERE email='careers@techzone.co.bw'),
    'demo-industrial-naledi', 'accepted', '/supervisor-invite.html?token=demo-industrial-naledi',
    (SELECT id FROM ids WHERE email='naledi@techzone.co.bw'), now()),
  ('mmopi@ub.ac.bw', 'Dr M. Mmopi', 'university_supervisor',
    NULL,
    (SELECT id FROM ids WHERE email='coordinator@iams.test'),
    'demo-university-mmopi', 'accepted', '/supervisor-invite.html?token=demo-university-mmopi',
    (SELECT id FROM ids WHERE email='mmopi@ub.ac.bw'), now()),
  ('kabo@ub.ac.bw', 'Mr Kabo Sebina', 'university_supervisor',
    NULL,
    (SELECT id FROM ids WHERE email='coordinator@iams.test'),
    'demo-university-kabo', 'accepted', '/supervisor-invite.html?token=demo-university-kabo',
    (SELECT id FROM ids WHERE email='kabo@ub.ac.bw'), now())
;

-- Supervisor profiles
WITH ids AS (
  SELECT lower(email) email, id FROM auth.users
  WHERE lower(email) IN ('careers@techzone.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw','mmopi@ub.ac.bw','kabo@ub.ac.bw')
)
INSERT INTO public.supervisor_profiles (id, department, specialization, phone, org_id, invite_id)
VALUES
  ((SELECT id FROM ids WHERE email='thabo@techzone.co.bw'), 'ICT Operations', 'Software support and workplace supervision', '+267 7111 0001', (SELECT id FROM ids WHERE email='careers@techzone.co.bw'), (SELECT id FROM public.supervisor_invites WHERE token='demo-industrial-thabo')),
  ((SELECT id FROM ids WHERE email='naledi@techzone.co.bw'), 'Software Development', 'Web systems and quality assurance', '+267 7111 0002', (SELECT id FROM ids WHERE email='careers@techzone.co.bw'), (SELECT id FROM public.supervisor_invites WHERE token='demo-industrial-naledi')),
  ((SELECT id FROM ids WHERE email='mmopi@ub.ac.bw'), 'Computer Science', 'Academic attachment supervision', '+267 355 2001', NULL, (SELECT id FROM public.supervisor_invites WHERE token='demo-university-mmopi')),
  ((SELECT id FROM ids WHERE email='kabo@ub.ac.bw'), 'Computer Science', 'Student progress monitoring', '+267 355 2002', NULL, (SELECT id FROM public.supervisor_invites WHERE token='demo-university-kabo'))
;

-- Placements: students are attached to organisations
WITH ids AS (
  SELECT lower(email) email, id FROM auth.users
  WHERE lower(email) IN ('coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw','careers@techzone.co.bw','hr@datacraft.co.bw')
)
INSERT INTO public.placements (student_id, org_id, status, assigned_by, assigned_at, override_reason)
VALUES
  ((SELECT id FROM ids WHERE email='201801639@ub.co.bw'), (SELECT id FROM ids WHERE email='careers@techzone.co.bw'), 'assigned', (SELECT id FROM ids WHERE email='coordinator@iams.test'), now(), 'Demo placement for testing'),
  ((SELECT id FROM ids WHERE email='201802565@ub.co.bw'), (SELECT id FROM ids WHERE email='careers@techzone.co.bw'), 'assigned', (SELECT id FROM ids WHERE email='coordinator@iams.test'), now(), 'Demo placement for testing'),
  ((SELECT id FROM ids WHERE email='202004071@ub.co.bw'), (SELECT id FROM ids WHERE email='hr@datacraft.co.bw'), 'assigned', (SELECT id FROM ids WHERE email='coordinator@iams.test'), now(), 'Demo placement for testing');

-- Assign two supervisors per student where available
WITH p AS (
  SELECT pl.id placement_id, pl.student_id, sp.email student_email
  FROM public.placements pl
  JOIN public.profiles sp ON sp.id = pl.student_id
  WHERE lower(sp.email) IN ('201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw')
), ids AS (
  SELECT lower(email) email, id FROM auth.users
  WHERE lower(email) IN ('careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw','mmopi@ub.ac.bw','kabo@ub.ac.bw','coordinator@iams.test')
)
INSERT INTO public.supervisor_assignments (placement_id, student_id, industrial_supervisor_id, university_supervisor_id, assigned_by)
SELECT p.placement_id,
       p.student_id,
       CASE p.student_email
         WHEN '201801639@ub.co.bw' THEN (SELECT id FROM ids WHERE email='thabo@techzone.co.bw')
         WHEN '201802565@ub.co.bw' THEN (SELECT id FROM ids WHERE email='naledi@techzone.co.bw')
         ELSE NULL
       END AS industrial_supervisor_id,
       CASE p.student_email
         WHEN '201801639@ub.co.bw' THEN (SELECT id FROM ids WHERE email='mmopi@ub.ac.bw')
         WHEN '201802565@ub.co.bw' THEN (SELECT id FROM ids WHERE email='kabo@ub.ac.bw')
         ELSE (SELECT id FROM ids WHERE email='mmopi@ub.ac.bw')
       END AS university_supervisor_id,
       (SELECT id FROM ids WHERE email='coordinator@iams.test') AS assigned_by
FROM p
;

-- Demo logbooks and reports
WITH ids AS (
  SELECT lower(email) email, id FROM auth.users
  WHERE lower(email) IN ('201801639@ub.co.bw','201802565@ub.co.bw','thabo@techzone.co.bw')
)
INSERT INTO public.logbook_entries (student_id, week_number, activities, learning_outcomes, challenges, status)
VALUES
  ((SELECT id FROM ids WHERE email='201801639@ub.co.bw'), 1, 'Orientation, system setup and task observation.', 'Understood workplace reporting and supervisor expectations.', 'Initial setup delays.', 'submitted'),
  ((SELECT id FROM ids WHERE email='201802565@ub.co.bw'), 1, 'Database review and documentation support.', 'Improved understanding of software documentation.', 'Needed help understanding existing schema.', 'submitted')
;

WITH p AS (
  SELECT pl.id placement_id, pr.email student_email, pl.student_id
  FROM public.placements pl
  JOIN public.profiles pr ON pr.id = pl.student_id
  WHERE lower(pr.email) IN ('201801639@ub.co.bw','201802565@ub.co.bw')
), ids AS (
  SELECT lower(email) email, id FROM auth.users WHERE lower(email) IN ('thabo@techzone.co.bw','naledi@techzone.co.bw')
)
INSERT INTO public.industrial_reports (student_id, placement_id, title, content, score, comments, status, reviewed_by, reviewed_at)
SELECT p.student_id,
       p.placement_id,
       'Demo: Industrial Attachment Progress Report',
       'This is a demo final report record for testing report review pages.',
       CASE p.student_email WHEN '201801639@ub.co.bw' THEN 82 ELSE NULL END,
       CASE p.student_email WHEN '201801639@ub.co.bw' THEN 'Good workplace progress and professional conduct.' ELSE NULL END,
       CASE p.student_email WHEN '201801639@ub.co.bw' THEN 'graded' ELSE 'submitted' END,
       CASE p.student_email WHEN '201801639@ub.co.bw' THEN (SELECT id FROM ids WHERE email='thabo@techzone.co.bw') ELSE NULL END,
       CASE p.student_email WHEN '201801639@ub.co.bw' THEN now() ELSE NULL END
FROM p
;

-- Demo deadlines created by supervisors, not coordinator
WITH ids AS (
  SELECT lower(email) email, id FROM auth.users
  WHERE lower(email) IN ('201801639@ub.co.bw','201802565@ub.co.bw','thabo@techzone.co.bw','mmopi@ub.ac.bw')
)
INSERT INTO public.deadlines (title, due_date, audience_role, message, created_by, target_student_id)
VALUES
  ('Demo: Week 2 logbook submission', current_date + interval '7 days', 'assigned_students', 'Submit your week 2 logbook for supervisor review.', (SELECT id FROM ids WHERE email='thabo@techzone.co.bw'), NULL),
  ('Demo: University supervision visit preparation', current_date + interval '10 days', 'student', 'Prepare your progress evidence for the university supervision visit.', (SELECT id FROM ids WHERE email='mmopi@ub.ac.bw'), (SELECT id FROM ids WHERE email='201801639@ub.co.bw'));

-- Demo messages: coordinator to organisation/supervisor and student to supervisor
WITH ids AS (
  SELECT lower(email) email, id FROM auth.users
  WHERE lower(email) IN ('coordinator@iams.test','careers@techzone.co.bw','mmopi@ub.ac.bw','201801639@ub.co.bw','thabo@techzone.co.bw')
)
INSERT INTO public.messages (sender_id, receiver_id, body, created_at)
VALUES
  ((SELECT id FROM ids WHERE email='coordinator@iams.test'), (SELECT id FROM ids WHERE email='careers@techzone.co.bw'), 'Please confirm available attachment slots for the current intake.', now() - interval '2 days'),
  ((SELECT id FROM ids WHERE email='coordinator@iams.test'), (SELECT id FROM ids WHERE email='mmopi@ub.ac.bw'), 'You have been assigned students for university supervision. Kindly review your dashboard.', now() - interval '1 day'),
  ((SELECT id FROM ids WHERE email='201801639@ub.co.bw'), (SELECT id FROM ids WHERE email='thabo@techzone.co.bw'), 'Good day supervisor, please confirm if my week 1 logbook is visible.', now() - interval '6 hours'),
  ((SELECT id FROM ids WHERE email='thabo@techzone.co.bw'), (SELECT id FROM ids WHERE email='201801639@ub.co.bw'), 'Yes, it is visible. Please continue submitting weekly entries on time.', now() - interval '4 hours');

-- =============================================================
-- 4. FINAL CHECK SUMMARY
-- =============================================================
SELECT role, count(*) AS total
FROM public.profiles
WHERE lower(email) IN (
  'coordinator@iams.test','201801639@ub.co.bw','201802565@ub.co.bw','202004071@ub.co.bw',
  'careers@techzone.co.bw','hr@datacraft.co.bw','thabo@techzone.co.bw','naledi@techzone.co.bw',
  'mmopi@ub.ac.bw','kabo@ub.ac.bw'
)
GROUP BY role
ORDER BY role;

-- Expected result:
-- coordinator = 1
-- industrial_supervisor = 2
-- organization = 2
-- student = 3
-- university_supervisor = 2
