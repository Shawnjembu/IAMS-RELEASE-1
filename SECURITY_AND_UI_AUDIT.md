# IAMS Final Polish Audit

## Final workflow confirmed

1. Student registers using `studentnumber@ub.co.bw`.
2. Student completes profile and selects/receives an organisation placement.
3. Organisation receives attached students and assigns them to its own Industrial Supervisors.
4. Coordinator invites University Supervisors using `name@ub.ac.bw` and assigns students to them.
5. Student has exactly two supervisor relationships in normal use: one Industrial Supervisor and one University Supervisor.
6. Industrial Supervisor provides workplace guidance and messaging support.
7. University Supervisor creates student submission deadlines, reviews logbooks, opens report files, gives report feedback, and records visit evaluations.
8. Coordinator monitors placement workflow and communicates with organisations/university supervisors. Coordinator does not grade reports and does not create student submission deadlines.

## Security measures added or confirmed

- Protected routes check active Supabase session before loading dashboards.
- Login includes a role selector and validates that the selected role matches the actual role stored in `profiles`.
- Server adds security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a compatible Content Security Policy.
- API payload size guard blocks oversized JSON requests.
- Basic local/demo rate limiting added for registration, messaging, uploads, and deadline creation.
- Message API filters contacts by assignment relationship so users cannot message unrelated users through the UI/API.
- Report review API allows only the assigned University Supervisor to grade/review reports.
- Logbook review API allows only the assigned University Supervisor to review logbooks.
- Report submission is blocked after the assigned report deadline passes.
- File upload signing validates authenticated users and stores uploads under the user's own folder.
- Supervisor assignment trigger limits each supervisor to 10 assigned students.

## UI/UX polish added

- Consistent button styling and icon-badge button support.
- Softer dashboard background overlays for better readability.
- Cleaner cards, tables, empty states, forms, badges, and status pills.
- Login/register page strengthened with role selection and clear validation text.
- Student report page now clearly shows the report submission deadline and disabled state after deadline closure.
- Industrial Supervisor dashboard now avoids misleading grading/review controls and focuses on workplace guidance.

## Rate limits used in the local Node server

| Area | Limit |
|---|---:|
| Registration | 5 per hour per IP |
| Messaging | 30 messages per minute per IP |
| Upload signing | 10 per hour per IP |
| Deadline creation | 30 per hour per IP |

For true public hosting, replace the in-memory limiter with Redis, Supabase Edge middleware, or reverse-proxy rate limiting.

## Final testing checklist

- [ ] Student login with correct role works.
- [ ] Student login with wrong role is rejected.
- [ ] Organisation can assign attached students to active Industrial Supervisors.
- [ ] Coordinator can assign students to University Supervisors.
- [ ] Student sees only assigned supervisors in Messages.
- [ ] Supervisors see only assigned students in Messages.
- [ ] University Supervisor can create a report deadline.
- [ ] Student can submit report before deadline.
- [ ] Student cannot submit report after deadline.
- [ ] University Supervisor can open/download report file and grade it.
- [ ] Industrial Supervisor dashboard has no grading form.
- [ ] Coordinator cannot create student deadlines or grade reports.
- [ ] No red console errors appear during normal testing.
- [ ] Background images remain readable on all dashboards.
