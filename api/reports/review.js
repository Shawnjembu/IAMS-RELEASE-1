// PATCH /api/reports/review
// Industrial supervisor grades / comments on a student's final report.
// Body: { student_id, score (0-100), comments? }
//
// GET /api/reports/review  — list all reports for this supervisor's students
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody } = require("../_shared");

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

    if (!["industrial_supervisor", "coordinator"].includes(profile.role))
      return send(res, 403, { ok: false, error: "Industrial supervisor or coordinator required" });

    // ---- GET: list reports for supervisor's students ----
    if (req.method === "GET") {
      let student_ids = [];

      if (profile.role === "industrial_supervisor") {
        const { data: assignments } = await sb
          .from("supervisor_assignments")
          .select("student_id")
          .eq("industrial_supervisor_id", user.id);
        student_ids = (assignments || []).map(a => a.student_id);
      } else {
        // Coordinator sees all
        const { data: allStudents } = await sb
          .from("profiles").select("id").eq("role", "student");
        student_ids = (allStudents || []).map(s => s.id);
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

      const enriched = (reports || []).map(r => ({
        ...r,
        student: studentMap[r.student_id] || null,
      }));

      return send(res, 200, { ok: true, reports: enriched });
    }

    // ---- PATCH: grade / comment ----
    if (req.method === "PATCH") {
      const body       = await readBody(req);
      const student_id = String(body.student_id || "").trim();
      const score      = body.score != null ? parseFloat(body.score) : null;
      const comments   = String(body.comments || "").trim() || null;

      if (!student_id) return send(res, 400, { ok: false, error: "student_id is required" });
      if (score != null && (isNaN(score) || score < 0 || score > 100))
        return send(res, 400, { ok: false, error: "score must be between 0 and 100" });

      // Verify assignment
      if (profile.role === "industrial_supervisor") {
        const { data: assignment } = await sb
          .from("supervisor_assignments")
          .select("id")
          .eq("student_id", student_id)
          .eq("industrial_supervisor_id", user.id)
          .maybeSingle();
        if (!assignment)
          return send(res, 403, { ok: false, error: "You are not assigned as industrial supervisor for this student" });
      }

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
