// public/supervisor-industrial.js
// Industrial supervisor: workplace supervision only. Logbook/report grading is handled by the assigned university supervisor.
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute("industrial_supervisor");
  if (!session) return;

  UI.renderNav("industrial_supervisor", session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  var alertEl  = document.getElementById("sup-alert");
  var token    = session.access_token;

  var r = await apiFetch("GET", "/api/supervisor/my-students");
  if (!r.ok) { UI.showAlert(alertEl, "error", r.error); return; }

  var students = r.students || [];
  var container = document.getElementById("students-list");
  var org = r.supervisor && r.supervisor.organization ? r.supervisor.organization : null;

  var info = document.createElement("div");
  info.className = "card mb-16 supervisor-org-card";
  info.style.padding = "18px";
  info.innerHTML = '<div class="flex-between" style="gap:12px;align-items:flex-start">' +
    '<div><p class="small muted" style="margin:0 0 4px">Organisation</p>' +
    '<h2 style="margin:0 0 6px">' + _esc((org && org.org_name) || "Organisation not linked yet") + '</h2>' +
    '<p class="small muted">Industrial Supervisor · workplace support and student guidance' + ((org && org.email) ? ' · ' + _esc(org.email) : '') + '</p></div>' +
    '<a href="/messages.html" class="btn btn-primary btn-sm btn-with-icon"><span class="btn-icon-badge">💬</span>Open Messages</a>' +
    '</div>';
  container.parentNode.insertBefore(info, container);

  if (!students.length) {
    container.innerHTML = '<div class="card empty-state" style="padding:24px"><p class="muted">No students have been assigned to you yet. The organisation must assign you to one of its attached students.</p></div>';
    return;
  }

  students.forEach(function (s) {
    var card = document.createElement("div");
    card.className = "card mb-16";
    card.style.padding = "20px";

    var reportStatus = s.report ? s.report.status : "not submitted";
    var logbookTxt = (s.logbooks ? s.logbooks.total : 0) + " total · " + (s.logbooks ? s.logbooks.reviewed : 0) + " reviewed";

    card.innerHTML = [
      '<div class="flex-between mb-8">',
      '  <div>',
      '    <h2 style="margin:0">' + _esc(s.full_name || "—") + '</h2>',
      '    <p class="small muted">' + _esc(s.email) + (s.extra ? " · " + _esc(s.extra.program || "") : "") + '</p>',
      '  </div>',
      '  <a class="btn btn-secondary btn-sm btn-with-icon" href="/messages.html"><span class="btn-icon-badge">💬</span>Message Student</a>',
      '</div>',
      '<div class="grid-3 mb-16">',
      '  <div class="card" style="padding:12px;text-align:center"><div style="font-size:1.5rem;font-weight:700">' + (s.logbooks ? s.logbooks.total : 0) + '</div><div class="small muted">Logbooks submitted</div></div>',
      '  <div class="card" style="padding:12px;text-align:center"><div style="font-size:1.5rem;font-weight:700">' + (s.logbooks ? s.logbooks.reviewed : 0) + '</div><div class="small muted">Reviewed by university supervisor</div></div>',
      '  <div class="card" style="padding:12px;text-align:center"><div style="font-size:1.5rem;font-weight:700">' + _esc(reportStatus) + '</div><div class="small muted">Report status</div></div>',
      '</div>',
      '<div class="role-note">',
      '  <h3>Workplace supervision note</h3>',
      '  <p>Use Messages to guide the student during attachment. Academic logbook and final report review are completed by the assigned University Supervisor.</p>',
      '</div>',
      '<details class="mt-16">',
      '  <summary class="btn btn-secondary btn-sm" style="cursor:pointer;display:inline-flex">View submitted logbooks</summary>',
      '  <div class="mt-8" id="lb-' + s.student_id + '"><p class="small muted">Loading…</p></div>',
      '</details>'
    ].join("");

    container.appendChild(card);

    var details = card.querySelector("details");
    if (details) {
      details.addEventListener("toggle", function () {
        if (!details.open) return;
        var lbContainer = document.getElementById("lb-" + s.student_id);
        if (lbContainer._loaded) return;
        lbContainer._loaded = true;
        loadLogbooks(s.student_id, lbContainer);
      });
    }
  });

  async function loadLogbooks(studentId, container) {
    try {
      var r = await apiFetch("GET", "/api/logbook?student_id=" + encodeURIComponent(studentId));
      if (!r.ok) throw new Error(r.error);
      var entries = r.entries || [];
      if (!entries.length) { container.innerHTML = '<p class="small muted">No entries yet.</p>'; return; }
      container.innerHTML = entries.map(function (e) {
        var statusClass = e.status === "reviewed" ? "coordinator" : "student";
        return '<div class="card mb-8" style="padding:12px">' +
          '<div class="flex-between mb-4"><strong>Week ' + (e.week_number || "?") + '</strong>' +
          '<span class="badge-role ' + statusClass + '">' + _esc(e.status) + '</span></div>' +
          '<p class="small" style="white-space:pre-wrap;margin-bottom:6px">' + _esc(e.activities) + '</p>' +
          (e.file_url ? '<p class="small"><a href="' + _esc(e.file_url) + '" target="_blank">📎 Attachment</a></p>' : '') +
          (e.supervisor_comments ? '<p class="small muted mt-4"><em>University supervisor comment: ' + _esc(e.supervisor_comments) + '</em></p>' : '') +
          '</div>';
      }).join("");
    } catch (err) {
      container.innerHTML = '<p class="small muted">Error: ' + _esc(err.message) + '</p>';
    }
  }

  async function apiFetch(method, path, body) {
    var opts = { method: method, headers: { Authorization: "Bearer " + token } };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    var resp = await fetch(path, opts);
    return resp.json();
  }

  function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }
})();
