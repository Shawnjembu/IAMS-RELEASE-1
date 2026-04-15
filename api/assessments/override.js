// POST /api/assessments/override
// Coordinator overrides a student's final grade.
// Body: { student_id, override_grade (0-100), override_reason? }
const { adminClient, send, readBody, verifyToken } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" });

    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    const user = await verifyToken(auth).catch(() => null);
    if (!user) return send(res, 401, { ok: false, error: "Invalid token" });

    const sb = adminClient();
    const { data: profile } = await sb
      .from("profiles").select("role").eq("id", user.id).single();

    if (!profile || profile.role !== "coordinator")
      return send(res, 403, { ok: false, error: "Coordinator account required" });

    const body           = await readBody(req);
    const student_id     = String(body.student_id     || "").trim();
    const override_grade = parseFloat(body.override_grade);
    const override_reason= String(body.override_reason || "").trim() || null;

    if (!student_id)
      return send(res, 400, { ok: false, error: "student_id is required" });
    if (isNaN(override_grade) || override_grade < 0 || override_grade > 100)
      return send(res, 400, { ok: false, error: "override_grade must be between 0 and 100" });

    const letter_grade = override_grade >= 75 ? "A"
                       : override_grade >= 65 ? "B"
                       : override_grade >= 55 ? "C"
                       : override_grade >= 45 ? "D"
                       : "F";

    // Ensure a grade row exists first (recompute)
    await sb.rpc("compute_final_grade", { p_student_id: student_id });

    const { data, error } = await sb
      .from("final_grades")
      .update({
        override_grade,
        override_reason,
        final_grade:   override_grade,
        letter_grade,
        overridden_by: user.id,
        overridden_at: new Date().toISOString(),
      })
      .eq("student_id", student_id)
      .select("*")
      .single();

    if (error) return send(res, 500, { ok: false, error: error.message });
    return send(res, 200, { ok: true, grade: data });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
