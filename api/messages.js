const { createClient } = require("@supabase/supabase-js");
const { adminClient, send, readBody, rateLimit } = require("./_shared");

function escRole(role) {
  return ({
    student: "Student",
    organization: "Organisation",
    coordinator: "Coordinator",
    industrial_supervisor: "Industrial Supervisor",
    university_supervisor: "University Supervisor"
  })[role] || "User";
}

async function getPartners(sb, caller) {
  const role = caller.role;
  let partnerIds = [];

  if (role === "coordinator") {
    // Coordinator can message organisations and supervisors from the university invite workflow.
    const ids = new Set();
    const { data: orgs } = await sb.from("profiles").select("id").eq("role", "organization");
    (orgs || []).forEach(x => ids.add(x.id));
    const { data: uniSups } = await sb.from("profiles").select("id").eq("role", "university_supervisor");
    (uniSups || []).forEach(x => ids.add(x.id));
    const { data: invited } = await sb
      .from("supervisor_invites")
      .select("accepted_by")
      .eq("invited_by", caller.id)
      .not("accepted_by", "is", null);
    (invited || []).forEach(x => { if (x.accepted_by) ids.add(x.accepted_by); });
    partnerIds = Array.from(ids);
  } else if (role === "organization") {
    const { data } = await sb.from("profiles").select("id").eq("role", "coordinator");
    partnerIds = (data || []).map(x => x.id);
  } else if (role === "student") {
    const { data: assignments } = await sb
      .from("supervisor_assignments")
      .select("industrial_supervisor_id, university_supervisor_id")
      .eq("student_id", caller.id);
    const set = new Set();
    (assignments || []).forEach(a => {
      if (a.industrial_supervisor_id) set.add(a.industrial_supervisor_id);
      if (a.university_supervisor_id) set.add(a.university_supervisor_id);
    });
    partnerIds = Array.from(set);
  } else if (role === "industrial_supervisor" || role === "university_supervisor") {
    const field = role === "industrial_supervisor" ? "industrial_supervisor_id" : "university_supervisor_id";
    const { data: assignments } = await sb
      .from("supervisor_assignments")
      .select("student_id")
      .eq(field, caller.id);
    partnerIds = Array.from(new Set((assignments || []).map(a => a.student_id)));
  }

  if (!partnerIds.length) return [];
  const { data: profiles, error } = await sb.from("profiles").select("id, full_name, email, role, avatar_url").in("id", partnerIds);
  if (error) throw error;

  const partners = profiles || [];

  // enrich organization name for supervisors if needed
  const orgExtras = {};
  const orgIds = partners.filter(p => p.role === 'organization').map(p => p.id);
  if (orgIds.length) {
    const { data: extras } = await sb.from('organization_profiles').select('id, org_name, location').in('id', orgIds);
    (extras || []).forEach(e => { orgExtras[e.id] = e; });
  }

  // unread count + last message summary
  const partnerMap = {};
  partners.forEach(p => {
    const e = orgExtras[p.id] || {};
    partnerMap[p.id] = {
      id: p.id,
      role: p.role,
      role_label: escRole(p.role),
      full_name: (p.role === 'organization' && e.org_name) ? e.org_name : (p.full_name || p.email),
      email: p.email,
      avatar_url: p.avatar_url || null,
      location: e.location || null,
      unread_count: 0,
      last_message_at: null,
      last_message_preview: ""
    };
  });

  const { data: msgs } = await sb.from('messages')
    .select('id, sender_id, receiver_id, body, created_at, read_at')
    .or(`and(sender_id.eq.${caller.id},receiver_id.in.(${partnerIds.join(',')})),and(receiver_id.eq.${caller.id},sender_id.in.(${partnerIds.join(',')}))`)
    .order('created_at', { ascending: false });

  (msgs || []).forEach(m => {
    const pid = m.sender_id === caller.id ? m.receiver_id : m.sender_id;
    const p = partnerMap[pid];
    if (!p) return;
    if (!p.last_message_at) {
      p.last_message_at = m.created_at;
      p.last_message_preview = (m.body || '').slice(0, 80);
    }
    if (m.receiver_id === caller.id && !m.read_at) p.unread_count += 1;
  });

  return Object.values(partnerMap).sort((a, b) => {
    if (a.last_message_at && b.last_message_at) return new Date(b.last_message_at) - new Date(a.last_message_at);
    if (a.last_message_at) return -1;
    if (b.last_message_at) return 1;
    return (a.full_name || '').localeCompare(b.full_name || '');
  });
}

module.exports = async function handler(req, res) {
  try {
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth) return send(res, 401, { ok: false, error: 'Missing auth token' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey) return send(res, 500, { ok: false, error: 'Missing env vars' });

    const userSb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${auth}` } } });
    const { data: authData, error: uerr } = await userSb.auth.getUser();
    if (uerr || !authData?.user) return send(res, 401, { ok: false, error: uerr ? uerr.message : 'Invalid token' });
    const user = authData.user;

    const sb = adminClient();
    const { data: caller } = await sb.from('profiles').select('id, role, full_name, email, avatar_url').eq('id', user.id).single();
    if (!caller) return send(res, 403, { ok: false, error: 'Profile not found' });

    const url = new URL(req.url, 'http://localhost');
    const partnerId = String(url.searchParams.get('partner_id') || '').trim();
    const action = String(url.searchParams.get('action') || '').trim();

    if (req.method === 'GET' && action === 'contacts') {
      const contacts = await getPartners(sb, caller);
      return send(res, 200, { ok: true, contacts });
    }

    if (req.method === 'GET') {
      if (!partnerId) return send(res, 400, { ok: false, error: 'partner_id is required' });
      const contacts = await getPartners(sb, caller);
      const allowed = contacts.some(c => c.id === partnerId);
      if (!allowed) return send(res, 403, { ok: false, error: 'You cannot message this user' });

      const { data: partnerProfile } = await sb.from('profiles').select('id, full_name, email, role, avatar_url').eq('id', partnerId).maybeSingle();
      let partner = partnerProfile || { id: partnerId };
      if (partner.role === 'organization') {
        const { data: orgExtra } = await sb.from('organization_profiles').select('org_name, location').eq('id', partnerId).maybeSingle();
        if (orgExtra && orgExtra.org_name) partner.full_name = orgExtra.org_name;
      }

      const { data: messages, error } = await sb.from('messages')
        .select('id, sender_id, receiver_id, body, created_at, read_at')
        .or(`and(sender_id.eq.${caller.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${caller.id})`)
        .order('created_at', { ascending: true });
      if (error) {
        if ((error.message || '').toLowerCase().includes('messages')) return send(res, 500, { ok: false, error: 'Database patch needed: run supabase_final_release_patch.sql to add the messages table.' });
        return send(res, 500, { ok: false, error: error.message });
      }

      // mark inbound messages as read
      await sb.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', partnerId).eq('receiver_id', caller.id).is('read_at', null);

      return send(res, 200, { ok: true, messages: messages || [], partner });
    }

    if (req.method === 'POST') {
      if (!rateLimit(req, res, 'message-send', 30, 60 * 1000)) return;
      const body = await readBody(req);
      const receiver_id = String(body.receiver_id || '').trim();
      const text = String(body.body || '').trim();
      if (!receiver_id) return send(res, 400, { ok: false, error: 'receiver_id is required' });
      if (!text) return send(res, 400, { ok: false, error: 'Message cannot be empty' });

      const contacts = await getPartners(sb, caller);
      const allowed = contacts.some(c => c.id === receiver_id);
      if (!allowed) return send(res, 403, { ok: false, error: 'You cannot message this user' });

      const { data, error } = await sb.from('messages').insert([{ sender_id: caller.id, receiver_id, body: text }]).select('*').single();
      if (error) {
        if ((error.message || '').toLowerCase().includes('messages')) return send(res, 500, { ok: false, error: 'Database patch needed: run supabase_final_release_patch.sql to add the messages table.' });
        return send(res, 500, { ok: false, error: error.message });
      }
      return send(res, 200, { ok: true, message: data });
    }

    return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
