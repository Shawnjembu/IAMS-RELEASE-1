# IAMS Dashboard Fix - Implementation TODO
Generated from approved plan. Steps completed ✅, pending ⏳.

## Phase 1: Core Files & Profile Polish (5/10)
- ✅ [x] Create TODO.md (this file)
- ✅ [x] Enhance public/dashboard.html: Add inline logbook table, match sections, supervisor modals, org skills form
- ✅ [x] Update public/dashboard.js: Student logbook + CV upload + Org skills + Coordinator matching
- ⏳ [ ] Wire supervisor reports/evals JS handlers
- ⏳ [ ] Add loading spinners/toasts, polish UI states

## Phase 2: Backend APIs
- ⏳ [ ] Update api/logbook.js: POST /logbook (unique week validation)
- ⏳ [ ] Update api/coordinator/matching.js: POST {action:"run-auto-match"}
- ⏳ [ ] Create api/reports/submit.js (industrial supervisor)
- ⏳ [ ] Update api/supervisor/evaluate.js (uni visits)

## Phase 2: API Enhancements (2-5/10)
- ⏳ [ ] api/logbook.js: Add POST submit (validate unique week, PDF/DOCX ≤10MB)
- ⏳ [ ] api/coordinator/matching.js: Expose POST /run-auto-match → return scored list
- ⏳ [ ] Create api/reports/submit.js (industrial: rating/comments/file)
- ⏳ [ ] api/supervisor/evaluate.js: POST uni visit eval

## Phase 3: Schema/DB Fixes (6-7/10)
- ⏳ [ ] Create supabase_update.sql: Add logbook_entries UNIQUE(student_id,week_number), profiles.profile_complete bool
- ⏳ [ ] Execute SQL updates

## Phase 4: UI/UX Polish (8-10/10)
- ⏳ [ ] Add loading spinners, success/error toasts, disable buttons during submit
- ⏳ [ ] Populate real stats (matched students, logbooks submitted, reports pending)
- ⏳ [ ] Test all roles: Student/Org/Coord/Sup logins + forms → verify Supabase data
- ⏳ [ ] attempt_completion

**Next Step**: Wire dashboard.js handlers for new UI.


## Phase 2: API Enhancements (2-5/10)
- ⏳ [ ] api/logbook.js: Add POST submit (validate unique week, PDF/DOCX ≤10MB)
- ⏳ [ ] api/coordinator/matching.js: Expose POST /run-auto-match → return scored list
- ⏳ [ ] Create api/reports/submit.js (industrial: rating/comments/file)
- ⏳ [ ] api/supervisor/evaluate.js: POST uni visit eval

## Phase 3: Schema/DB Fixes (6-7/10)
- ⏳ [ ] Create supabase_update.sql: Add logbook_entries UNIQUE(student_id,week_number), profiles.profile_complete bool
- ⏳ [ ] Execute SQL updates

## Phase 4: UI/UX Polish (8-10/10)
- ⏳ [ ] Add loading spinners, success/error toasts, disable buttons during submit
- ⏳ [ ] Populate real stats (matched students, logbooks submitted, reports pending)
- ⏳ [ ] Test all roles: Student/Org/Coord/Sup logins + forms → verify Supabase data
- ⏳ [ ] attempt_completion

**Next Step**: Edit dashboard.html + .js for inline features.

