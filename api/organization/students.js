// GET /api/organization/students — returns students assigned to the calling org
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
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "organization") {
      return send(res, 403, { ok: false, error: "Organisation account required" });
    }

    // Fetch placements for this org. Only confirmed/assigned students appear here,
    // because the organisation can assign industrial supervisors only to students
    // already attached to its organisation.
    const { data: placements, error } = await sb
      .from("placements")
      .select("id, status, assigned_at, student_id")
      .eq("org_id", user.id)
      .eq("status", "assigned")
      .order("assigned_at", { ascending: false });

    if (error) return send(res, 500, { ok: false, error: error.message });

    // Fetch student profiles separately
    const placedStudentIds = (placements || []).map(p => p.student_id);
    let profileMap = {};
    if (placedStudentIds.length > 0) {
      const { data: studentProfiles } = await sb
        .from("profiles")
        .select("id, full_name, email")
        .in("id", placedStudentIds);
      (studentProfiles || []).forEach(p => { profileMap[p.id] = p; });
    }

    // Also grab logbook entry counts per student
    const studentIds = (placements || []).map(p => p.student_id);
    let entryCounts = {};
    if (studentIds.length > 0) {
      const { data: entries } = await sb
        .from("logbook_entries")
        .select("student_id")
        .in("student_id", studentIds);
      (entries || []).forEach(e => {
        entryCounts[e.student_id] = (entryCounts[e.student_id] || 0) + 1;
      });
    }

    // Fetch industrial supervisor assignments so organisation can see which
    // students still need a workplace supervisor.
    let assignmentMap = {};
    let supervisorMap = {};
    if (studentIds.length > 0) {
      const { data: assignments } = await sb
        .from("supervisor_assignments")
        .select("student_id, industrial_supervisor_id, university_supervisor_id")
        .in("student_id", studentIds);
      (assignments || []).forEach(a => { assignmentMap[a.student_id] = a; });
      const supIds = (assignments || []).map(a => a.industrial_supervisor_id).filter(Boolean);
      if (supIds.length > 0) {
        const { data: supProfiles } = await sb
          .from("profiles")
          .select("id, full_name, email")
          .in("id", supIds);
        (supProfiles || []).forEach(s => { supervisorMap[s.id] = s; });
      }
    }

    const students = (placements || []).map(p => {
      const sp = profileMap[p.student_id] || {};
      const assignment = assignmentMap[p.student_id] || null;
      const industrialId = assignment ? assignment.industrial_supervisor_id : null;
      return {
        placement_id:  p.id,
        student_id:    p.student_id,
        status:        p.status,
        full_name:     sp.full_name || "",
        email:         sp.email    || "—",
        assigned_at:   p.assigned_at,
        logbook_count: entryCounts[p.student_id] || 0,
        industrial_supervisor_id: industrialId,
        industrial_supervisor: industrialId ? (supervisorMap[industrialId] || null) : null
      };
    });

    return send(res, 200, { ok: true, students });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
