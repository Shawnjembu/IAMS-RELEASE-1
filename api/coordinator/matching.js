// GET    /api/coordinator/matching  — list students with placement + auto-match scores
// POST   /api/coordinator/matching  — assign student to org { student_id, org_id, override_reason? }
// DELETE /api/coordinator/matching?placement_id= — remove a placement
// POST   /api/coordinator/matching?action=auto   — run auto-match for all unassigned students
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody } = require("../_shared");

// ---- Auto-match scoring ------------------------------------------------
// 70% skills overlap + 20% location match + 10% program/industry alignment
function computeMatchScore(student, orgProfile) {
  let score = 0;

  // --- Skills (70%): compare student skills vs org required_skills + industry ---
  const stuSkills = tokenise(student.extra && student.extra.skills);
  // Combine required_skills (primary) with industry (fallback for older records)
  const orgSkillsRaw = [orgProfile.required_skills, orgProfile.industry].filter(Boolean).join(" ");
  const orgSkills = tokenise(orgSkillsRaw);
  if (stuSkills.length > 0 && orgSkills.length > 0) {
    const overlap = stuSkills.filter(sk => orgSkills.some(os => os.includes(sk) || sk.includes(os)));
    score += 70 * (overlap.length / Math.max(stuSkills.length, orgSkills.length));
  }

  // --- Location (20%) ---
  const stuLoc = norm(student.extra && student.extra.preferred_location);
  const orgLoc = norm(orgProfile.location);
  if (stuLoc && orgLoc && stuLoc === orgLoc) score += 20;
  else if (stuLoc && orgLoc && (stuLoc.includes(orgLoc) || orgLoc.includes(stuLoc))) score += 10;

  // --- Program / industry alignment (10%) ---
  const stuProg = tokenise(student.extra && student.extra.program);
  const orgIndustry = tokenise(orgProfile.industry);
  if (stuProg.length > 0 && orgIndustry.length > 0) {
    const progMatch = stuProg.some(p => orgIndustry.some(ind => ind.includes(p) || p.includes(ind)));
    if (progMatch) score += 10;
  }

  return Math.min(100, Math.round(score * 10) / 10);
}

function tokenise(str) {
  if (!str) return [];
  return str.toLowerCase()
    // Keep alphanumeric, spaces, plus, slash, dot, hash — strip everything else
    .replace(/[^a-z0-9\s+/.\-#]/g, " ")
    .split(/[\s,]+/)
    .map(t => t.trim())
    .filter(Boolean);
}
function norm(str) {
  return str ? str.toLowerCase().trim() : "";
}

// ---- Runtime explanation (no schema changes required) --------------------
function computeMatchExplanation(student, orgProfile) {
  const parts = [];

  // Skills
  const stuSkills = tokenise(student.extra && student.extra.skills);
  const orgSkillsRaw = [orgProfile.required_skills, orgProfile.industry].filter(Boolean).join(" ");
  const orgSkills = tokenise(orgSkillsRaw);
  if (stuSkills.length > 0 && orgSkills.length > 0) {
    const matched = stuSkills.filter(sk => orgSkills.some(os => os.includes(sk) || sk.includes(os)));
    if (matched.length > 0) {
      parts.push("Skills match: " + matched.slice(0, 3).join(", ") + (matched.length > 3 ? " +" + (matched.length - 3) + " more" : ""));
    } else {
      parts.push("No direct skill overlap");
    }
  }

  // Location
  const stuLoc = norm(student.extra && student.extra.preferred_location);
  const orgLoc = norm(orgProfile.location);
  if (stuLoc && orgLoc) {
    if (stuLoc === orgLoc) {
      parts.push("Location: exact match (" + orgProfile.location + ")");
    } else if (stuLoc.includes(orgLoc) || orgLoc.includes(stuLoc)) {
      parts.push("Location: partial match (" + orgProfile.location + ")");
    } else {
      parts.push("Location: different (" + orgProfile.location + ")");
    }
  }

  // Program / industry
  const stuProg = tokenise(student.extra && student.extra.program);
  const orgIndustry = tokenise(orgProfile.industry);
  if (stuProg.length > 0 && orgIndustry.length > 0) {
    const progMatch = stuProg.some(p => orgIndustry.some(ind => ind.includes(p) || p.includes(ind)));
    if (progMatch) parts.push("Program aligns with industry: " + (orgProfile.industry || ""));
  }

  return parts.length > 0 ? parts.join(" · ") : "General match";
}
// -------------------------------------------------------------------------

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

    if (!profile || profile.role !== "coordinator")
      return send(res, 403, { ok: false, error: "Coordinator account required" });

    const url = new URL(req.url, "http://localhost");

    // ---- GET: students + placement info + orgs + match scores ----
    if (req.method === "GET") {
      const [studentsRes, orgsRes, placementsRes, studentExtrasRes, orgExtrasRes] = await Promise.all([
        sb.from("profiles").select("id, email, full_name").eq("role", "student").order("email"),
        sb.from("profiles").select("id, email, full_name").eq("role", "organization").order("email"),
        sb.from("placements").select("id, student_id, org_id, status, assigned_at, match_score"),
        sb.from("student_profiles").select("id, program, skills, preferred_location, student_number, year_of_study"),
        sb.from("organization_profiles").select("id, org_name, industry, required_skills, location, slots"),
      ]);

      if (studentsRes.error)  return send(res, 500, { ok: false, error: studentsRes.error.message });
      if (orgsRes.error)      return send(res, 500, { ok: false, error: orgsRes.error.message });

      const placementMap    = {};
      const orgPlacementCount = {};
      (placementsRes.data || []).forEach(p => {
        placementMap[p.student_id] = p;
        if (p.org_id && p.status === "assigned") orgPlacementCount[p.org_id] = (orgPlacementCount[p.org_id] || 0) + 1;
      });

      const studentExtraMap = {};
      (studentExtrasRes.data || []).forEach(e => { studentExtraMap[e.id] = e; });

      const orgExtraMap     = {};
      (orgExtrasRes.data || []).forEach(e => { orgExtraMap[e.id] = e; });

      const orgs = (orgsRes.data || []).map(o => {
        const extra = orgExtraMap[o.id] || null;
        const slots = extra && extra.slots != null ? Number(extra.slots) : 0;
        const current_students = orgPlacementCount[o.id] || 0;
        const available_slots = Math.max(0, slots - current_students);
        return {
          id:       o.id,
          email:    o.email,
          full_name:o.full_name,
          extra:    extra,
          current_students,
          available_slots,
          can_accept: slots > 0 ? current_students < slots : true,
        };
      });

      const students = (studentsRes.data || []).map(s => {
        const extra     = studentExtraMap[s.id] || null;
        const placement = placementMap[s.id] || null;

        // Compute match scores against all orgs (only for unassigned)
        const suggestions = placement ? [] : orgs
          .map(o => ({
            org_id:      o.id,
            org_email:   o.email,
            org_name:    o.extra ? o.extra.org_name : o.email,
            score:       computeMatchScore({ extra }, o.extra || {}),
            explanation: computeMatchExplanation({ extra }, o.extra || {}),
          }))
          .filter(m => m.score > 0 && ((orgs.find(function(o){ return o.id === m.org_id; }) || {}).available_slots || 0) > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        return {
          student_id:  s.id,
          email:       s.email,
          full_name:   s.full_name,
          extra,
          placement,
          suggestions,
        };
      });

      return send(res, 200, { ok: true, students, orgs, placements: placementsRes.data || [] });
    }

    // ---- POST ----
    if (req.method === "POST") {
      const body   = await readBody(req);
      const action = url.searchParams.get("action");

      // Auto-match: assign all unassigned students to their best-match org
      if (action === "auto") {
        const [studentsRes, orgsRes, placementsRes, studentExtrasRes, orgExtrasRes] = await Promise.all([
          sb.from("profiles").select("id").eq("role", "student"),
          sb.from("profiles").select("id").eq("role", "organization"),
          sb.from("placements").select("student_id"),
          sb.from("student_profiles").select("id, skills, preferred_location, program"),
          sb.from("organization_profiles").select("id, industry, required_skills, location, slots"),
        ]);

        const assignedSet     = new Set((placementsRes.data || []).map(p => p.student_id));
        const orgLoadMap      = {};
        (placementsRes.data || []).forEach(p => { if (p.org_id) orgLoadMap[p.org_id] = (orgLoadMap[p.org_id] || 0) + 1; });
        const studentExtraMap = {};
        (studentExtrasRes.data || []).forEach(e => { studentExtraMap[e.id] = e; });
        const orgExtraMap     = {};
        (orgExtrasRes.data || []).forEach(e => { orgExtraMap[e.id] = e; });

        const unassigned = (studentsRes.data || []).filter(s => !assignedSet.has(s.id));
        const orgs       = (orgsRes.data || []).map(o => {
          const extra = orgExtraMap[o.id] || null;
          const slots = extra && extra.slots != null ? Number(extra.slots) : 0;
          return { id: o.id, extra: extra, current_students: orgLoadMap[o.id] || 0, slots };
        }).filter(o => o.slots <= 0 || o.current_students < o.slots);

        const assigned = [];
        for (const s of unassigned) {
          const extra = studentExtraMap[s.id] || null;
          const best  = orgs
            .map(o => ({ org_id: o.id, score: computeMatchScore({ extra }, o.extra || {}), org: o }))
            .sort((a, b) => b.score - a.score)[0];

          if (!best || best.score === 0) continue;

          // Remove old placement then insert
          await sb.from("placements").delete().eq("student_id", s.id);
          const { data: p } = await sb.from("placements").insert([{
            student_id:  s.id,
            org_id:      best.org_id,
            status:      "assigned",
            assigned_at: new Date().toISOString(),
            match_score: best.score,
          }]).select("*").single();

          if (p) {
            assigned.push(p);
            if (best.org && best.org.slots > 0) best.org.current_students = (best.org.current_students || 0) + 1;
          }
        }

        return send(res, 200, { ok: true, assigned_count: assigned.length, placements: assigned });
      }

      // Manual assign
      const student_id      = String(body.student_id || "").trim();
      const org_id          = String(body.org_id     || "").trim();
      const override_reason = String(body.override_reason || "").trim() || null;

      if (!student_id || !org_id)
        return send(res, 400, { ok: false, error: "student_id and org_id are required" });

      // Compute score for the manual pick
      const [sExtra, oExtra, existingPlacementRes, orgPlacementsRes] = await Promise.all([
        sb.from("student_profiles").select("skills, preferred_location, program").eq("id", student_id).single(),
        sb.from("organization_profiles").select("industry, location, slots, org_name").eq("id", org_id).single(),
        sb.from("placements").select("id, org_id, status").eq("student_id", student_id).maybeSingle(),
        sb.from("placements").select("id").eq("org_id", org_id).eq("status", "assigned"),
      ]);
      const orgSlots = oExtra.data && oExtra.data.slots != null ? Number(oExtra.data.slots) : 0;
      const orgCurrent = (orgPlacementsRes.data || []).length;
      const existingPlacement = existingPlacementRes.data || null;
      const movingWithinSameOrg = existingPlacement && existingPlacement.org_id === org_id && existingPlacement.status === "assigned";
      if (orgSlots > 0 && orgCurrent >= orgSlots && !movingWithinSameOrg) {
        return send(res, 400, { ok: false, error: "This organisation has no available slots left." });
      }
      const match_score = computeMatchScore(
        { extra: sExtra.data || null },
        oExtra.data || {}
      );

      await sb.from("placements").delete().eq("student_id", student_id);

      const { data, error } = await sb
        .from("placements")
        .insert([{
          student_id,
          org_id,
          status:          "assigned",
          assigned_at:     new Date().toISOString(),
          assigned_by:     user.id,
          override_reason,
          match_score,
        }])
        .select("*")
        .single();

      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, placement: data });
    }

    // ---- DELETE ----
    if (req.method === "DELETE") {
      const placement_id = url.searchParams.get("placement_id");
      if (!placement_id) return send(res, 400, { ok: false, error: "placement_id query param required" });

      const { error } = await sb.from("placements").delete().eq("id", placement_id);
      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
