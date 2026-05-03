// GET  /api/organization/supervisor  — list invited/active industrial supervisors for this organisation
// POST /api/organization/supervisor  — send/create an invite for an industrial supervisor
// Body: { email, full_name?, department?, phone? }
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody } = require("../_shared");

function localBase(req) {
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0];
  const host = req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}
function token() { return crypto.randomBytes(24).toString("hex"); }

module.exports = async function handler(req, res) {
  try {
    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok:false, error:"Missing auth token" });
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey) return send(res, 500, { ok:false, error:"Missing env vars" });
    const userSb = createClient(supabaseUrl, anonKey, { global:{ headers:{ Authorization:`Bearer ${auth}` } } });
    const { data: authData, error:uerr } = await userSb.auth.getUser();
    if (uerr || !authData?.user) return send(res, 401, { ok:false, error:uerr ? uerr.message : "Invalid token" });
    const user = authData.user;
    const sb = adminClient();
    const { data: profile } = await sb.from("profiles").select("id, role, full_name, email").eq("id", user.id).single();
    if (!profile || profile.role !== "organization") return send(res, 403, { ok:false, error:"Organisation account required" });

    if (req.method === "GET") {
      // Active supervisors linked to this org
      let active = [];
      const { data: spRows, error: spErr } = await sb.from("supervisor_profiles").select("id, department, phone, org_id").eq("org_id", user.id);
      if (spErr) {
        if ((spErr.message||"").includes("org_id")) return send(res, 500, { ok:false, error:"Database patch needed: run supabase_final_release_patch.sql to add supervisor_profiles.org_id." });
        return send(res, 500, { ok:false, error:spErr.message });
      }
      const ids = (spRows||[]).map(x=>x.id);
      let map = {};
      if (ids.length) {
        const { data: profs } = await sb.from("profiles").select("id, full_name, email, role").in("id", ids);
        (profs||[]).forEach(p=>map[p.id]=p);
      }
      active = (spRows||[]).map(sp=>({ id:sp.id, full_name:map[sp.id]?.full_name, email:map[sp.id]?.email, role:"industrial_supervisor", department:sp.department, phone:sp.phone, status:"active" }));

      const { data: invites } = await sb.from("supervisor_invites").select("id,email,full_name,status,created_at,invite_link,expires_at").eq("org_id", user.id).eq("supervisor_type", "industrial_supervisor").order("created_at", { ascending:false });
      return send(res, 200, { ok:true, supervisors: active, invites: invites || [] });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const email = String(body.email||"").trim();
      const full_name = String(body.full_name||"").trim() || null;
      const department = String(body.department||"").trim() || null;
      const phone = String(body.phone||"").trim() || null;
      if (!email) return send(res, 400, { ok:false, error:"Supervisor email is required" });
      const t = token();
      const link = `${localBase(req)}/supervisor-invite.html?token=${encodeURIComponent(t)}`;
      const row = { email, full_name, supervisor_type:"industrial_supervisor", org_id:user.id, invited_by:user.id, token:t, invite_link:link };
      const { data: invite, error } = await sb.from("supervisor_invites").insert([row]).select("*").single();
      if (error) return send(res, 500, { ok:false, error:error.message + " — run supabase_final_release_patch.sql if supervisor_invites is missing." });
      // Optional: if Supabase email invitations are configured, this will email the user. Local demo still returns an invite link.
      try { await sb.auth.admin.inviteUserByEmail(email, { data:{ role:"industrial_supervisor", full_name, invite_token:t, org_id:user.id }, redirectTo:link }); } catch(_) {}
      return send(res, 200, { ok:true, invite, invite_link: link, message:"Industrial supervisor invite created. If Supabase email is configured, the email will be sent; otherwise copy the invite link." });
    }
    return send(res, 405, { ok:false, error:"Method Not Allowed" });
  } catch(e) { return send(res, 500, { ok:false, error:e.message }); }
};
