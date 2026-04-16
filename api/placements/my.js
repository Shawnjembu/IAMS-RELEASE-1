// GET /api/placements/my  — returns the calling student's placement (if any)
const { adminClient, send } = require("../_shared");
const { createClient }       = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method Not Allowed" });

    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    // Verify the token using user-scoped client (no token argument — it's in headers)
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey    = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey) return send(res, 500, { ok: false, error: "Missing env vars" });
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${auth}` } }
    });
    const { data: authData, error: uerr } = await userClient.auth.getUser();
    if (uerr || !authData || !authData.user) return send(res, 401, { ok: false, error: "Invalid token" });
    const user = authData.user;

    // Use admin client to fetch placement (bypasses RLS) then enrich org info
    const sb = adminClient();
    const { data: placement, error } = await sb
      .from("placements")
      .select("*")
      .eq("student_id", user.id)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return send(res, 500, { ok: false, error: error.message });

    // Fetch org profile separately (two-step avoids brittle FK name references)
    let enriched = placement ? { ...placement } : null;
    if (enriched && enriched.org_id) {
      const { data: orgProfile } = await sb
        .from("profiles")
        .select("full_name, email")
        .eq("id", enriched.org_id)
        .maybeSingle();
      enriched.org = orgProfile || null;
    }

    return send(res, 200, { ok: true, placement: enriched });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
