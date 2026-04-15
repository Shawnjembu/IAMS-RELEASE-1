// GET  /api/coordinator/supervisors  — list all supervisors (both types)
// POST /api/coordinator/supervisors  — create a new supervisor account
// Body: { role: "industrial_supervisor"|"university_supervisor", email, password, full_name, department?, specialization? }
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
      .from("profiles").select("role").eq("id", user.id).single();

    if (!profile || profile.role !== "coordinator")
      return send(res, 403, { ok: false, error: "Coordinator account required" });

    // ---- GET ----
    if (req.method === "GET") {
      const { data: profs, error } = await sb
        .from("profiles")
        .select("id, role, full_name, email, created_at")
        .in("role", ["industrial_supervisor", "university_supervisor"])
        .order("role")
        .order("full_name");

      if (error) return send(res, 500, { ok: false, error: error.message });

      // Attach org info for industrial supervisors (two-step to avoid brittle FK name references)
      const ids = (profs || []).map(p => p.id);
      let orgMap = {};
      if (ids.length > 0) {
        const { data: spRows } = await sb
          .from("supervisor_profiles")
          .select("id, org_id")
          .in("id", ids);
        // Collect distinct org_ids then fetch their profiles
        const orgIds = [...new Set((spRows || []).map(sp => sp.org_id).filter(Boolean))];
        let orgProfileMap = {};
        if (orgIds.length > 0) {
          const { data: orgProfiles } = await sb
            .from("profiles")
            .select("id, full_name, email")
            .in("id", orgIds);
          (orgProfiles || []).forEach(op => { orgProfileMap[op.id] = op; });
        }
        (spRows || []).forEach(sp => {
          orgMap[sp.id] = sp.org_id ? (orgProfileMap[sp.org_id] || null) : null;
        });
      }

      const supervisors = (profs || []).map(p => ({
        ...p,
        org: orgMap[p.id] || null,
      }));

      return send(res, 200, { ok: true, supervisors });
    }

    // ---- POST: create supervisor ----
    if (req.method === "POST") {
      const body           = await readBody(req);
      const role           = String(body.role          || "").trim();
      const email          = String(body.email         || "").trim();
      const password       = String(body.password      || "").trim();
      const fullName       = String(body.full_name     || "").trim();
      const department     = String(body.department    || "").trim() || null;
      const specialization = String(body.specialization|| "").trim() || null;

      if (!["industrial_supervisor", "university_supervisor"].includes(role))
        return send(res, 400, { ok: false, error: "role must be industrial_supervisor or university_supervisor" });
      if (!email)    return send(res, 400, { ok: false, error: "email is required" });
      if (password.length < 6) return send(res, 400, { ok: false, error: "Password must be at least 6 characters" });

      // Create auth user
      const { data: { user: newUser }, error: createErr } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role, full_name: fullName },
      });

      if (createErr) {
        const msg = createErr.message || "";
        if (msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("already been registered"))
          return send(res, 409, { ok: false, error: "An account with this email already exists." });
        return send(res, 500, { ok: false, error: createErr.message });
      }

      // Base profile
      const { error: pErr } = await sb.from("profiles").upsert([{
        id: newUser.id, role, email,
        full_name: fullName || null,
      }], { onConflict: "id" });
      if (pErr) return send(res, 500, { ok: false, error: pErr.message });

      // Supervisor profile
      const { error: spErr } = await sb.from("supervisor_profiles").upsert([{
        id: newUser.id,
        department,
        specialization,
      }], { onConflict: "id" });
      if (spErr) return send(res, 500, { ok: false, error: spErr.message });

      return send(res, 200, {
        ok: true,
        supervisor: { id: newUser.id, role, email, full_name: fullName },
      });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
