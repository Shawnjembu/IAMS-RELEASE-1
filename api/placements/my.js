// GET  /api/placements/my  — returns the calling student's placement, plus selectable organisations when unplaced
// POST /api/placements/my  — student chooses an organisation with free slots { org_id }
const { adminClient, send, readBody } = require("../_shared");
const { createClient }       = require("@supabase/supabase-js");

async function getAuthUser(req) {
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return { error: "Missing auth token" };
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey    = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !anonKey) return { error: "Missing env vars", status: 500 };
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${auth}` } }
  });
  const { data: authData, error: uerr } = await userClient.auth.getUser();
  if (uerr || !authData || !authData.user) return { error: "Invalid token" };
  return { user: authData.user };
}

async function getAvailableOrgs(sb) {
  const [orgsRes, orgExtrasRes, placementsRes] = await Promise.all([
    sb.from("profiles").select("id, full_name, email").eq("role", "organization").order("full_name"),
    sb.from("organization_profiles").select("id, org_name, industry, required_skills, location, slots, contact_person, phone"),
    sb.from("placements").select("org_id,status").eq("status", "assigned"),
  ]);
  if (orgsRes.error) throw orgsRes.error;

  const extraMap = {};
  (orgExtrasRes.data || []).forEach(e => { extraMap[e.id] = e; });
  const loadMap = {};
  (placementsRes.data || []).forEach(p => { if (p.org_id) loadMap[p.org_id] = (loadMap[p.org_id] || 0) + 1; });

  return (orgsRes.data || []).map(o => {
    const extra = extraMap[o.id] || {};
    const slots = extra.slots != null ? Number(extra.slots) : 0;
    const current_students = loadMap[o.id] || 0;
    const available_slots = slots > 0 ? Math.max(0, slots - current_students) : 0;
    return {
      id: o.id,
      full_name: o.full_name,
      email: o.email,
      org_name: extra.org_name || o.full_name || o.email,
      location: extra.location || "",
      industry: extra.industry || "",
      required_skills: extra.required_skills || "",
      contact_person: extra.contact_person || "",
      phone: extra.phone || "",
      slots,
      current_students,
      available_slots,
      can_choose: available_slots > 0,
    };
  }).filter(o => o.can_choose);
}

async function enrichPlacement(sb, placement, studentId) {
  let enriched = placement ? { ...placement } : null;
  if (enriched && enriched.org_id) {
    const { data: orgProfile } = await sb
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", enriched.org_id)
      .maybeSingle();

    const { data: orgProfileExtra } = await sb
      .from("organization_profiles")
      .select("org_name, location, contact_person, phone")
      .eq("id", enriched.org_id)
      .maybeSingle();

    enriched.org = orgProfile ? { ...orgProfile, extra: orgProfileExtra || null } : null;
  }

  if (enriched) {
    const { data: assignment } = await sb
      .from("supervisor_assignments")
      .select("id, placement_id, student_id, industrial_supervisor_id, university_supervisor_id, assigned_at")
      .eq("student_id", studentId)
      .maybeSingle();

    if (assignment) {
      const supIds = [assignment.industrial_supervisor_id, assignment.university_supervisor_id].filter(Boolean);
      const supMap = {};
      const supExtraMap = {};

      if (supIds.length > 0) {
        const { data: supProfiles } = await sb
          .from("profiles")
          .select("id, full_name, email, role")
          .in("id", supIds);
        (supProfiles || []).forEach(p => { supMap[p.id] = p; });

        const { data: supExtras } = await sb
          .from("supervisor_profiles")
          .select("id, department, specialization, phone")
          .in("id", supIds);
        (supExtras || []).forEach(p => { supExtraMap[p.id] = p; });
      }

      enriched.supervisors = {
        industrial: assignment.industrial_supervisor_id
          ? { ...(supMap[assignment.industrial_supervisor_id] || {}), extra: supExtraMap[assignment.industrial_supervisor_id] || null }
          : null,
        university: assignment.university_supervisor_id
          ? { ...(supMap[assignment.university_supervisor_id] || {}), extra: supExtraMap[assignment.university_supervisor_id] || null }
          : null,
        assigned_at: assignment.assigned_at || null,
      };
    } else {
      enriched.supervisors = { industrial: null, university: null, assigned_at: null };
    }
  }
  return enriched;
}

module.exports = async function handler(req, res) {
  try {
    if (!["GET", "POST"].includes(req.method)) return send(res, 405, { ok: false, error: "Method Not Allowed" });

    const authResult = await getAuthUser(req);
    if (authResult.error) return send(res, authResult.status || 401, { ok: false, error: authResult.error });
    const user = authResult.user;
    const sb = adminClient();

    const { data: profile } = await sb.from("profiles").select("id, role").eq("id", user.id).single();
    if (!profile || profile.role !== "student") return send(res, 403, { ok: false, error: "Student account required" });

    if (req.method === "POST") {
      const body = await readBody(req);
      const org_id = String(body.org_id || "").trim();
      if (!org_id) return send(res, 400, { ok: false, error: "Please choose an organisation." });

      const { data: existing } = await sb
        .from("placements")
        .select("id,status,org_id")
        .eq("student_id", user.id)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing && existing.status === "assigned") {
        return send(res, 400, { ok: false, error: "You are already assigned to an organisation. Contact the coordinator if this is wrong." });
      }

      const { data: orgProfile } = await sb.from("profiles").select("id,role").eq("id", org_id).maybeSingle();
      if (!orgProfile || orgProfile.role !== "organization") return send(res, 400, { ok: false, error: "Selected organisation was not found." });

      const { data: orgExtra } = await sb.from("organization_profiles").select("slots").eq("id", org_id).maybeSingle();
      const slots = orgExtra && orgExtra.slots != null ? Number(orgExtra.slots) : 0;
      if (!slots || slots <= 0) return send(res, 400, { ok: false, error: "This organisation has not opened attachment slots." });

      const { data: currentPlacements } = await sb.from("placements").select("id").eq("org_id", org_id).eq("status", "assigned");
      const current = (currentPlacements || []).length;
      if (current >= slots) return send(res, 400, { ok: false, error: "This organisation has no available attachment slots." });

      await sb.from("placements").delete().eq("student_id", user.id).neq("status", "assigned");
      const { data: placement, error } = await sb.from("placements").insert([{
        student_id: user.id,
        org_id,
        status: "assigned",
        assigned_by: user.id,
        assigned_at: new Date().toISOString(),
        override_reason: "Student selected organisation from available attachment slots",
      }]).select("*").single();
      if (error) return send(res, 500, { ok: false, error: error.message });

      return send(res, 200, { ok: true, placement: await enrichPlacement(sb, placement, user.id) });
    }

    const { data: placement, error } = await sb
      .from("placements")
      .select("*")
      .eq("student_id", user.id)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return send(res, 500, { ok: false, error: error.message });
    const enriched = await enrichPlacement(sb, placement, user.id);
    const available_organisations = enriched ? [] : await getAvailableOrgs(sb);

    return send(res, 200, { ok: true, placement: enriched, available_organisations });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
