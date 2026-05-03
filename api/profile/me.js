const { createClient } = require("@supabase/supabase-js");
const { adminClient, send } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method Not Allowed" });

    const supabaseUrl  = process.env.SUPABASE_URL;
    const anonKey      = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey)
      return send(res, 500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY" });

    const authHeader = req.headers.authorization || "";
    const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return send(res, 401, { ok: false, error: "Missing Bearer token" });

    // Verify token using user-scoped client (same pattern as profile/update.js)
    // This is more reliable than using adminClient().auth.getUser(token)
    const userSb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: authData, error: uerr } = await userSb.auth.getUser();
    if (uerr || !authData || !authData.user)
      return send(res, 401, { ok: false, error: uerr ? uerr.message : "Invalid token" });

    const user = authData.user;
    const uid  = user.id;

    // All DB operations use admin client (bypasses RLS)
    const sb = adminClient();

    // Try to fetch profile row
    let { data: profile, error: perr } = await sb
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle();

    if (perr) return send(res, 500, { ok: false, error: "Profile lookup failed: " + perr.message });

    // If profile exists but has no role, default it from JWT metadata
    if (profile && !profile.role) {
      const meta = user.user_metadata || {};
      const defaultRole = meta.role || "student";
      const validRoles = ["student","organization","coordinator","industrial_supervisor","university_supervisor"];
      const safeRole = validRoles.includes(defaultRole) ? defaultRole : "student";
      await sb.from("profiles").update({ role: safeRole }).eq("id", uid);
      profile.role = safeRole;
    }

    // If no profile row exists yet, auto-create it from JWT user_metadata
    if (!profile) {
      const meta      = user.user_metadata || {};
      const roleMeta  = meta.role || "student";
      const fullName  = meta.full_name || null;
      const email     = user.email || "";

      const validRoles = ["student","organization","coordinator","industrial_supervisor","university_supervisor"];
      const safeRole   = validRoles.includes(roleMeta) ? roleMeta : "student";

      const { data: newProfile, error: createErr } = await sb
        .from("profiles")
        .upsert([{ id: uid, role: safeRole, email, full_name: fullName }], { onConflict: "id" })
        .select("*")
        .single();

      if (createErr)
        return send(res, 500, { ok: false, error: "Profile missing and could not be created: " + createErr.message });

      profile = newProfile;

      // Also seed the role sub-table if missing
      if (safeRole === "student") {
        await sb.from("student_profiles").upsert([{ id: uid }], { onConflict: "id" });
      } else if (safeRole === "organization") {
        await sb.from("organization_profiles").upsert([{ id: uid }], { onConflict: "id" });
      } else if (safeRole === "industrial_supervisor" || safeRole === "university_supervisor") {
        await sb.from("supervisor_profiles").upsert([{ id: uid }], { onConflict: "id" });
      }
    }

    // Fetch role-specific extra data
    let extra = null;
    if (profile.role === "student") {
      const r = await sb.from("student_profiles").select("*").eq("id", uid).maybeSingle();
      extra = r.data;
      // Seed sub-table if missing
      if (!extra) {
        await sb.from("student_profiles").upsert([{ id: uid }], { onConflict: "id" });
        extra = { id: uid };
      }
    } else if (profile.role === "organization") {
      const r = await sb.from("organization_profiles").select("*").eq("id", uid).maybeSingle();
      extra = r.data;
      if (!extra) {
        await sb.from("organization_profiles").upsert([{ id: uid }], { onConflict: "id" });
        extra = { id: uid };
      }
    } else if (profile.role === "industrial_supervisor" || profile.role === "university_supervisor") {
      const r = await sb.from("supervisor_profiles").select("*").eq("id", uid).maybeSingle();
      extra = r.data || null;
      if (extra && extra.org_id) {
        const orgRes = await sb.from("organization_profiles").select("org_name").eq("id", extra.org_id).maybeSingle();
        if (orgRes && orgRes.data && orgRes.data.org_name) extra.org_name = orgRes.data.org_name;
        if (!extra.org_name) {
          const orgProfileRes = await sb.from("profiles").select("full_name,email").eq("id", extra.org_id).maybeSingle();
          if (orgProfileRes && orgProfileRes.data) extra.org_name = orgProfileRes.data.full_name || orgProfileRes.data.email;
        }
      }
    }

    return send(res, 200, { ok: true, profile, extra });
  } catch (e) {
    console.error("[profile/me] unhandled error:", e.message);
    return send(res, 500, { ok: false, error: e.message });
  }
};
