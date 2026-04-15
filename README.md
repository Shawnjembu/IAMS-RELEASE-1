# IAMS — Industrial Attachment Management System

[![CSI341 Project](https://img.shields.io/badge/CSI341-Test2%20Project-brightgreen)](https://github.com/Shawnjembu/IAMS-RELEASE-1)

A full-stack web application for managing industrial attachment placements between students, organisations, and supervisors.

**Stack:** Vanilla JS frontend · Node.js HTTP server (local) / Vercel serverless (production) · Supabase (Auth + PostgreSQL)

---

## Team Members

- Shawn Njembu — GitHub: [@Shawnjembu](https://github.com/Shawnjembu)

## Lecturer

- **Yirsawa Sarapirome** ([@yirsawa](https://github.com/yirsawa))

---

## Roles & Access

| Role | Access |
|---|---|
| **student** | Profile, placement status, logbook, report submission, grade view |
| **organization** | Org profile, intern slots, assigned students, industrial supervisors |
| **coordinator** | All students & orgs, matching/placement, deadlines, supervisors, grade override |
| **industrial_supervisor** | Assigned students, logbook review, report grading |
| **university_supervisor** | Assigned students, visit evaluations (Visit 1 & 2) |

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/Shawnjembu/IAMS-RELEASE-1.git
cd IAMS-RELEASE-1
npm install
```

### 2. Supabase database

Run both SQL files **in order** in **Supabase Dashboard → SQL Editor**:

1. `supabase_iams.sql` — base schema (profiles, placements, logbook, reports)
2. `supabase_iams_v2.sql` — additive migration (supervisors, deadlines, grades, evaluations)

### 3. Environment variables

Create a `.env` file in the project root:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=   # server-side only — never expose to frontend
SUPABASE_PUBLISHABLE_KEY=    # safe for frontend (sb_publishable_... format)
```

Set the same variables in **Vercel → Project → Settings → Environment Variables** for production.

### 4. Run locally

```bash
node server.js
```

Open [http://localhost:3000](http://localhost:3000)

### 5. Deploy to Vercel

```bash
npx vercel --prod
```

---

## Test Accounts

Students, organisations, and supervisors register via `/auth.html`.

To create the coordinator account, run once after setting up `.env`:

```bash
node create-coordinator.js
```

Default test coordinator:
- **Email:** coordinator@iams.test
- **Password:** coord1234

The coordinator can create additional supervisor accounts from the Supervisors tab in the coordinator panel.

---

## Pages

| Path | Description |
|---|---|
| `/` | Landing page |
| `/auth.html` | Sign in / Register |
| `/dashboard.html` | Role-aware dashboard (student, org, coordinator) |
| `/student-profile.html` | Student profile editor |
| `/org-profile.html` | Organisation profile editor |
| `/coordinator.html` | Coordinator panel (matching, supervisors, deadlines) |
| `/supervisor-industrial.html` | Industrial supervisor panel |
| `/supervisor-university.html` | University supervisor panel |

---

## API Routes

### Auth & Profile
```
GET  /api/health                        — liveness check
POST /api/profile/init                  — create profile row after signup
GET  /api/profile/me                    — current user profile + role details
POST /api/profile/update                — update own profile
```

### Student
```
GET  /api/logbook                       — list own logbook entries
POST /api/logbook                       — submit a new logbook entry
PATCH /api/logbook?id=                  — supervisor marks entry as reviewed
GET  /api/reports/submit                — fetch own report
POST /api/reports/submit                — submit/update report (locked after grading)
GET  /api/assessments/grade             — view computed final grade
```

### Organisation
```
GET  /api/organization/students         — list assigned students with logbook counts
GET  /api/organization/supervisor       — list industrial supervisors for this org
POST /api/organization/supervisor       — create industrial supervisor linked to org
```

### Coordinator
```
GET  /api/coordinator/stats             — dashboard counts
GET  /api/coordinator/matching          — students + placement info + match scores
POST /api/coordinator/matching          — manually assign student to org
POST /api/coordinator/matching?action=auto  — run auto-match for all unassigned students
DELETE /api/coordinator/matching?placement_id=  — remove a placement
GET  /api/coordinator/supervisors       — list all supervisors
POST /api/coordinator/supervisors       — create supervisor account
GET  /api/deadlines?role=              — list deadlines for a role
POST /api/deadlines                     — create a deadline (coordinator only)
POST /api/assessments/override          — override a student's final grade
```

### Supervisors
```
GET  /api/supervisor/assign?student_id= — fetch supervisor assignment for student
POST /api/supervisor/assign             — assign supervisors to a student placement
GET  /api/supervisor/my-students        — list assigned students
GET  /api/reports/review                — list reports for supervisor's students
PATCH /api/reports/review               — grade/comment on a report
POST /api/supervisor/evaluate           — submit a visit evaluation (Visit 1 or 2)
```

---

## Grading Formula

**Final Grade = 40% × Report Score + 60% × Average(Visit 1, Visit 2)**

Computed by the `compute_final_grade` PostgreSQL function (in `supabase_iams_v2.sql`). Coordinator can override any grade.

---

## Auto-Matching Algorithm

Unassigned students are scored against each organisation (0–100):

- **70%** — skills overlap (student skills vs org required skills + industry)
- **20%** — location match (exact = 20 pts, partial = 10 pts)
- **10%** — program/industry alignment

Top 5 suggestions are shown per student. Coordinator can accept a suggestion or manually assign.
