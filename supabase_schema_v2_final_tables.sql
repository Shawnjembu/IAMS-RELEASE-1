-- =============================================================
-- IAMS v2 — Additive Schema Migrations
-- Run in: Supabase Dashboard → SQL Editor → New query
-- This file ADDS to the existing schema without dropping anything.
-- =============================================================

-- =============================================================
-- 1. EXTEND profiles.role to include new supervisor roles
-- =============================================================
-- Drop old check constraint and recreate with all 5 roles
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student','organization','coordinator','industrial_supervisor','university_supervisor'));

-- =============================================================
-- 2. ADD student_number to student_profiles (if not exists)
-- =============================================================
ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS student_number text,
  ADD COLUMN IF NOT EXISTS skills         text,
  ADD COLUMN IF NOT EXISTS interests      text;

-- =============================================================
-- 3. ADD match_score to placements (if not exists)
-- =============================================================
ALTER TABLE public.placements
  ADD COLUMN IF NOT EXISTS match_score numeric(5,2);

-- =============================================================
-- 3b. ADD required_skills + phone to organization_profiles
-- =============================================================
ALTER TABLE public.organization_profiles
  ADD COLUMN IF NOT EXISTS required_skills text,
  ADD COLUMN IF NOT EXISTS phone           text;

-- =============================================================
-- 3c. ADD phone + cv_url to student_profiles (if not exists)
-- =============================================================
ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS phone  text,
  ADD COLUMN IF NOT EXISTS cv_url text;

-- =============================================================
-- 4. ADD file_url + supervisor fields to logbook_entries
-- =============================================================
ALTER TABLE public.logbook_entries
  ADD COLUMN IF NOT EXISTS file_url         text,
  ADD COLUMN IF NOT EXISTS supervisor_comments text,
  ADD COLUMN IF NOT EXISTS reviewed_by      uuid references public.profiles;

-- =============================================================
-- 5. SUPERVISOR PROFILES
-- =============================================================
CREATE TABLE IF NOT EXISTS public.supervisor_profiles (
  id             uuid PRIMARY KEY REFERENCES public.profiles ON DELETE CASCADE,
  department     text,
  specialization text,
  phone          text,
  org_id         uuid REFERENCES public.profiles  -- org that "owns" this industrial supervisor
);

-- Add org_id if table already exists
ALTER TABLE public.supervisor_profiles
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.profiles;

-- =============================================================
-- 6. SUPERVISOR ASSIGNMENTS
-- (links a supervisor to a student via their placement)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.supervisor_assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id         uuid NOT NULL REFERENCES public.placements ON DELETE CASCADE,
  student_id           uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  industrial_supervisor_id uuid REFERENCES public.profiles,
  university_supervisor_id uuid REFERENCES public.profiles,
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  assigned_by          uuid REFERENCES public.profiles,
  UNIQUE (placement_id)
);

-- =============================================================
-- 7. INDUSTRIAL REPORTS (final report submitted by student)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.industrial_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  placement_id uuid REFERENCES public.placements,
  title        text NOT NULL,
  content      text,
  file_url     text,
  score        numeric(5,2),  -- 0–100, set by industrial supervisor
  comments     text,          -- industrial supervisor feedback
  status       text NOT NULL DEFAULT 'submitted'
               CHECK (status IN ('submitted','reviewed','graded')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid REFERENCES public.profiles,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id)          -- one report per student
);

-- =============================================================
-- 8. UNIVERSITY EVALUATIONS (up to 2 visits per student)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.uni_evaluations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  supervisor_id   uuid NOT NULL REFERENCES public.profiles,
  visit_number    int NOT NULL CHECK (visit_number IN (1,2)),
  score           numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  comments        text,
  visit_date      date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, visit_number)  -- one eval per visit per student
);

-- =============================================================
-- 9. FINAL GRADES (computed or overridden)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.final_grades (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  report_score        numeric(5,2),   -- from industrial_reports.score
  visit1_score        numeric(5,2),   -- from uni_evaluations visit 1
  visit2_score        numeric(5,2),   -- from uni_evaluations visit 2
  computed_grade      numeric(5,2),   -- 40% report + 60% avg(visit1,visit2)
  override_grade      numeric(5,2),   -- coordinator manual override
  override_reason     text,
  final_grade         numeric(5,2),   -- override_grade if set, else computed_grade
  letter_grade        text,           -- A/B/C/D/F
  overridden_by       uuid REFERENCES public.profiles,
  overridden_at       timestamptz,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id)
);

-- =============================================================
-- 10. RLS — Enable + Policies for new tables
-- =============================================================

ALTER TABLE public.supervisor_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industrial_reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uni_evaluations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_grades             ENABLE ROW LEVEL SECURITY;

-- supervisor_profiles: own row or coordinator
DROP POLICY IF EXISTS "svp_select_own"   ON public.supervisor_profiles;
DROP POLICY IF EXISTS "svp_select_coord" ON public.supervisor_profiles;
CREATE POLICY "svp_select_own"   ON public.supervisor_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "svp_select_coord" ON public.supervisor_profiles FOR SELECT USING (public.get_my_role() = 'coordinator');

-- supervisor_assignments: coordinator full, supervisors/student can see their own
DROP POLICY IF EXISTS "sva_all_coord"      ON public.supervisor_assignments;
DROP POLICY IF EXISTS "sva_select_ind"     ON public.supervisor_assignments;
DROP POLICY IF EXISTS "sva_select_uni"     ON public.supervisor_assignments;
DROP POLICY IF EXISTS "sva_select_student" ON public.supervisor_assignments;
CREATE POLICY "sva_all_coord"      ON public.supervisor_assignments FOR ALL    USING (public.get_my_role() = 'coordinator');
CREATE POLICY "sva_select_ind"     ON public.supervisor_assignments FOR SELECT USING (auth.uid() = industrial_supervisor_id);
CREATE POLICY "sva_select_uni"     ON public.supervisor_assignments FOR SELECT USING (auth.uid() = university_supervisor_id);
CREATE POLICY "sva_select_student" ON public.supervisor_assignments FOR SELECT USING (auth.uid() = student_id);

-- industrial_reports: student owns, coordinator full
DROP POLICY IF EXISTS "ir_select_student" ON public.industrial_reports;
DROP POLICY IF EXISTS "ir_insert_student" ON public.industrial_reports;
DROP POLICY IF EXISTS "ir_all_coord"      ON public.industrial_reports;
CREATE POLICY "ir_select_student" ON public.industrial_reports FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "ir_insert_student" ON public.industrial_reports FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "ir_all_coord"      ON public.industrial_reports FOR ALL    USING (public.get_my_role() = 'coordinator');

-- uni_evaluations: supervisor owns, coordinator full, student read
DROP POLICY IF EXISTS "ue_insert_uni"    ON public.uni_evaluations;
DROP POLICY IF EXISTS "ue_select_uni"    ON public.uni_evaluations;
DROP POLICY IF EXISTS "ue_select_student"ON public.uni_evaluations;
DROP POLICY IF EXISTS "ue_all_coord"     ON public.uni_evaluations;
CREATE POLICY "ue_insert_uni"     ON public.uni_evaluations FOR INSERT WITH CHECK (auth.uid() = supervisor_id);
CREATE POLICY "ue_select_uni"     ON public.uni_evaluations FOR SELECT USING (auth.uid() = supervisor_id);
CREATE POLICY "ue_select_student" ON public.uni_evaluations FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "ue_all_coord"      ON public.uni_evaluations FOR ALL    USING (public.get_my_role() = 'coordinator');

-- final_grades: coordinator full, student read, supervisor read
DROP POLICY IF EXISTS "fg_all_coord"        ON public.final_grades;
DROP POLICY IF EXISTS "fg_select_student"   ON public.final_grades;
DROP POLICY IF EXISTS "fg_select_supervisor"ON public.final_grades;
CREATE POLICY "fg_all_coord"      ON public.final_grades FOR ALL    USING (public.get_my_role() = 'coordinator');
CREATE POLICY "fg_select_student" ON public.final_grades FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "fg_select_supervisor" ON public.final_grades FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.supervisor_assignments sa
    WHERE sa.student_id = final_grades.student_id
      AND (sa.industrial_supervisor_id = auth.uid()
           OR sa.university_supervisor_id = auth.uid())
  )
);

-- =============================================================
-- 11. EXTEND existing RLS: supervisors can read/update logbook entries
-- =============================================================
DROP POLICY IF EXISTS "logbook_select_industrial_sup" ON public.logbook_entries;
DROP POLICY IF EXISTS "logbook_update_industrial_sup" ON public.logbook_entries;
CREATE POLICY "logbook_select_industrial_sup" ON public.logbook_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.supervisor_assignments sa
      WHERE sa.student_id = logbook_entries.student_id
        AND sa.industrial_supervisor_id = auth.uid()
    )
  );
CREATE POLICY "logbook_update_industrial_sup" ON public.logbook_entries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.supervisor_assignments sa
      WHERE sa.student_id = logbook_entries.student_id
        AND sa.industrial_supervisor_id = auth.uid()
    )
  );

-- =============================================================
-- 12. DEADLINES table
-- =============================================================
CREATE TABLE IF NOT EXISTS public.deadlines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  due_date       date,
  audience_role  text NOT NULL DEFAULT 'all'
                 CHECK (audience_role IN ('all','student','organization','coordinator','industrial_supervisor','university_supervisor')),
  message        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deadlines ENABLE ROW LEVEL SECURITY;

-- Coordinators can do everything; everyone else can read deadlines addressed to them or 'all'
DROP POLICY IF EXISTS "dl_all_coord"   ON public.deadlines;
DROP POLICY IF EXISTS "dl_select_role" ON public.deadlines;
CREATE POLICY "dl_all_coord"   ON public.deadlines FOR ALL    USING (public.get_my_role() = 'coordinator');
CREATE POLICY "dl_select_role" ON public.deadlines FOR SELECT USING (
  audience_role = 'all' OR audience_role = public.get_my_role()
);

-- =============================================================
-- 13. HELPER: compute_final_grade function
-- =============================================================
CREATE OR REPLACE FUNCTION public.compute_final_grade(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_score  numeric(5,2);
  v_visit1        numeric(5,2);
  v_visit2        numeric(5,2);
  v_computed      numeric(5,2);
  v_letter        text;
BEGIN
  SELECT score INTO v_report_score
    FROM public.industrial_reports WHERE student_id = p_student_id;

  SELECT score INTO v_visit1
    FROM public.uni_evaluations WHERE student_id = p_student_id AND visit_number = 1;

  SELECT score INTO v_visit2
    FROM public.uni_evaluations WHERE student_id = p_student_id AND visit_number = 2;

  -- Formula: 40% report + 60% avg(visit1, visit2)
  IF v_report_score IS NOT NULL AND v_visit1 IS NOT NULL AND v_visit2 IS NOT NULL THEN
    v_computed := ROUND((0.40 * v_report_score) + (0.60 * ((v_visit1 + v_visit2) / 2.0)), 2);
  ELSIF v_report_score IS NOT NULL AND v_visit1 IS NOT NULL THEN
    v_computed := ROUND((0.40 * v_report_score) + (0.60 * v_visit1), 2);
  ELSE
    v_computed := NULL;
  END IF;

  -- Letter grade
  v_letter := CASE
    WHEN v_computed >= 75 THEN 'A'
    WHEN v_computed >= 65 THEN 'B'
    WHEN v_computed >= 55 THEN 'C'
    WHEN v_computed >= 45 THEN 'D'
    WHEN v_computed IS NOT NULL THEN 'F'
    ELSE NULL
  END;

  INSERT INTO public.final_grades (student_id, report_score, visit1_score, visit2_score, computed_grade, final_grade, letter_grade, computed_at)
  VALUES (p_student_id, v_report_score, v_visit1, v_visit2, v_computed, v_computed, v_letter, now())
  ON CONFLICT (student_id) DO UPDATE
    SET report_score   = EXCLUDED.report_score,
        visit1_score   = EXCLUDED.visit1_score,
        visit2_score   = EXCLUDED.visit2_score,
        computed_grade = EXCLUDED.computed_grade,
        final_grade    = COALESCE(final_grades.override_grade, EXCLUDED.computed_grade),
        letter_grade   = CASE
          WHEN final_grades.override_grade IS NOT NULL THEN
            CASE
              WHEN final_grades.override_grade >= 75 THEN 'A'
              WHEN final_grades.override_grade >= 65 THEN 'B'
              WHEN final_grades.override_grade >= 55 THEN 'C'
              WHEN final_grades.override_grade >= 45 THEN 'D'
              ELSE 'F'
            END
          ELSE EXCLUDED.letter_grade
        END,
        computed_at    = now();
END;
$$;
