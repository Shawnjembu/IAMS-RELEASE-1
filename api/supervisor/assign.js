// POST /api/supervisor/assign
// Coordinator assigns industrial + university supervisors to a student's placement.
// Body: { placement_id, student_id, industrial_supervisor_id?, university_supervisor_id? }
//
// GET /api/supervisor/assign?student_id=
// Returns the current supervisor assignment for a student.
const { adminClient, send, readBody, verifyToken } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    const user = await verifyToken(auth).catch(() => null);
    if (!user) return send(res, 401, { ok: false, error: "Invalid token" });

    const sb = adminClient();
    const { data: profile } = await sb
      .from("profiles").select("role").eq("id", user.id).single();

    if (!profile || profile.role !== "coordinator")
      return send(res, 403, { ok: false, error: "Coordinator account required" });

    // ---- GET: fetch assignment for a student ----
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const student_id = url.searchParams.get("student_id");
      if (!student_id) return send(res, 400, { ok: false, error: "student_id query param required" });

      const { data, error } = await sb
        .from("supervisor_assignments")
        .select("id, placement_id, student_id, assigned_at, industrial_supervisor_id, university_supervisor_id")
        .eq("student_id", student_id)
        .maybeSingle();

      if (error) return send(res, 500, { ok: false, error: error.message });

      // Enrich with supervisor profile data (two-step avoids brittle FK name references)
      let enriched = data ? { ...data } : null;
      if (enriched) {
        const supIds = [enriched.industrial_supervisor_id, enriched.university_supervisor_id].filter(Boolean);
        if (supIds.length > 0) {
          const { data: supProfiles } = await sb
            .from("profiles")
            .select("id, full_name, email")
            .in("id", supIds);
          const supMap = {};
          (supProfiles || []).forEach(p => { supMap[p.id] = p; });
          enriched.ind_sup = enriched.industrial_supervisor_id ? (supMap[enriched.industrial_supervisor_id] || null) : null;
          enriched.uni_sup = enriched.university_supervisor_id ? (supMap[enriched.university_supervisor_id] || null) : null;
        }
      }
      return send(res, 200, { ok: true, assignment: enriched });
    }

    // ---- POST: upsert assignment ----
    if (req.method === "POST") {
      const body = await readBody(req);
      const placement_id             = String(body.placement_id || "").trim();
      const student_id               = String(body.student_id   || "").trim();
      const industrial_supervisor_id = body.industrial_supervisor_id || null;
      const university_supervisor_id = body.university_supervisor_id || null;

      if (!placement_id) return send(res, 400, { ok: false, error: "placement_id is required" });
      if (!student_id)   return send(res, 400, { ok: false, error: "student_id is required" });

      // Validate supervisor roles if provided
      if (industrial_supervisor_id) {
        const { data: sp } = await sb.from("profiles").select("role").eq("id", industrial_supervisor_id).single();
        if (!sp || sp.role !== "industrial_supervisor")
          return send(res, 400, { ok: false, error: "industrial_supervisor_id must be an industrial supervisor" });
      }
      if (university_supervisor_id) {
        const { data: up } = await sb.from("profiles").select("role").eq("id", university_supervisor_id).single();
        if (!up || up.role !== "university_supervisor")
          return send(res, 400, { ok: false, error: "university_supervisor_id must be a university supervisor" });
      }

      const row = {
        placement_id,
        student_id,
        industrial_supervisor_id,
        university_supervisor_id,
        assigned_by: user.id,
        assigned_at: new Date().toISOString(),
      };

      const { data, error } = await sb
        .from("supervisor_assignments")
        .upsert([row], { onConflict: "placement_id" })
        .select("*")
        .single();

      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, assignment: data });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
