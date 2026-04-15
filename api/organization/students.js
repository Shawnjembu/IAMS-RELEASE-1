// GET /api/organization/students — returns students assigned to the calling org
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
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "organization") {
      return send(res, 403, { ok: false, error: "Organisation account required" });
    }

    // Fetch placements for this org — include both "assigned" (manual) and
    // "suggested" (auto-match) so the org sees all linked students.
    // Two-step approach avoids reliance on a specific FK constraint name.
    const { data: placements, error } = await sb
      .from("placements")
      .select("id, status, assigned_at, student_id")
      .eq("org_id", user.id)
      .in("status", ["assigned", "suggested"])
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

    const students = (placements || []).map(p => {
      const sp = profileMap[p.student_id] || {};
      return {
        placement_id:  p.id,
        student_id:    p.student_id,
        status:        p.status,
        full_name:     sp.full_name || "",
        email:         sp.email    || "—",
        assigned_at:   p.assigned_at,
        logbook_count: entryCounts[p.student_id] || 0
      };
    });

    return send(res, 200, { ok: true, students });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
