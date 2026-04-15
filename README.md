# IAMS — Industrial Attachment Management System

[![CI341 Test 2 Project](https://img.shields.io/badge/CSI341-Test2-Project-brightgreen)](https://github.com/yirsawa)

Vercel-ready: HTML/CSS/Vanilla JS frontend · Vercel serverless `/api` · Supabase (Auth + Postgres)

## Team Members
- (Add your team members here)

## Lecturer
- **Yirsawa Sarapirome** (@yirsawa)

## Roles
| Role | Access |
|---|---|
| **student** | Profile, placement status, logbook, evaluations |
| **organization** | Org profile, intern slots, assigned students |
| **coordinator** | All students + orgs, matching, placements, deadlines |

## Setup

### 1. Database
Run `supabase_iams.sql` in **Supabase Dashboard → SQL Editor**.

### 2. Environment variables
Set in Vercel **Project → Settings → Environment Variables** (and locally in `.env`):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=   # server-side only — never in frontend JS
SUPABASE_PUBLISHABLE_KEY=    # safe for frontend
```

### 3. Local development
```bash
npm install
cp .env.example .env   # fill real values
npx vercel dev
```

Open http://localhost:3000

## API routes
```
GET  /api/health            — liveness check
POST /api/profile/init      — create profile row after signup (service role)
GET  /api/profile/me        — current user profile + role details (Bearer token)
POST /api/profile/update    — update own profile (Bearer token)
```

## Pages
```
/                       — landing page
/auth.html              — sign in / register
/dashboard.html         — role-aware dashboard
/student-profile.html   — student profile editor
/org-profile.html       — organisation profile editor
/coordinator.html       — coordinator panel
```
