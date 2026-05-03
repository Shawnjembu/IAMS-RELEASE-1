// POST /api/reports/submit
// Student submits (or updates) their final industrial attachment report.
// Body: { title, content?, file_url? }
//
// GET /api/reports/submit  — student fetches their own report
// GET /api/reports/submit?student_id=  — supervisor/coordinator fetches a student's report
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody } = require("../_shared");

const DEFAULT_BUCKET = "iams-attachments";
function extractStoragePath(value, bucket = DEFAULT_BUCKET) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, "");
  try {
    const u = new URL(raw);
    const markers = [`/storage/v1/object/sign/${bucket}/`, `/storage/v1/object/public/${bucket}/`, `/storage/v1/object/authenticated/${bucket}/`];
    for (const marker of markers) {
      const idx = u.pathname.indexOf(marker);
      if (idx >= 0) return decodeURIComponent(u.pathname.slice(idx + marker.length));
    }
  } catch (_) {}
  return null;
}
async function addSignedReportUrl(sb, report) {
  if (!report || !report.file_url) return report;
  const path = extractStoragePath(report.file_url);
  if (!path) return report;
  const { data, error } = await sb.storage.from(DEFAULT_BUCKET).createSignedUrl(path, 60 * 10);
  if (!error && data && data.signedUrl) {
    report.file_storage_path = path;
    report.file_url = data.signedUrl;
  }
  return report;
}



async function getReportDeadline(sb, studentId) {
  // A report deadline is normally created by the assigned university supervisor.
  // The SQL patch adds deadline_type='report'; title fallback keeps older demo data working.
  const { data: assignment } = await sb
    .from("supervisor_assignments")
    .select("university_supervisor_id")
    .eq("student_id", studentId)
    .maybeSingle();
  if (!assignment || !assignment.university_supervisor_id) return null;

  const { data } = await sb
    .from("deadlines")
    .select("id, title, due_date, message, deadline_type, target_student_id, audience_role, created_by")
    .eq("created_by", assignment.university_supervisor_id)
    .not("due_date", "is", null)
    .order("due_date", { ascending: false });

  const rows = (data || []).filter(function (dl) {
    const type = String(dl.deadline_type || "").toLowerCase();
    const title = String(dl.title || "").toLowerCase();
    const isReport = type === "report" || title.includes("report");
    if (!isReport) return false;
    if (dl.target_student_id && dl.target_student_id !== studentId) return false;
    return ["student", "assigned_students", "all", null, undefined].includes(dl.audience_role) || dl.audience_role === "specific_student";
  });
  return rows[0] || null;
}

function isDeadlineClosed(deadline) {
  if (!deadline || !deadline.due_date) return false;
  const end = new Date(deadline.due_date + "T23:59:59");
  return Date.now() > end.getTime();
}

module.exports = async function handler(req, res) {
  try {
    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey    = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey) return send(res, 500, { ok: false, error: "Missing env vars" });
    const userSb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${auth}` } } });
    const { data: authData, error: uerr } = await userSb.auth.getUser();
    if (uerr || !authData || !authData.user) return send(res, 401, { ok: false, error: uerr ? uerr.message : "Invalid token" });
    const user = authData.user;

    const sb = adminClient();
    const { data: profile } = await sb
      .from("profiles").select("role").eq("id", user.id).single();
    if (!profile) return send(res, 403, { ok: false, error: "Profile not found" });

    // ---- GET ----
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const reqStudentId = url.searchParams.get("student_id") || user.id;

      // Students can only see their own
      if (profile.role === "student" && reqStudentId !== user.id)
        return send(res, 403, { ok: false, error: "Access denied" });

      const { data, error } = await sb
        .from("industrial_reports")
        .select("*")
        .eq("student_id", reqStudentId)
        .maybeSingle();

      if (error) return send(res, 500, { ok: false, error: error.message });
      const report_deadline = await getReportDeadline(sb, reqStudentId);
      await addSignedReportUrl(sb, data);
      return send(res, 200, { ok: true, report: data, report_deadline, deadline_closed: isDeadlineClosed(report_deadline) });
    }

    // ---- POST ----
    if (req.method === "POST") {
      if (profile.role !== "student")
        return send(res, 403, { ok: false, error: "Only students can submit reports" });

      const body    = await readBody(req);
      const title   = String(body.title   || "").trim();
      const content = String(body.content || "").trim() || null;
      const file_url = extractStoragePath(body.file_url) || body.file_url || null;

      if (!title || title.length < 5) {
        return send(res, 400, { ok: false, error: "Report title is required and must be at least 5 characters." });
      }
      if (!content && !file_url) {
        return send(res, 400, { ok: false, error: "Provide a report summary or upload a report file before submitting." });
      }

      // Final release rule: only placed students can submit final reports.
      const { data: placement, error: placementErr } = await sb
        .from("placements")
        .select("id")
        .eq("student_id", user.id)
        .eq("status", "assigned")
        .maybeSingle();
      if (placementErr) return send(res, 500, { ok: false, error: placementErr.message });
      if (!placement) {
        return send(res, 403, { ok: false, error: "You must be assigned to an organisation before submitting your final report." });
      }

      // Prevent late submission once a report deadline has passed.
      const reportDeadline = await getReportDeadline(sb, user.id);
      if (isDeadlineClosed(reportDeadline)) {
        return send(res, 403, { ok: false, error: "Report submission is closed. The report deadline has passed." });
      }

      // Prevent re-submission once the report has been graded
      const { data: existing } = await sb
        .from("industrial_reports")
        .select("status")
        .eq("student_id", user.id)
        .maybeSingle();
      if (existing && existing.status === "graded")
        return send(res, 409, { ok: false, error: "Your report has already been graded and cannot be resubmitted." });

      const { data, error } = await sb
        .from("industrial_reports")
        .upsert([{
          student_id:   user.id,
          placement_id: placement ? placement.id : null,
          title,
          content,
          file_url,
          status:       "submitted",
          submitted_at: new Date().toISOString(),
        }], { onConflict: "student_id" })
        .select("*")
        .single();

      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, report: data });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
