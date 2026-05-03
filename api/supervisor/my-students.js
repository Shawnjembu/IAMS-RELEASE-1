// GET /api/supervisor/my-students
// Returns all students assigned to the calling supervisor (industrial or university).
// Important workflow rule: organisation assigns attached students to its own
// industrial supervisors; coordinator/university side assigns university supervisors.
// Includes placement, logbook count, report status, grade, and supervisor organisation.
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send } = require("../_shared");

const DEFAULT_BUCKET = "iams-attachments";
function extractStoragePath(value, bucket = DEFAULT_BUCKET) {
  if (!value) return null;
  const raw = String(value || "").trim();
  if (!raw) return null;
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

    let supervisorProfile = null;
    let supervisorOrg = null;
    const supRes = await sb.from("supervisor_profiles").select("org_id, department, phone").eq("id", user.id).maybeSingle();
    supervisorProfile = supRes.data || null;
    if (isIndustrial && supervisorProfile && supervisorProfile.org_id) {
      const [orgExtraRes, orgProfileRes] = await Promise.all([
        sb.from("organization_profiles").select("org_name, location, slots").eq("id", supervisorProfile.org_id).maybeSingle(),
        sb.from("profiles").select("full_name,email").eq("id", supervisorProfile.org_id).maybeSingle(),
      ]);
      supervisorOrg = (orgExtraRes.data && (orgExtraRes.data.org_name || orgExtraRes.data.location || orgExtraRes.data.slots != null))
        ? Object.assign({ id: supervisorProfile.org_id }, orgExtraRes.data)
        : { id: supervisorProfile.org_id };
      if (!supervisorOrg.org_name && orgProfileRes.data) supervisorOrg.org_name = orgProfileRes.data.full_name || orgProfileRes.data.email;
      if (orgProfileRes.data) supervisorOrg.email = orgProfileRes.data.email;
    }

    // Find all assignments for this supervisor
    const { data: assignments, error: aErr } = await sb
      .from("supervisor_assignments")
      .select("student_id, placement_id")
      .eq(field, user.id);

    if (aErr) return send(res, 500, { ok: false, error: aErr.message });
    if (!assignments || assignments.length === 0)
      return send(res, 200, {
        ok: true,
        students: [],
        supervisor: { role: profile.role, organization: supervisorOrg, profile: supervisorProfile }
      });

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
      .select("student_id, title, content, file_url, status, score, comments, submitted_at, reviewed_at")
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
    for (const rp of (reports || [])) await addSignedUrl(sb, rp);
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

    return send(res, 200, { ok: true, students: result, supervisor: { role: profile.role, organization: supervisorOrg, profile: supervisorProfile } });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
