// GET  /api/deadlines?role=student|organization|coordinator  — list deadlines visible to role
// POST /api/deadlines  — coordinator creates a deadline
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody } = require("./_shared");

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

    // ---- GET: list deadlines ----
    if (req.method === "GET") {
      const url  = new URL(req.url, "http://localhost");
      const role = url.searchParams.get("role") || "student";

      const { data, error } = await sb
        .from("deadlines")
        .select("id, title, due_date, audience_role, message, created_at")
        .or("audience_role.eq.all,audience_role.eq." + role)
        .order("due_date", { ascending: true });

      // If table doesn't exist yet, return empty — don't 500
      if (error) {
        if (error.message && error.message.includes("does not exist"))
          return send(res, 200, { ok: true, deadlines: [] });
        return send(res, 500, { ok: false, error: error.message });
      }
      return send(res, 200, { ok: true, deadlines: data || [] });
    }

    // ---- POST: create deadline (coordinators only) ----
    if (req.method === "POST") {
      const { data: callerProfile } = await sb.from("profiles").select("role").eq("id", user.id).single();
      if (!callerProfile || callerProfile.role !== "coordinator")
        return send(res, 403, { ok: false, error: "Coordinator account required" });
      const body = await readBody(req);
      const title        = String(body.title         || "").trim();
      const due_date     = String(body.due_date      || "").trim() || null;
      const audience_role = String(body.audience_role || "all").trim();
      const message      = String(body.message       || "").trim() || null;

      if (!title) return send(res, 400, { ok: false, error: "title is required" });

      const { data, error } = await sb
        .from("deadlines")
        .insert([{ title, due_date, audience_role, message }])
        .select("*")
        .single();

      if (error) return send(res, 500, { ok: false, error: error.message });
      return send(res, 200, { ok: true, deadline: data });
    }

    return send(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
