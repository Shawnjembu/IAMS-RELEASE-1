// POST /api/supervisor/assign
// Assignment workflow:
// - Organisation assigns attached students to its own industrial supervisors.
// - Coordinator/university side assigns university supervisors only.
// Body: { placement_id, student_id, industrial_supervisor_id?, university_supervisor_id? }
//
// GET /api/supervisor/assign?student_id=
// Returns the current supervisor assignment for a student.
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
      .from("profiles").select("id, role").eq("id", user.id).single();

    if (!profile || !["coordinator", "organization"].includes(profile.role))
      return send(res, 403, { ok: false, error: "Coordinator or organisation account required" });

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

      const { data: placement } = await sb
        .from("placements")
        .select("id, student_id, org_id, status")
        .eq("id", placement_id)
        .maybeSingle();
      if (!placement || placement.student_id !== student_id) {
        return send(res, 400, { ok: false, error: "Placement/student mismatch." });
      }

      let finalIndustrialId = industrial_supervisor_id;
      let finalUniversityId = university_supervisor_id;

      const { data: existingAssignment } = await sb
        .from("supervisor_assignments")
        .select("industrial_supervisor_id, university_supervisor_id")
        .eq("placement_id", placement_id)
        .maybeSingle();

      if (profile.role === "organization") {
        if (placement.org_id !== user.id) {
          return send(res, 403, { ok: false, error: "You can only assign industrial supervisors to students attached to your organisation." });
        }
        if (!industrial_supervisor_id) {
          return send(res, 400, { ok: false, error: "Choose an industrial supervisor." });
        }
        if (university_supervisor_id) {
          return send(res, 403, { ok: false, error: "Organisations cannot assign university supervisors." });
        }
        // Organisation controls only the industrial supervisor. Preserve any university supervisor.
        finalUniversityId = existingAssignment ? existingAssignment.university_supervisor_id : null;
      } else {
        // Coordinator/university side controls university supervisor assignment only.
        // The industrial supervisor must be assigned by the organisation.
        if (industrial_supervisor_id && (!existingAssignment || industrial_supervisor_id !== existingAssignment.industrial_supervisor_id)) {
          return send(res, 403, { ok: false, error: "Industrial supervisors are assigned by the organisation, not the coordinator." });
        }
        if (!university_supervisor_id) {
          return send(res, 400, { ok: false, error: "Choose a university supervisor." });
        }
        finalIndustrialId = existingAssignment ? existingAssignment.industrial_supervisor_id : null;
        finalUniversityId = university_supervisor_id;
      }

      // Validate supervisor roles if provided
      if (finalIndustrialId) {
        const { data: sp } = await sb.from("profiles").select("role").eq("id", finalIndustrialId).single();
        if (!sp || sp.role !== "industrial_supervisor")
          return send(res, 400, { ok: false, error: "industrial_supervisor_id must be an industrial supervisor" });

        const { data: supExtra } = await sb.from("supervisor_profiles").select("org_id").eq("id", finalIndustrialId).maybeSingle();
        if (profile.role === "organization" && (!supExtra || supExtra.org_id !== user.id)) {
          return send(res, 403, { ok: false, error: "This supervisor does not belong to your organisation." });
        }
        // One industrial supervisor can supervise more than one student, but not more than 10 at a time.
        // Exclude this placement when updating an existing assignment so re-saving does not count against itself.
        const { count: indCount, error: indCountErr } = await sb
          .from("supervisor_assignments")
          .select("id", { count: "exact", head: true })
          .eq("industrial_supervisor_id", finalIndustrialId)
          .neq("placement_id", placement_id);
        if (indCountErr) return send(res, 500, { ok: false, error: indCountErr.message });
        if ((indCount || 0) >= 10) {
          return send(res, 400, { ok: false, error: "This industrial supervisor already has 10 students assigned. Choose another supervisor." });
        }
      }
      if (finalUniversityId) {
        const { data: up } = await sb.from("profiles").select("role").eq("id", finalUniversityId).single();
        if (!up || up.role !== "university_supervisor")
          return send(res, 400, { ok: false, error: "university_supervisor_id must be a university supervisor" });
        // One university supervisor can also supervise up to 10 students at a time.
        const { count: uniCount, error: uniCountErr } = await sb
          .from("supervisor_assignments")
          .select("id", { count: "exact", head: true })
          .eq("university_supervisor_id", finalUniversityId)
          .neq("placement_id", placement_id);
        if (uniCountErr) return send(res, 500, { ok: false, error: uniCountErr.message });
        if ((uniCount || 0) >= 10) {
          return send(res, 400, { ok: false, error: "This university supervisor already has 10 students assigned. Choose another supervisor." });
        }
      }

      const row = {
        placement_id,
        student_id,
        industrial_supervisor_id: finalIndustrialId,
        university_supervisor_id: finalUniversityId,
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
