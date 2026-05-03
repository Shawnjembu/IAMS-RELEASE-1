// POST /api/supervisor/accept-invite
// Body: { token, password, full_name? }
// Converts a pending supervisor invite into a real login account.
// Safe behaviour: Supabase email invites can create an auth user before this page is opened,
// so this route now activates/reuses that invited auth user instead of incorrectly failing.
const { adminClient, send, readBody } = require("../_shared");

async function findAuthUserByEmail(sb, email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;
  // Supabase Admin API does not provide a direct getUserByEmail in all JS versions.
  // Pagination keeps this safe for normal class/project sizes.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data && data.users ? data.users : [];
    const found = users.find(u => String(u.email || "").toLowerCase() === target);
    if (found) return found;
    if (users.length < 1000) break;
  }
  return null;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return send(res, 405, { ok:false, error:"Method Not Allowed" });
    const sb = adminClient();
    const body = await readBody(req);
    const token = String(body.token || "").trim();
    const password = String(body.password || "");
    const fullNameInput = String(body.full_name || "").trim();
    if (!token) return send(res, 400, { ok:false, error:"Invite token is required" });
    if (password.length < 6) return send(res, 400, { ok:false, error:"Password must be at least 6 characters" });

    const { data: invite, error: invErr } = await sb
      .from("supervisor_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (invErr) return send(res, 500, { ok:false, error:invErr.message });
    if (!invite) return send(res, 404, { ok:false, error:"Invite not found" });
    if (invite.status !== "pending") return send(res, 400, { ok:false, error:"This invite is no longer pending. Please sign in from the login page." });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) return send(res, 400, { ok:false, error:"This invite has expired" });

    const fullName = fullNameInput || invite.full_name || invite.email;
    const metadata = { role: invite.supervisor_type, full_name: fullName, invite_id: invite.id };

    let user = null;
    try {
      const existing = await findAuthUserByEmail(sb, invite.email);
      if (existing) {
        const { data: updated, error: updErr } = await sb.auth.admin.updateUserById(existing.id, {
          password,
          email_confirm: true,
          user_metadata: { ...(existing.user_metadata || {}), ...metadata }
        });
        if (updErr) return send(res, 500, { ok:false, error:updErr.message });
        user = updated.user;
      } else {
        const { data: created, error: createErr } = await sb.auth.admin.createUser({
          email: invite.email,
          password,
          email_confirm: true,
          user_metadata: metadata
        });
        if (createErr) return send(res, 500, { ok:false, error:createErr.message });
        user = created.user;
      }
    } catch (authErr) {
      return send(res, 500, { ok:false, error:authErr.message || "Could not activate supervisor account" });
    }

    const { error: pErr } = await sb.from("profiles").upsert([{
      id: user.id,
      role: invite.supervisor_type,
      email: invite.email,
      full_name: fullName
    }], { onConflict:"id" });
    if (pErr) return send(res, 500, { ok:false, error:pErr.message });

    const { error: spErr } = await sb.from("supervisor_profiles").upsert([{
      id: user.id,
      org_id: invite.org_id || null,
      department: invite.department || null,
      specialization: invite.specialization || null,
      invite_id: invite.id
    }], { onConflict:"id" });
    if (spErr) return send(res, 500, { ok:false, error:spErr.message });

    await sb.from("supervisor_invites").update({
      status:"accepted",
      accepted_by:user.id,
      accepted_at:new Date().toISOString()
    }).eq("id", invite.id);

    return send(res, 200, { ok:true, role: invite.supervisor_type, email: invite.email, reused_existing_auth_user: true });
  } catch(e) { return send(res, 500, { ok:false, error:e.message }); }
};
