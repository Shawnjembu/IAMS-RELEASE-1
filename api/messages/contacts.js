const { createClient } = require("@supabase/supabase-js");
const { adminClient, send } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") return send(res, 405, { ok:false, error:"Method Not Allowed" });
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
    let contacts = [];
    if (profile.role === "coordinator") {
      const ids = new Set();
      const { data: orgs } = await sb.from("profiles").select("id").eq("role", "organization");
      (orgs || []).forEach(x => ids.add(x.id));
      const { data: uniSups } = await sb.from("profiles").select("id").eq("role", "university_supervisor");
      (uniSups || []).forEach(x => ids.add(x.id));
      const { data: invited } = await sb.from("supervisor_invites").select("accepted_by").eq("invited_by", user.id).not("accepted_by", "is", null);
      (invited || []).forEach(x => { if (x.accepted_by) ids.add(x.accepted_by); });
      const idList = Array.from(ids);
      if (idList.length) {
        const { data } = await sb.from("profiles").select("id, full_name, email, role, avatar_url").in("id", idList).order("full_name");
        contacts = (data||[]).map(function (x) {
          var subtitle = x.role === 'organization' ? 'Organisation' : (x.role === 'university_supervisor' ? 'University supervisor' : 'Supervisor');
          return { id:x.id, name:x.full_name || x.email, email:x.email, role:x.role, subtitle:subtitle };
        });
      }
    } else if (profile.role === "organization") {
      const { data } = await sb.from("profiles").select("id, full_name, email, role").eq("role", "coordinator").order("full_name");
      contacts = (data||[]).map(function (x) { return { id:x.id, name:x.full_name || x.email, email:x.email, role:x.role, subtitle:'Coordinator' }; });
    } else if (profile.role === "student") {
      const { data: assign } = await sb.from("supervisor_assignments").select("industrial_supervisor_id, university_supervisor_id").eq("student_id", user.id).maybeSingle();
      const ids = [assign && assign.industrial_supervisor_id, assign && assign.university_supervisor_id].filter(Boolean);
      if (ids.length) {
        const { data } = await sb.from("profiles").select("id, full_name, email, role").in("id", ids);
        contacts = (data||[]).map(function (x) { return { id:x.id, name:x.full_name || x.email, email:x.email, role:x.role, subtitle: x.role === 'industrial_supervisor' ? 'Industrial supervisor' : 'University supervisor' }; });
      }
    } else if (profile.role === "industrial_supervisor" || profile.role === "university_supervisor") {
      const field = profile.role === "industrial_supervisor" ? "industrial_supervisor_id" : "university_supervisor_id";
      const { data: assign } = await sb.from("supervisor_assignments").select("student_id").eq(field, user.id);
      const ids = (assign||[]).map(function (x) { return x.student_id; });
      if (ids.length) {
        const { data } = await sb.from("profiles").select("id, full_name, email, role").in("id", ids);
        contacts = (data||[]).map(function (x) { return { id:x.id, name:x.full_name || x.email, email:x.email, role:x.role, subtitle:'Assigned student' }; });
      }
    }
    return send(res, 200, { ok:true, contacts });
  } catch (e) {
    return send(res, 500, { ok:false, error:e.message });
  }
};
