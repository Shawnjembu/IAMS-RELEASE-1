// GET /api/supervisor/my-students
// Returns all students assigned to the calling supervisor (industrial or university).
// Includes placement, logbook count, report status, grade.
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method Not Allowed" });

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

    if (!profile || !["industrial_supervisor", "university_supervisor"].includes(profile.role))
      return send(res, 403, { ok: false, error: "Supervisor account required" });

    const isIndustrial = profile.role === "industrial_supervisor";
    const field        = isIndustrial ? "industrial_supervisor_id" : "university_supervisor_id";

    // Find all assignments for this supervisor
    const { data: assignments, error: aErr } = await sb
      .from("supervisor_assignments")
      .select("student_id, placement_id")
      .eq(field, user.id);

    if (aErr) return send(res, 500, { ok: false, error: aErr.message });
    if (!assignments || assignments.length === 0)
      return send(res, 200, { ok: true, students: [] });

    const studentIds = assignments.map(a => a.student_id);

    // Fetch student profiles
    const { data: students } = await sb
      .from("profiles")
      .select("id, full_name, email")
      .in("id", studentIds);

    const { data: extras } = await sb
      .from("student_profiles")
      .select("id, program, year_of_study, student_number")
      .in("id", studentIds);

    // Logbook counts
    const { data: logbooks } = await sb
      .from("logbook_entries")
      .select("student_id, status")
      .in("student_id", studentIds);

    // Industrial reports
    const { data: reports } = await sb
      .from("industrial_reports")
      .select("student_id, status, score")
      .in("student_id", studentIds);

    // Uni evaluations
    const { data: evals } = await sb
      .from("uni_evaluations")
      .select("student_id, visit_number, score")
      .in("student_id", studentIds);

    // Final grades
    const { data: grades } = await sb
      .from("final_grades")
      .select("student_id, final_grade, letter_grade")
      .in("student_id", studentIds);

    // Build maps
    const extrasMap   = {};
    (extras   || []).forEach(e => { extrasMap[e.id] = e; });
    const logMap      = {};
    (logbooks || []).forEach(l => {
      if (!logMap[l.student_id]) logMap[l.student_id] = { total: 0, reviewed: 0 };
      logMap[l.student_id].total++;
      if (l.status === "reviewed") logMap[l.student_id].reviewed++;
    });
    const reportMap   = {};
    (reports  || []).forEach(r => { reportMap[r.student_id] = r; });
    const evalMap     = {};
    (evals    || []).forEach(e => {
      if (!evalMap[e.student_id]) evalMap[e.student_id] = {};
      evalMap[e.student_id][e.visit_number] = e.score;
    });
    const gradeMap    = {};
    (grades   || []).forEach(g => { gradeMap[g.student_id] = g; });
    const assignMap   = {};
    assignments.forEach(a => { assignMap[a.student_id] = a.placement_id; });

    const result = (students || []).map(s => ({
      student_id:   s.id,
      full_name:    s.full_name,
      email:        s.email,
      placement_id: assignMap[s.id],
      extra:        extrasMap[s.id] || null,
      logbooks:     logMap[s.id] || { total: 0, reviewed: 0 },
      report:       reportMap[s.id] || null,
      evaluations:  evalMap[s.id] || {},
      grade:        gradeMap[s.id] || null,
    }));

    return send(res, 200, { ok: true, students: result });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
