// GET /api/notifications/reminders
// Finds deadlines due within 3 days and returns reminder recipients.
// Secure with X-Cron-Secret matching env CRON_SECRET when CRON_SECRET is set.
const { adminClient, send } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method Not Allowed" });

    const secret = process.env.CRON_SECRET;
    if (secret) {
      const provided = req.headers["x-cron-secret"] || "";
      if (provided !== secret) return send(res, 401, { ok: false, error: "Unauthorized" });
    }

    const sb = adminClient();
    const now     = new Date();
    const cutoff  = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const today   = now.toISOString().slice(0, 10);
    const maxDate = cutoff.toISOString().slice(0, 10);

    const { data: deadlines, error } = await sb
      .from("deadlines")
      .select("id, title, due_date, audience_role, target_student_id, message")
      .gte("due_date", today)
      .lte("due_date", maxDate)
      .order("due_date");

    if (error) return send(res, 500, { ok: false, error: error.message });
    if (!deadlines || deadlines.length === 0)
      return send(res, 200, { ok: true, due_soon: [], message: "No deadlines due in 3 days" });

    const { data: assignedRows } = await sb
      .from("placements")
      .select("student_id")
      .eq("status", "assigned");
    const assignedStudentIds = [...new Set((assignedRows || []).map(p => p.student_id))];

    const emailJobs = [];
    for (const dl of deadlines) {
      let users = [];

      if (dl.target_student_id) {
        const { data } = await sb
          .from("profiles")
          .select("id, email, full_name, role")
          .eq("id", dl.target_student_id)
          .single();
        users = data ? [data] : [];
      } else if (dl.audience_role === "assigned_students" || dl.audience_role === "student") {
        if (assignedStudentIds.length > 0) {
          const { data } = await sb
            .from("profiles")
            .select("id, email, full_name, role")
            .in("id", assignedStudentIds);
          users = data || [];
        }
      } else {
        let rolesFilter = [];
        if (dl.audience_role === "all") {
          rolesFilter = ["student", "organization", "coordinator", "industrial_supervisor", "university_supervisor"];
        } else if (dl.audience_role) {
          rolesFilter = [dl.audience_role];
        }

        if (rolesFilter.length > 0) {
          const { data } = await sb
            .from("profiles")
            .select("id, email, full_name, role")
            .in("role", rolesFilter);
          users = data || [];
        }
      }

      users.forEach(u => {
        emailJobs.push({
          to:      u.email,
          name:    u.full_name || u.email,
          role:    u.role,
          title:   dl.title,
          due:     dl.due_date,
          message: dl.message || "",
        });
      });
    }

    return send(res, 200, {
      ok: true,
      due_soon:    deadlines,
      email_jobs:  emailJobs.length,
      recipients:  emailJobs,
      note: "Email sending not configured. Integrate an email provider to send actual emails.",
    });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
