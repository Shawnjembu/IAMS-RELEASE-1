const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody } = require("../_shared");

async function allowedContactIds(sb, profile, userId) {
  if (profile.role === "coordinator") {
    const ids = new Set();
    const { data: orgs } = await sb.from("profiles").select("id").eq("role", "organization");
    (orgs || []).forEach(function (x) { ids.add(x.id); });
    const { data: uniSups } = await sb.from("profiles").select("id").eq("role", "university_supervisor");
    (uniSups || []).forEach(function (x) { ids.add(x.id); });
    const { data: invited } = await sb.from("supervisor_invites").select("accepted_by").eq("invited_by", userId).not("accepted_by", "is", null);
    (invited || []).forEach(function (x) { if (x.accepted_by) ids.add(x.accepted_by); });
    return ids;
  }
  if (profile.role === "organization") {
    const { data } = await sb.from("profiles").select("id").eq("role", "coordinator");
    return new Set((data||[]).map(function (x) { return x.id; }));
  }
  if (profile.role === "student") {
    const { data: assign } = await sb.from("supervisor_assignments").select("industrial_supervisor_id, university_supervisor_id").eq("student_id", userId).maybeSingle();
    return new Set([assign && assign.industrial_supervisor_id, assign && assign.university_supervisor_id].filter(Boolean));
  }
  if (profile.role === "industrial_supervisor" || profile.role === "university_supervisor") {
    const field = profile.role === "industrial_supervisor" ? "industrial_supervisor_id" : "university_supervisor_id";
    const { data } = await sb.from("supervisor_assignments").select("student_id").eq(field, userId);
    return new Set((data||[]).map(function (x) { return x.student_id; }));
  }
  return new Set();
}

module.exports = async function handler(req, res) {
  try {
    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok:false, error:"Missing auth token" });
    const url = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
    const userSb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${auth}` } } });
    const { data: authData, error:uerr } = await userSb.auth.getUser();
    if (uerr || !authData?.user) return send(res, 401, { ok:false, error:uerr ? uerr.message : "Invalid token" });
    const user = authData.user;
    const sb = adminClient();
    const { data: profile } = await sb.from("profiles").select("id, role").eq("id", user.id).single();
    if (!profile) return send(res, 404, { ok:false, error:"Profile not found" });
    const partnerId = String((req.query && req.query.partner_id) || "").trim() || String((await readBody(req)).partner_id || '').trim();
    if (!partnerId) return send(res, 400, { ok:false, error:"partner_id is required" });
    const allowed = await allowedContactIds(sb, profile, user.id);
    if (!allowed.has(partnerId)) return send(res, 403, { ok:false, error:"You can only message allowed contacts." });

    if (req.method === "GET") {
      const { data, error } = await sb.from("messages").select("id, sender_id, receiver_id, body, created_at, read_at").or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`).order("created_at", { ascending:true });
      if (error) return send(res, 500, { ok:false, error:error.message });
      return send(res, 200, { ok:true, messages:data || [] });
    }

    if (req.method === "POST") {
      const bodyObj = await readBody(req);
      const body = String(bodyObj.body || '').trim();
      if (!body) return send(res, 400, { ok:false, error:"Message body is required" });
      const { data, error } = await sb.from("messages").insert([{ sender_id:user.id, receiver_id:partnerId, body }]).select("*").single();
      if (error) return send(res, 500, { ok:false, error:error.message + ' — run supabase_final_release_patch.sql' });
      return send(res, 200, { ok:true, message:data });
    }

    return send(res, 405, { ok:false, error:"Method Not Allowed" });
  } catch (e) {
    return send(res, 500, { ok:false, error:e.message });
  }
};
