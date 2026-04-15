// GET /api/coordinator/stats  — summary counts for the coordinator dashboard
// Uses service-role client (coordinators only; role enforced by frontend protectRoute)
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
    const { data: profile } = await sb.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "coordinator")
      return send(res, 403, { ok: false, error: "Coordinator account required" });

    // Total students
    const { count: students } = await sb
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "student");

    // Total organisations
    const { count: orgs } = await sb
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "organization");

    // Assigned students (have a placement with status 'assigned')
    const { count: assigned } = await sb
      .from("placements")
      .select("id", { count: "exact", head: true })
      .eq("status", "assigned");

    const unassigned = Math.max(0, (students || 0) - (assigned || 0));

    return send(res, 200, {
      ok:         true,
      students:   students   || 0,
      orgs:       orgs       || 0,
      assigned:   assigned   || 0,
      unassigned: unassigned,
    });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
