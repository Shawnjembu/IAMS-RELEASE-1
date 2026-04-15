// GET /api/placements/my  — returns the calling student's placement (if any)
const { adminClient, send } = require("../_shared");
const { createClient }       = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method Not Allowed" });

    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    // Verify the token and get the user id
    const userClient = createClient(
      process.env.SUPABASE_URL || "",
      process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      { global: { headers: { Authorization: "Bearer " + auth } } }
    );
    const { data: { user }, error: uerr } = await userClient.auth.getUser(auth);
    if (uerr || !user) return send(res, 401, { ok: false, error: "Invalid token" });

    // Use admin client to fetch placement — bypasses RLS for simplicity
    const sb = adminClient();
    const { data, error } = await sb
      .from("placements")
      .select("*, profiles!placements_org_id_fkey(full_name, email)")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return send(res, 500, { ok: false, error: error.message });

    return send(res, 200, { ok: true, placement: data || null });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
