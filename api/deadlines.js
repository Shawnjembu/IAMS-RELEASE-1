// GET  /api/deadlines
// POST /api/deadlines  — supervisors create deadlines for reports/submittables
// DELETE /api/deadlines?id=... — coordinator cleanup (optional admin action)
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody, rateLimit } = require("./_shared");

async function getStudentPlacement(sb, studentId) {
  const { data } = await sb
    .from("placements")
    .select("id, student_id, org_id, status")
    .eq("student_id", studentId)
    .eq("status", "assigned")
    .maybeSingle();
  return data || null;
}

async function getSupervisorIdsForStudent(sb, studentId) {
  const { data } = await sb
    .from("supervisor_assignments")
    .select("industrial_supervisor_id, university_supervisor_id")
    .eq("student_id", studentId)
    .maybeSingle();
  const ids = [];
  if (data && data.industrial_supervisor_id) ids.push(data.industrial_supervisor_id);
  if (data && data.university_supervisor_id) ids.push(data.university_supervisor_id);
  return ids;
}

module.exports = async function handler(req, res) {
  try {
    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey) return send(res, 500, { ok: false, error: "Missing env vars" });

    const userSb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${auth}` } }
    });
    const { data: authData, error: uerr } = await userSb.auth.getUser();
    if (uerr || !authData || !authData.user) return send(res, 401, { ok: false, error: uerr ? uerr.message : "Invalid token" });
    const user = authData.user;

    const sb = adminClient();
    const { data: callerProfile } = await sb.from("profiles").select("id, role").eq("id", user.id).single();
    if (!callerProfile) return send(res, 403, { ok: false, error: "Profile not found" });

    if (req.method === "GET") {
      const role = callerProfile.role || "student";
      const placement = role === "student" ? await getStudentPlacement(sb, user.id) : null;
      const isAssignedStudent = !!(placement && placement.org_id);

      let query = sb
        .from("deadlines")
        .select("id, title, due_date, audience_role, target_student_id, message, deadline_type, created_at, created_by")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (role === "student") {
        const visibility = [`target_student_id.eq.${user.id}`];
        if (isAssignedStudent) visibility.push("audience_role.eq.student", "audience_role.eq.assigned_students", "audience_role.eq.all");
        query = query.or(visibility.join(","));
      } else if (["industrial_supervisor", "university_supervisor"].includes(role)) {
        query = query.or(`audience_role.eq.${role},created_by.eq.${user.id}`);
      } else {
        query = query.or(`audience_role.eq.${role},audience_role.eq.all`);
      }

      const { data, error } = await query;
      if (error) {
        if (error.message && (error.message.includes("does not exist") || error.message.includes("target_student_id"))) {
          return send(res, 200, { ok: true, deadlines: [] });
        }
        return send(res, 500, { ok: false, error: error.message });
      }

      let visible = data || [];
      if (role === "student") {
        const supervisorIds = await getSupervisorIdsForStudent(sb, user.id);
        visible = visible.filter(function (dl) {
          if (dl.target_student_id === user.id) return true;
          if (!isAssignedStudent) return false;
          return supervisorIds.includes(dl.created_by);
        });
      }

      return send(res, 200, { ok: true, deadlines: visible, assigned_student: isAssignedStudent });
    }

    if (req.method === "POST") {
      if (!rateLimit(req, res, "deadline-create", 30, 60 * 60 * 1000)) return;
      if (callerProfile.role !== "university_supervisor") {
        return send(res, 403, { ok: false, error: "Only university supervisors can create student submission deadlines." });
      }

      const body = await readBody(req);
      const title = String(body.title || "").trim();
      const due_date = String(body.due_date || "").trim() || null;
      const audience_role = String(body.audience_role || "assigned_students").trim();
      const target_student_id = String(body.target_student_id || "").trim() || null;
      const message = String(body.message || "").trim() || null;
      const deadline_type = String(body.deadline_type || "report").trim().toLowerCase();

      const allowedAudiences = ["student", "assigned_students", "specific_student", callerProfile.role];
      if (!title) return send(res, 400, { ok: false, error: "Title is required" });
      if (!["report", "logbook", "other"].includes(deadline_type)) return send(res, 400, { ok: false, error: "Invalid deadline type" });
      if (!allowedAudiences.includes(audience_role)) return send(res, 400, { ok: false, error: "Invalid audience for your role" });
      if (audience_role === "specific_student" && !target_student_id) return send(res, 400, { ok: false, error: "Select a student for a specific-student deadline" });

      if (target_student_id) {
        const { data: assignment } = await sb
          .from("supervisor_assignments")
          .select("student_id, industrial_supervisor_id, university_supervisor_id")
          .eq("student_id", target_student_id)
          .maybeSingle();
        const allowed = assignment && (assignment.industrial_supervisor_id === user.id || assignment.university_supervisor_id === user.id);
        if (!allowed) return send(res, 403, { ok: false, error: "You can only create deadlines for students assigned to you." });
      }

      const row = {
        title,
        due_date,
        audience_role: audience_role === "specific_student" ? "student" : audience_role,
        target_student_id: audience_role === "specific_student" ? target_student_id : null,
        message,
        deadline_type,
        created_by: user.id
      };

      const { data, error } = await sb.from("deadlines").insert([row]).select("*").single();
      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, deadline: data });
    }

    if (req.method === "DELETE") {
      if (callerProfile.role !== "coordinator") return send(res, 403, { ok: false, error: "Coordinator account required" });
      const url = new URL(req.url, "http://localhost");
      const id = String(url.searchParams.get("id") || "").trim();
      if (!id) return send(res, 400, { ok: false, error: "Deadline id is required" });
      const { error } = await sb.from("deadlines").delete().eq("id", id);
      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
