// GET  /api/organization/supervisor  — list industrial supervisors for this org
// POST /api/organization/supervisor  — org creates an industrial supervisor account
// Body: { email, password, full_name, department?, phone? }
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

    if (!profile || profile.role !== "organization")
      return send(res, 403, { ok: false, error: "Organisation account required" });

    // ---- GET: list supervisors for this org (two-step, avoids brittle FK name) ----
    if (req.method === "GET") {
      const { data: spRows, error } = await sb
        .from("supervisor_profiles")
        .select("id, department, phone")
        .eq("org_id", user.id);

      if (error) return send(res, 500, { ok: false, error: error.message });

      // Fetch profiles separately
      const ids = (spRows || []).map(sp => sp.id);
      let profileMap = {};
      if (ids.length > 0) {
        const { data: profs } = await sb
          .from("profiles")
          .select("id, full_name, email, role")
          .in("id", ids);
        (profs || []).forEach(p => { profileMap[p.id] = p; });
      }

      const supervisors = (spRows || []).map(sp => {
        const p = profileMap[sp.id] || {};
        return {
          id:         sp.id,
          full_name:  p.full_name  || null,
          email:      p.email      || null,
          role:       p.role       || "industrial_supervisor",
          department: sp.department,
          phone:      sp.phone,
        };
      });

      return send(res, 200, { ok: true, supervisors });
    }

    // ---- POST: create industrial supervisor ----
    if (req.method === "POST") {
      const body       = await readBody(req);
      const email      = String(body.email      || "").trim();
      const password   = String(body.password   || "").trim();
      const fullName   = String(body.full_name  || "").trim();
      const department = String(body.department || "").trim() || null;
      const phone      = String(body.phone      || "").trim() || null;

      if (!email)              return send(res, 400, { ok: false, error: "email is required" });
      if (password.length < 6) return send(res, 400, { ok: false, error: "Password must be at least 6 characters" });

      // Create auth user
      const { data: { user: newUser }, error: createErr } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: "industrial_supervisor", full_name: fullName },
      });

      if (createErr) {
        const msg = createErr.message || "";
        if (msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("already been registered"))
          return send(res, 409, { ok: false, error: "An account with this email already exists." });
        return send(res, 500, { ok: false, error: createErr.message });
      }

      // Base profile
      const { error: pErr } = await sb.from("profiles").upsert([{
        id:        newUser.id,
        role:      "industrial_supervisor",
        email,
        full_name: fullName || null,
      }], { onConflict: "id" });
      if (pErr) return send(res, 500, { ok: false, error: pErr.message });

      // Supervisor profile linked to this org
      const { error: spErr } = await sb.from("supervisor_profiles").upsert([{
        id: newUser.id,
        department,
        phone,
        org_id: user.id,
      }], { onConflict: "id" });
      if (spErr) return send(res, 500, { ok: false, error: spErr.message });

      return send(res, 200, {
        ok: true,
        supervisor: { id: newUser.id, role: "industrial_supervisor", email, full_name: fullName },
      });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
