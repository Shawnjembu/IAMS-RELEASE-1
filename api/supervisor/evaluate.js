// POST /api/supervisor/evaluate
// University supervisor submits or updates a visit evaluation.
// Body: { student_id, visit_number (1|2), score (0-100), comments?, visit_date? }
//
// GET /api/supervisor/evaluate?student_id=
// Returns evaluations for a student (supervisor or coordinator).
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

    // ---- GET ----
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const student_id = url.searchParams.get("student_id");
      if (!student_id) return send(res, 400, { ok: false, error: "student_id required" });

      const { data, error } = await sb
        .from("uni_evaluations")
        .select("*")
        .eq("student_id", student_id)
        .order("visit_number");

      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, evaluations: data || [] });
    }

    // ---- POST ----
    if (req.method === "POST") {
      if (!["university_supervisor", "coordinator"].includes(profile.role))
        return send(res, 403, { ok: false, error: "University supervisor account required" });

      const body        = await readBody(req);
      const student_id  = String(body.student_id   || "").trim();
      const visit_number= parseInt(body.visit_number, 10);
      const score       = parseFloat(body.score);
      const comments    = String(body.comments || "").trim() || null;
      const visit_date  = body.visit_date || null;

      if (!student_id)               return send(res, 400, { ok: false, error: "student_id is required" });
      if (![1,2].includes(visit_number)) return send(res, 400, { ok: false, error: "visit_number must be 1 or 2" });
      if (isNaN(score) || score < 0 || score > 100)
        return send(res, 400, { ok: false, error: "score must be between 0 and 100" });

      // Prevent overwriting an already-submitted evaluation
      const { data: existingEval } = await sb
        .from("uni_evaluations")
        .select("id")
        .eq("student_id", student_id)
        .eq("visit_number", visit_number)
        .maybeSingle();
      if (existingEval)
        return send(res, 409, { ok: false, error: "Visit " + visit_number + " evaluation has already been submitted and cannot be changed." });

      // Verify this supervisor is assigned to this student
      if (profile.role === "university_supervisor") {
        const { data: assignment } = await sb
          .from("supervisor_assignments")
          .select("id")
          .eq("student_id", student_id)
          .eq("university_supervisor_id", user.id)
          .maybeSingle();
        if (!assignment)
          return send(res, 403, { ok: false, error: "You are not assigned as university supervisor for this student" });
      }

      const { data, error } = await sb
        .from("uni_evaluations")
        .insert([{
          student_id,
          supervisor_id: user.id,
          visit_number,
          score,
          comments,
          visit_date,
        }])
        .select("*")
        .single();

      if (error) return send(res, 500, { ok: false, error: error.message });

      // Recompute final grade
      await sb.rpc("compute_final_grade", { p_student_id: student_id });

      return send(res, 200, { ok: true, evaluation: data });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
