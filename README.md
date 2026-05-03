# Industrial Attachment Management System (IAMS)

**Course:** Introduction to Software Engineering  
**Project:** CSI341 Industrial Attachment Management System  
**Institution:** University of Botswana, Department of Computer Science

IAMS is a web-based system for managing industrial attachment placement, student reporting, supervisor review, messaging, and monitoring.

---

## Team Members

| Name | Student ID | Role |
|---|---:|---|
| Thatayaone Mogale | 201802565 | Team Leader |
| Ellen Lame Olifile | 201800730 | Team Member |
| Stacey Batshanani Nthoi | 202004071 | Team Member |
| Pearl Laone Phillimon | 202000315 | Team Member |
| Obvious Njembu | 201801639 | Team Member |

---

## Final User Roles

| Role | Responsibility |
|---|---|
| Student | Completes profile, views placement, submits logbooks/report, views deadlines, messages assigned supervisors. |
| Organisation | Hosts students, manages slots, invites Industrial Supervisors, assigns attached students to Industrial Supervisors. |
| Industrial Supervisor | Provides workplace supervision and messages assigned students. Does not grade final reports. |
| University Supervisor | Creates report/logbook deadlines, reviews logbooks, opens report files, grades final reports, records visit evaluations. |
| Coordinator | Monitors placements, invites University Supervisors, assigns students to University Supervisors, messages organisations/supervisors, resolves system issues. |

---

## Correct Final Workflow

1. Student registers using `studentnumber@ub.co.bw`.
2. Student completes their profile.
3. Student chooses an available organisation or coordinator confirms placement.
4. Organisation receives attached student.
5. Organisation invites Industrial Supervisor.
6. Industrial Supervisor activates account and logs in.
7. Organisation assigns attached student to Industrial Supervisor.
8. Coordinator invites University Supervisor using `name@ub.ac.bw`.
9. Coordinator assigns student to University Supervisor.
10. Student sees organisation, Industrial Supervisor, and University Supervisor.
11. University Supervisor creates report/logbook submission deadline.
12. Student submits before deadline.
13. University Supervisor reviews logbooks, opens/downloads report file, grades report, and records visit evaluations.
14. Coordinator monitors the process but does not assess or create student deadlines.

---

## Email Rules

| User type | Required email format |
|---|---|
| Student | `201801639@ub.co.bw` |
| University Supervisor | `kabo@ub.ac.bw` |
| Industrial Supervisor | Any valid workplace/organisation email |
| Organisation | Any valid organisation email |
| Coordinator | Demo/admin email configured by the project |

---

## Tech Stack

The project intentionally avoids Vercel for development and runs locally using the report-aligned web stack:

- HTML
- CSS
- JavaScript
- Node.js local server for API routing
- Supabase for authentication, database, and storage during implementation/testing

> Note: The original report mentions MySQL as the database technology. The current implementation uses Supabase/PostgreSQL because the working system was built and tested against Supabase. The database logic remains relational and can be mapped to MySQL if required.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create `.env`

Create a `.env` file in the project root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-public-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Run SQL setup / patches

Run your base schema first, then run:

```text
supabase_final_polish_security_workflow_patch.sql
```

This patch adds/updates:

- messaging compatibility columns,
- report/logbook review fields,
- deadline type support,
- supervisor max-10-student trigger,
- profile image support,
- performance indexes.

### 4. Start the app

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## Demo Data Recommendation

The safest setup is:

1. Create demo users manually in Supabase Authentication.
2. Run the seed SQL that inserts only app data/profile data.
3. Do not manually insert directly into `auth.users` using SQL.

Use this password for demo accounts if needed:

```text
Password123!
```

---

## Final Security & Quality Measures

- Role-based dashboard protection.
- Role dropdown on login must match actual database role.
- Student email format validation.
- University supervisor email format validation.
- Server-side access checks for messaging, reports, logbooks, deadlines, and assignments.
- Report submission blocked after report deadline.
- University Supervisor-only report grading.
- University Supervisor-only logbook review.
- Organisation-only Industrial Supervisor assignment.
- Coordinator-only University Supervisor assignment.
- Supervisor maximum assignment limit: 10 students.
- File upload validation and signed upload URLs.
- Basic API rate limiting for registration, messages, uploads, and deadlines.
- Security headers added in the local server.

---

## Final Testing Checklist

- Student can register and login with student number email.
- Wrong role selected at login is rejected.
- Organisation can update profile and slots.
- Student can be assigned to organisation.
- Organisation can assign Industrial Supervisor to attached student.
- Coordinator can invite and assign University Supervisor.
- Student sees both assigned supervisors.
- Student messages only assigned supervisors.
- Supervisors message only assigned students.
- University Supervisor creates report deadline.
- Student cannot submit report after deadline.
- University Supervisor can open report file and grade it.
- Industrial Supervisor does not grade final report.
- Coordinator monitors only and does not assess.
- No red console errors during normal role testing.

---

## Background Images

Replace dashboard and landing backgrounds in:

```text
public/assets/backgrounds/
```

Keep the same filenames if you want the project to update automatically.


## Final Polish Notes
- Dashboard deadlines are student-facing only. University supervisors create report/logbook deadlines from the Deadlines page, and students see those deadlines on their dashboard/report pages.
- University supervisors review student logbooks and final reports, open attached report files, add feedback, and grade reports.
- Background images are kept as static assets in `public/assets/backgrounds/` and served with browser caching. For performance, the database should store only image paths/settings, not raw image files.
- Buttons, cards, tables, and forms now share the same UI language across dashboards.
