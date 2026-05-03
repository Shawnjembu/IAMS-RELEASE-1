const { createClient } = require("@supabase/supabase-js");
const { send, readBody } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST" && req.method !== "PATCH") {
      return send(res, 405, { ok:false, error:"Method Not Allowed" });
    }

    const url = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anon) return send(res, 500, { ok:false, error:"Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY" });

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return send(res, 401, { ok:false, error:"Missing Bearer token" });

    const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: uerr } = await sb.auth.getUser();
    if (uerr) return send(res, 401, { ok:false, error:uerr.message });

    const uid = userData.user.id;
    const body = await readBody(req);

    const updates = { ...body.updates };
    const extra = body.extra || null;

    delete updates.id;
    delete updates.role;
    delete updates.email;
    if (updates.avatar_url === undefined) delete updates.avatar_url;

    if (Object.keys(updates).length === 0 && !extra) {
      return send(res, 400, { ok:false, error:"No update payload provided" });
    }

    let profile = null;
    if (Object.keys(updates).length > 0) {
      const { data: updatedProfile, error: perr } = await sb
        .from("profiles")
        .update(updates)
        .eq("id", uid)
        .select("*")
        .single();
      if (perr) return send(res, 500, { ok:false, error:perr.message });
      profile = updatedProfile;
    }

    let extraData = null;
    if (extra && userData.user) {
      const role = profile?.role || body.role;
      if (role === "student") {
        // Whitelist allowed student_profiles columns to avoid unknown-column errors
        const allowed = ["student_number","program","year_of_study","skills","preferred_location","phone","cv_url","interests"];
        const row = { id: uid };
        allowed.forEach(k => { if (extra[k] !== undefined) row[k] = extra[k]; });
        const r = await sb.from("student_profiles").upsert([row], { onConflict: "id" }).select("*").single();
        if (r.error) return send(res, 500, { ok:false, error:r.error.message });
        extraData = r.data;
      } else if (role === "organization") {
        // Whitelist allowed organization_profiles columns
        const allowed = ["org_name","industry","contact_person","location","slots","required_skills","phone"];
        const row = { id: uid };
        allowed.forEach(k => { if (extra[k] !== undefined) row[k] = extra[k]; });
        const r = await sb.from("organization_profiles").upsert([row], { onConflict: "id" }).select("*").single();
        if (r.error) return send(res, 500, { ok:false, error:r.error.message });
        extraData = r.data;
      } else if (role === "industrial_supervisor" || role === "university_supervisor") {
        const allowed = ["department","phone","specialization","org_id"];
        const row = { id: uid };
        allowed.forEach(k => { if (extra[k] !== undefined) row[k] = extra[k]; });
        const r = await sb.from("supervisor_profiles").upsert([row], { onConflict: "id" }).select("*").single();
        if (r.error) return send(res, 500, { ok:false, error:r.error.message });
        extraData = r.data;
      }
    }

    return send(res, 200, { ok:true, profile, extra: extraData });
  } catch (e) {
    return send(res, 500, { ok:false, error:e.message });
  }
}
