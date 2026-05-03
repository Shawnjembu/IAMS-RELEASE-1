const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute();
  if (!session) return;
  UI.renderNav(window._userProfile.role, session.user.email);
  document.getElementById('page-loading').style.display='none';
  document.getElementById('page-content').style.display='';
  var currentPartner = null;
  var contacts = [];

  async function api(method, path, body) {
    var opts = { method: method, headers: { Authorization: 'Bearer ' + session.access_token } };
    if (body !== undefined) { opts.headers['Content-Type']='application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(path, opts);
    return await r.json();
  }

  async function loadContacts() {
    var r = await api('GET', '/api/messages/contacts');
    if (!r.ok) { document.getElementById('msg-contacts').innerHTML = '<p class="small muted" style="padding:16px">' + _esc(r.error) + '</p>'; return; }
    contacts = r.contacts || [];
    if (!contacts.length) { document.getElementById('msg-contacts').innerHTML = '<p class="small muted" style="padding:16px">No available contacts yet.</p>'; return; }
    document.getElementById('msg-contacts').innerHTML = contacts.map(function (c, i) {
      return '<button type="button" class="msg-contact' + (i===0 ? ' active' : '') + '" data-id="' + _esc(c.id) + '" style="display:block;width:100%;text-align:left;padding:14px 16px;border:0;border-bottom:1px solid var(--border);background:' + (i===0 ? 'var(--bg-soft)' : 'white') + ';cursor:pointer">' +
        '<div style="font-weight:700">' + _esc(c.name) + '</div><div class="small muted">' + _esc(c.subtitle || c.email || '') + '</div>' +
      '</button>';
    }).join('');
    Array.from(document.querySelectorAll('.msg-contact')).forEach(function (btn) { btn.addEventListener('click', function () { Array.from(document.querySelectorAll('.msg-contact')).forEach(function (x) { x.style.background='white'; }); btn.style.background='var(--bg-soft)'; currentPartner = btn.dataset.id; var c=contacts.find(function (x) { return x.id===currentPartner; }); document.getElementById('msg-thread-title').textContent = c ? ('Conversation with ' + c.name) : 'Conversation'; loadThread(); }); });
    currentPartner = contacts[0].id;
    document.getElementById('msg-thread-title').textContent = 'Conversation with ' + contacts[0].name;
    loadThread();
  }

  async function loadThread() {
    if (!currentPartner) return;
    var r = await api('GET', '/api/messages/thread?partner_id=' + encodeURIComponent(currentPartner));
    var box = document.getElementById('msg-thread');
    if (!r.ok) { box.innerHTML = '<p class="small muted">' + _esc(r.error) + '</p>'; return; }
    var mine = window._userProfile.id;
    var items = r.messages || [];
    if (!items.length) { box.innerHTML = '<p class="small muted">No messages yet. Start the conversation.</p>'; return; }
    box.innerHTML = items.map(function (m) {
      var isMine = m.sender_id === mine;
      return '<div style="display:flex;justify-content:' + (isMine ? 'flex-end' : 'flex-start') + ';margin-bottom:10px">' +
        '<div style="max-width:75%;padding:10px 12px;border-radius:14px;background:' + (isMine ? 'var(--accent)' : 'var(--bg-soft)') + ';color:' + (isMine ? 'white' : 'var(--text)') + '">' +
          '<div style="white-space:pre-wrap">' + _esc(m.body) + '</div><div class="small" style="opacity:.8;margin-top:4px">' + _esc((m.created_at || '').replace('T',' ').slice(0,16)) + '</div>' +
        '</div></div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  document.getElementById('msg-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!currentPartner) return;
    var input = document.getElementById('msg-input');
    var body = input.value.trim();
    if (!body) return;
    var btn = document.getElementById('msg-send');
    UI.setLoading(btn, true);
    try {
      var r = await api('POST', '/api/messages/thread?partner_id=' + encodeURIComponent(currentPartner), { body: body });
      if (!r.ok) throw new Error(r.error);
      input.value='';
      await loadThread();
    } catch (err) { alert(err.message); } finally { UI.setLoading(btn, false); }
  });

  function _esc(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  loadContacts();
})();
