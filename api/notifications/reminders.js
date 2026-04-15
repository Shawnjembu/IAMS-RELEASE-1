// GET /api/notifications/reminders
// Cron-style endpoint: finds deadlines due within 3 days and returns the list.
// In production, hook this to a scheduled job (Supabase cron, Vercel cron, etc.)
// and integrate an email provider (Resend, SendGrid) to send actual emails.
//
// For now it returns { ok, due_soon: [...] } which you can use to trigger emails
// manually or log to a table.
//
// Secure with a shared secret: caller must pass header X-Cron-Secret matching env CRON_SECRET.
const { adminClient, send } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method Not Allowed" });

    // Simple shared-secret guard (optional — set CRON_SECRET in .env)
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const provided = req.headers["x-cron-secret"] || "";
      if (provided !== secret)
        return send(res, 401, { ok: false, error: "Unauthorized" });
    }

    const sb = adminClient();

    // Deadlines due in the next 3 days
    const now     = new Date();
    const cutoff  = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const today   = now.toISOString().slice(0, 10);
    const maxDate = cutoff.toISOString().slice(0, 10);

    const { data: deadlines, error } = await sb
      .from("deadlines")
      .select("id, title, due_date, audience_role, message")
      .gte("due_date", today)
      .lte("due_date", maxDate)
      .order("due_date");

    if (error) return send(res, 500, { ok: false, error: error.message });
    if (!deadlines || deadlines.length === 0)
      return send(res, 200, { ok: true, due_soon: [], message: "No deadlines due in 3 days" });

    // For each deadline, find the relevant users
    const emailJobs = [];
    for (const dl of deadlines) {
      let rolesFilter = [];
      if (dl.audience_role === "all")       rolesFilter = ["student", "organization", "coordinator"];
      else if (dl.audience_role)            rolesFilter = [dl.audience_role];

      if (rolesFilter.length === 0) continue;

      const { data: users } = await sb
        .from("profiles")
        .select("email, full_name, role")
        .in("role", rolesFilter);

      (users || []).forEach(u => {
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

    // TODO: Replace the stub below with your email provider.
    // Example (Resend):
    //   const resend = new Resend(process.env.RESEND_API_KEY);
    //   for (const job of emailJobs) {
    //     await resend.emails.send({
    //       from: "noreply@yourdomain.com",
    //       to: job.to,
    //       subject: `Reminder: "${job.title}" due on ${job.due}`,
    //       text: `Hi ${job.name},\n\nThis is a reminder that "${job.title}" is due on ${job.due}.\n${job.message}`,
    //     });
    //   }

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
