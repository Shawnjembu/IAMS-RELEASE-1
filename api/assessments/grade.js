// GET /api/assessments/grade?student_id=
// Returns the computed + override grade for a student.
// Also triggers recomputation if scores exist but grade row doesn't.
//
// Accessible by: coordinator, the student themselves, assigned supervisors.
const { adminClient, send, verifyToken } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method Not Allowed" });

    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    const user = await verifyToken(auth).catch(() => null);
    if (!user) return send(res, 401, { ok: false, error: "Invalid token" });

    const sb = adminClient();
    const { data: profile } = await sb
      .from("profiles").select("role").eq("id", user.id).single();
    if (!profile) return send(res, 403, { ok: false, error: "Profile not found" });

    const url = new URL(req.url, "http://localhost");
    const student_id = url.searchParams.get("student_id") || (profile.role === "student" ? user.id : null);

    if (!student_id) return send(res, 400, { ok: false, error: "student_id is required" });

    // Access control: student can only see own grade
    if (profile.role === "student" && student_id !== user.id)
      return send(res, 403, { ok: false, error: "Access denied" });

    // Trigger recompute — wrapped so a missing function doesn't crash the endpoint
    try {
      await sb.rpc("compute_final_grade", { p_student_id: student_id });
    } catch (_) {}

    // Fetch grade — table may not exist yet if v2 migration hasn't run
    let grade = null, report = null, evals = [];
    try {
      const r1 = await sb.from("final_grades").select("*").eq("student_id", student_id).maybeSingle();
      if (!r1.error) grade = r1.data;
    } catch (_) {}
    try {
      const r2 = await sb.from("industrial_reports").select("title, score, status, submitted_at").eq("student_id", student_id).maybeSingle();
      if (!r2.error) report = r2.data;
    } catch (_) {}
    try {
      const r3 = await sb.from("uni_evaluations").select("visit_number, score, comments, visit_date").eq("student_id", student_id).order("visit_number");
      if (!r3.error) evals = r3.data || [];
    } catch (_) {}

    return send(res, 200, { ok: true, grade, report, evaluations: evals });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
