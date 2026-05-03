// PATCH /api/reports/review
// University supervisor reviews / grades a student's final report.
// Body: { student_id, score (0-100), comments? }
//
// GET /api/reports/review  — list all reports for this supervisor's students
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
async function addSignedUrl(sb, report) {
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

    if (!["university_supervisor", "coordinator"].includes(profile.role))
      return send(res, 403, { ok: false, error: "University supervisor or coordinator monitoring account required" });

    // ---- GET: list reports for supervisor's students or coordinator monitoring ----
    if (req.method === "GET") {
      let student_ids = [];

      if (profile.role === "coordinator") {
        const { data: allStudents } = await sb
          .from("profiles").select("id").eq("role", "student");
        student_ids = (allStudents || []).map(s => s.id);
      } else {
        const { data: assignments } = await sb
          .from("supervisor_assignments")
          .select("student_id")
          .eq("university_supervisor_id", user.id);
        student_ids = (assignments || []).map(a => a.student_id);
      }

      if (student_ids.length === 0)
        return send(res, 200, { ok: true, reports: [] });

      const { data: reports, error } = await sb
        .from("industrial_reports")
        .select("id, student_id, title, content, file_url, score, comments, status, submitted_at, reviewed_at")
        .in("student_id", student_ids)
        .order("submitted_at", { ascending: false });

      if (error) return send(res, 500, { ok: false, error: error.message });

      // Fetch student profiles separately (two-step avoids brittle FK name references)
      const reportStudentIds = [...new Set((reports || []).map(r => r.student_id))];
      let studentMap = {};
      if (reportStudentIds.length > 0) {
        const { data: profs } = await sb
          .from("profiles")
          .select("id, full_name, email")
          .in("id", reportStudentIds);
        (profs || []).forEach(p => { studentMap[p.id] = p; });
      }

      for (const rp of (reports || [])) await addSignedUrl(sb, rp);

      const enriched = (reports || []).map(r => ({
        ...r,
        student: studentMap[r.student_id] || null,
      }));

      return send(res, 200, { ok: true, reports: enriched });
    }

    // ---- PATCH: grade / comment — university supervisors only ----
    if (req.method === "PATCH") {
      if (profile.role !== "university_supervisor")
        return send(res, 403, { ok: false, error: "Only the assigned university supervisor can review reports." });
      const body       = await readBody(req);
      const student_id = String(body.student_id || "").trim();
      const score      = body.score != null ? parseFloat(body.score) : null;
      const comments   = String(body.comments || "").trim() || null;

      if (!student_id) return send(res, 400, { ok: false, error: "student_id is required" });
      if (score === null || isNaN(score) || score < 0 || score > 100) {
        return send(res, 400, { ok: false, error: "A report score between 0 and 100 is required." });
      }

      // Verify assignment
      const { data: assignment } = await sb
        .from("supervisor_assignments")
        .select("id")
        .eq("student_id", student_id)
        .eq("university_supervisor_id", user.id)
        .maybeSingle();
      if (!assignment)
        return send(res, 403, { ok: false, error: "You are not assigned as university supervisor for this student" });

      const updates = {
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        status: "reviewed",
      };
      if (comments !== null) updates.comments = comments;
      if (score    !== null) { updates.score = score; updates.status = "graded"; }

      const { data, error } = await sb
        .from("industrial_reports")
        .update(updates)
        .eq("student_id", student_id)
        .select("*")
        .single();

      if (error) return send(res, 500, { ok: false, error: error.message });

      // Recompute final grade
      if (score !== null)
        await sb.rpc("compute_final_grade", { p_student_id: student_id });

      return send(res, 200, { ok: true, report: data });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
