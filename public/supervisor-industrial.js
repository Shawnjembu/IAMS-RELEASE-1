// public/supervisor-industrial.js
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

  // Load students
  var r = await apiFetch("GET", "/api/supervisor/my-students");
  if (!r.ok) { UI.showAlert(alertEl, "error", r.error); return; }

  var students = r.students || [];
  var container = document.getElementById("students-list");

  if (!students.length) {
    container.innerHTML = '<div class="card" style="padding:24px"><p class="muted">No students assigned to you yet. Ask your coordinator to assign students.</p></div>';
    return;
  }

  students.forEach(function (s) {
    var card = document.createElement("div");
    card.className = "card mb-16";
    card.style.padding = "20px";

    var reportStatus = s.report ? s.report.status : "not submitted";
    var reportScore  = s.report && s.report.score != null ? s.report.score : null;

    card.innerHTML = [
      '<div class="flex-between mb-8">',
      '  <div>',
      '    <h2 style="margin:0">' + _esc(s.full_name || "—") + '</h2>',
      '    <p class="small muted">' + _esc(s.email) + (s.extra ? " · " + _esc(s.extra.program || "") : "") + '</p>',
      '  </div>',
      '  <span class="badge-role ' + (s.report ? "coordinator" : "student") + '">Report: ' + reportStatus + '</span>',
      '</div>',
      '<div class="grid-3 mb-16">',
      '  <div class="card" style="padding:12px;text-align:center">',
      '    <div style="font-size:1.5rem;font-weight:700">' + s.logbooks.total + '</div>',
      '    <div class="small muted">Logbook entries</div>',
      '  </div>',
      '  <div class="card" style="padding:12px;text-align:center">',
      '    <div style="font-size:1.5rem;font-weight:700">' + s.logbooks.reviewed + '</div>',
      '    <div class="small muted">Reviewed</div>',
      '  </div>',
      '  <div class="card" style="padding:12px;text-align:center">',
      '    <div style="font-size:1.5rem;font-weight:700">' + (reportScore != null ? reportScore : "—") + '</div>',
      '    <div class="small muted">Report score</div>',
      '  </div>',
      '</div>',

      // Logbook entries (collapsed)
      '<details class="mb-16">',
      '  <summary class="btn btn-secondary btn-sm" style="cursor:pointer;display:inline-block">View Logbook Entries</summary>',
      '  <div class="mt-8" id="lb-' + s.student_id + '"><p class="small muted">Loading…</p></div>',
      '</details>',

      // Grade report form (locked once graded)
      s.report
        ? (s.report.status === "graded"
          ? [
            '<div class="card" style="padding:16px;background:var(--bg-card)">',
            '  <h3 class="mb-8">Report Grade <span class="badge-role coordinator" style="font-size:.75rem;vertical-align:middle">Graded ✓</span></h3>',
            '  <p class="small"><strong>Title:</strong> ' + _esc(s.report.title) + '</p>',
            s.report.file_url ? '<p class="small"><a href="' + _esc(s.report.file_url) + '" target="_blank">📎 Download report</a></p>' : '',
            '  <p class="small mb-4"><strong>Score:</strong> ' + reportScore + ' / 100</p>',
            s.report.comments ? '<p class="small"><strong>Feedback:</strong> ' + _esc(s.report.comments) + '</p>' : '',
            '  <p class="small muted" style="margin-top:8px"><em>This report has been graded and is locked.</em></p>',
            '</div>',
          ].join("")
          : [
            '<div class="card" style="padding:16px;background:var(--bg-card)">',
            '  <h3 class="mb-8">Grade Report</h3>',
            '  <p class="small"><strong>Title:</strong> ' + _esc(s.report.title) + '</p>',
            s.report.file_url ? '<p class="small"><a href="' + _esc(s.report.file_url) + '" target="_blank">📎 Download report</a></p>' : '',
            '  <div id="grade-alert-' + s.student_id + '" class="alert hidden mb-8"></div>',
            '  <form id="grade-form-' + s.student_id + '" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">',
            '    <div class="form-group" style="margin:0;flex:1;min-width:120px">',
            '      <label>Score (0–100)</label>',
            '      <input type="number" id="score-' + s.student_id + '" class="form-control" min="0" max="100" step="0.5" value="' + (reportScore != null ? reportScore : "") + '"/>',
            '    </div>',
            '    <div class="form-group" style="margin:0;flex:3;min-width:200px">',
            '      <label>Feedback / Comments</label>',
            '      <input type="text" id="comments-' + s.student_id + '" class="form-control" placeholder="Feedback for student…" value="' + _esc(s.report.comments || "") + '"/>',
            '    </div>',
            '    <div>',
            '      <button type="submit" class="btn btn-primary" id="btn-grade-' + s.student_id + '">',
            '        <span class="spinner"></span><span class="btn-label">Save Grade</span>',
            '      </button>',
            '    </div>',
            '  </form>',
            '</div>',
          ].join(""))
        : '<p class="small muted">Student has not submitted a report yet.</p>',
    ].join("");

    container.appendChild(card);

    // Load logbook entries on expand
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

    // Grade form
    var gradeForm = document.getElementById("grade-form-" + s.student_id);
    if (gradeForm) {
      gradeForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var btn2     = document.getElementById("btn-grade-" + s.student_id);
        var gaEl     = document.getElementById("grade-alert-" + s.student_id);
        var score    = parseFloat(document.getElementById("score-" + s.student_id).value);
        var comments = document.getElementById("comments-" + s.student_id).value.trim();
        UI.hideAlert(gaEl);
        UI.setLoading(btn2, true);
        try {
          var gr = await apiFetch("PATCH", "/api/reports/review", {
            student_id: s.student_id,
            score:      isNaN(score) ? null : score,
            comments:   comments || null,
          });
          if (!gr.ok) throw new Error(gr.error);
          UI.showAlert(gaEl, "success", "Grade saved.");
          UI.showToast("success", "Report graded.");
        } catch (err) {
          UI.showAlert(gaEl, "error", err.message);
        } finally {
          UI.setLoading(btn2, false);
        }
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
          '<span class="badge-role ' + statusClass + '">' + e.status + '</span></div>' +
          '<p class="small" style="white-space:pre-wrap;margin-bottom:6px">' + _esc(e.activities) + '</p>' +
          (e.file_url ? '<p class="small"><a href="' + _esc(e.file_url) + '" target="_blank">📎 Attachment</a></p>' : '') +
          (e.status !== "reviewed"
            ? '<div class="flex-between mt-8" style="gap:8px">' +
              '<input type="text" id="lbc-' + e.id + '" class="form-control" placeholder="Leave a comment (optional)…"/>' +
              '<button class="btn btn-secondary btn-sm" data-review-lb="' + e.id + '" data-sid="' + studentId + '">Mark Reviewed</button>' +
              '</div>'
            : e.supervisor_comments ? '<p class="small muted mt-4"><em>Your comment: ' + _esc(e.supervisor_comments) + '</em></p>' : '') +
          '</div>';
      }).join("");

      container.querySelectorAll("[data-review-lb]").forEach(function (btn3) {
        btn3.addEventListener("click", async function () {
          UI.setLoading(btn3, true);
          var comment = document.getElementById("lbc-" + btn3.dataset.reviewLb);
          try {
            var gr2 = await apiFetch("PATCH", "/api/logbook?id=" + encodeURIComponent(btn3.dataset.reviewLb), {
              supervisor_comments: comment ? comment.value.trim() : null,
            });
            if (!gr2.ok) throw new Error(gr2.error);
            loadLogbooks(btn3.dataset.sid, container);
          } catch (err) {
            UI.showToast("error", err.message);
            UI.setLoading(btn3, false);
          }
        });
      });
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
