// public/supervisor-university.js
// University supervisor: assigned student list, logbook review, final report review, and visit evaluations.
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute("university_supervisor");
  if (!session) return;

  UI.renderNav("university_supervisor", session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  var alertEl = document.getElementById("sup-alert");
  var token   = session.access_token;

  var r = await apiFetch("GET", "/api/supervisor/my-students");
  if (!r.ok) { UI.showAlert(alertEl, "error", r.error); return; }

  var students  = r.students || [];
  var container = document.getElementById("students-list");

  if (!students.length) {
    container.innerHTML = '<div class="card" style="padding:24px"><p class="muted">No students assigned yet. Ask your coordinator to assign students to you.</p></div>';
    return;
  }

  students.forEach(function (s) {
    var v1 = s.evaluations && s.evaluations[1] != null ? s.evaluations[1] : null;
    var v2 = s.evaluations && s.evaluations[2] != null ? s.evaluations[2] : null;
    var reportStatus = s.report ? s.report.status : "not submitted";
    var reportScore  = s.report && s.report.score != null ? s.report.score : null;

    var card = document.createElement("div");
    card.className = "card mb-16";
    card.style.padding = "20px";

    card.innerHTML = [
      '<div class="flex-between mb-16">',
      '  <div>',
      '    <h2 style="margin:0">' + _esc(s.full_name || "—") + '</h2>',
      '    <p class="small muted">' + _esc(s.email) + (s.extra ? " · " + _esc(s.extra.program || "") : "") + '</p>',
      '  </div>',
      '  <div class="action-btn-row"><a class="btn btn-secondary btn-sm btn-with-icon" href="/messages.html"><span class="btn-icon-badge">💬</span><span>Message Student</span></a><a class="btn btn-secondary btn-sm btn-with-icon" href="/deadlines.html"><span class="btn-icon-badge">📅</span><span>Set Report Deadline</span></a></div>',
      '</div>',
      '<div class="grid-3 mb-16">',
      '  <div class="card" style="padding:12px;text-align:center"><div style="font-size:1.4rem;font-weight:800">' + (s.logbooks ? s.logbooks.total : 0) + '</div><div class="small muted">Logbooks</div></div>',
      '  <div class="card" style="padding:12px;text-align:center"><div style="font-size:1.4rem;font-weight:800">' + (s.logbooks ? s.logbooks.reviewed : 0) + '</div><div class="small muted">Reviewed</div></div>',
      '  <div class="card" style="padding:12px;text-align:center"><div style="font-size:1.4rem;font-weight:800">' + (reportScore != null ? reportScore : "—") + '</div><div class="small muted">Report Score</div></div>',
      '</div>',
      '<details class="mb-12">',
      '  <summary style="cursor:pointer;font-weight:800">Review Logbooks</summary>',
      '  <div id="lb-' + s.student_id + '" class="mt-12"><p class="small muted">Open to load entries…</p></div>',
      '</details>',
      '<div class="card mb-12" style="padding:16px">',
      '  <h3 class="mb-8">Final Report Review <span class="badge-role student">' + _esc(reportStatus) + '</span></h3>',
      s.report ? reportPanel(s) : '<p class="small muted">Student has not submitted a final report yet.</p>',
      '</div>',
      visitPanel(s.student_id, 1, v1, "mb-8"),
      visitPanel(s.student_id, 2, v2, ""),
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

    var gradeForm = document.getElementById("grade-form-" + s.student_id);
    if (gradeForm) {
      gradeForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var btn2     = document.getElementById("btn-grade-" + s.student_id);
        var gaEl     = document.getElementById("grade-alert-" + s.student_id);
        var score    = parseFloat(document.getElementById("score-" + s.student_id).value);
        var comments = document.getElementById("comments-" + s.student_id).value.trim();
        UI.hideAlert(gaEl);
        if (isNaN(score) || score < 0 || score > 100) { UI.showAlert(gaEl, "error", "Enter a valid report score between 0 and 100."); return; }
        UI.setLoading(btn2, true);
        try {
          var gr = await apiFetch("PATCH", "/api/reports/review", { student_id: s.student_id, score: score, comments: comments || null });
          if (!gr.ok) throw new Error(gr.error);
          UI.showAlert(gaEl, "success", "Report review saved.");
          UI.showToast("success", "Report reviewed.");
        } catch (err) { UI.showAlert(gaEl, "error", err.message); }
        finally { UI.setLoading(btn2, false); }
      });
    }

    [1, 2].forEach(function (visitNum) {
      var score = s.evaluations && s.evaluations[visitNum];
      if (score != null) return;
      var form = document.getElementById("eval-form-" + s.student_id + "-" + visitNum);
      if (!form) return;
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var gaEl     = document.getElementById("eval-alert-" + s.student_id + "-" + visitNum);
        var btn2     = document.getElementById("btn-eval-" + s.student_id + "-" + visitNum);
        var sc       = parseFloat(document.getElementById("score-" + s.student_id + "-" + visitNum).value);
        var date     = document.getElementById("date-" + s.student_id + "-" + visitNum).value || null;
        var comments = document.getElementById("comments-" + s.student_id + "-" + visitNum).value.trim();
        UI.hideAlert(gaEl);
        if (isNaN(sc) || sc < 0 || sc > 100) { UI.showAlert(gaEl, "error", "Enter a valid score between 0 and 100."); return; }
        if (!date) { UI.showAlert(gaEl, "error", "Visit date is required."); return; }
        UI.setLoading(btn2, true);
        try {
          var gr = await apiFetch("POST", "/api/supervisor/evaluate", { student_id:s.student_id, visit_number:visitNum, score:sc, comments:comments || null, visit_date:date });
          if (!gr.ok) throw new Error(gr.error);
          UI.showAlert(gaEl, "success", "Visit " + visitNum + " saved.");
          Array.from(form.elements).forEach(function(el) { el.disabled = true; });
          btn2.innerHTML = '<span class="btn-label">Saved ✓</span>';
        } catch (err) { UI.showAlert(gaEl, "error", err.message); }
        finally { UI.setLoading(btn2, false); }
      });
    });
  });

  function reportPanel(s) {
    return [
      '<p class="small muted mb-8"><strong>Title:</strong> ' + _esc(s.report.title || "Final Report") + '</p>',
      s.report.file_url ? '<p class="small mb-12"><a class="btn btn-secondary btn-sm btn-with-icon" href="' + _esc(s.report.file_url) + '" target="_blank" rel="noopener"><span class="btn-icon-badge">📄</span><span>View Submitted Report File</span></a></p>' : '<p class="small muted mb-8">No file link was saved for this report.</p>',
      s.report.content ? '<p class="small" style="white-space:pre-wrap">' + _esc(s.report.content) + '</p>' : '',
      '<div id="grade-alert-' + s.student_id + '" class="alert hidden mb-8"></div>',
      '<form id="grade-form-' + s.student_id + '" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">',
      '  <div class="form-group" style="margin:0;min-width:140px"><label>Score (0–100)</label><input type="number" id="score-' + s.student_id + '" class="form-control" min="0" max="100" step="0.5" value="' + (s.report.score != null ? s.report.score : "") + '"/></div>',
      '  <div class="form-group" style="margin:0;flex:1;min-width:200px"><label>Comments</label><input type="text" id="comments-' + s.student_id + '" class="form-control" placeholder="Feedback for student…" value="' + _esc(s.report.comments || "") + '"/></div>',
      '  <button type="submit" class="btn btn-primary btn-with-icon" id="btn-grade-' + s.student_id + '"><span class="spinner"></span><span class="btn-icon-badge">✓</span><span class="btn-label">Save Report Review</span></button>',
      '</form>'
    ].join("");
  }

  function visitPanel(studentId, visitNum, score, extraClass) {
    var cls = "card" + (extraClass ? " " + extraClass : "");
    if (score != null) {
      return '<div class="' + cls + '" style="padding:16px"><h3 class="mb-8">Visit ' + visitNum + ' Evaluation <span class="badge-role coordinator" style="font-size:.75rem;vertical-align:middle">Submitted ✓</span></h3><p class="small mb-4"><strong>Score:</strong> ' + score + ' / 100</p><p class="small muted"><em>This evaluation has been submitted and is locked.</em></p></div>';
    }
    return '<div class="' + cls + '" style="padding:16px">' +
      '<h3 class="mb-8">Visit ' + visitNum + ' Evaluation</h3><div id="eval-alert-' + studentId + '-' + visitNum + '" class="alert hidden mb-8"></div>' +
      '<form id="eval-form-' + studentId + '-' + visitNum + '" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">' +
      '<div class="form-group" style="margin:0;flex:1;min-width:120px"><label>Score (0–100) <span class="required">*</span></label><input type="number" id="score-' + studentId + '-' + visitNum + '" class="form-control" min="0" max="100" step="0.5"/></div>' +
      '<div class="form-group" style="margin:0;flex:1;min-width:120px"><label>Visit Date</label><input type="date" id="date-' + studentId + '-' + visitNum + '" class="form-control" required/></div>' +
      '<div class="form-group" style="margin:0;flex:3;min-width:200px"><label>Comments</label><input type="text" id="comments-' + studentId + '-' + visitNum + '" class="form-control" placeholder="Remarks…"/></div>' +
      '<button type="submit" class="btn btn-primary btn-with-icon" id="btn-eval-' + studentId + '-' + visitNum + '"><span class="spinner"></span><span class="btn-icon-badge">✓</span><span class="btn-label">Save Visit ' + visitNum + '</span></button></form></div>';
  }

  async function loadLogbooks(studentId, container) {
    try {
      var r = await apiFetch("GET", "/api/logbook?student_id=" + encodeURIComponent(studentId));
      if (!r.ok) throw new Error(r.error);
      var entries = r.entries || [];
      if (!entries.length) { container.innerHTML = '<p class="small muted">No entries yet.</p>'; return; }
      container.innerHTML = entries.map(function (e) {
        var reviewed = e.status === "reviewed";
        return '<div class="card mb-8" style="padding:12px"><div class="flex-between mb-4"><strong>Week ' + (e.week_number || "?") + '</strong><span class="badge-role ' + (reviewed ? "coordinator" : "student") + '">' + _esc(e.status || "submitted") + '</span></div>' +
          '<p class="small" style="white-space:pre-wrap;margin-bottom:6px">' + _esc(e.activities) + '</p>' +
          (e.file_url ? '<p class="small"><a href="' + _esc(e.file_url) + '" target="_blank">Attachment</a></p>' : '') +
          (reviewed ? (e.supervisor_comments ? '<p class="small muted mt-4"><em>Your comment: ' + _esc(e.supervisor_comments) + '</em></p>' : '') : '<div class="flex-between mt-8" style="gap:8px"><input type="text" id="lbc-' + e.id + '" class="form-control" placeholder="Leave feedback…"/><button class="btn btn-secondary btn-sm" data-review-lb="' + e.id + '" data-sid="' + studentId + '">Mark Reviewed</button></div>') +
          '</div>';
      }).join("");
      container.querySelectorAll("[data-review-lb]").forEach(function (btn3) {
        btn3.addEventListener("click", async function () {
          UI.setLoading(btn3, true);
          var comment = document.getElementById("lbc-" + btn3.dataset.reviewLb);
          try {
            var gr2 = await apiFetch("PATCH", "/api/logbook?id=" + encodeURIComponent(btn3.dataset.reviewLb), { supervisor_comments: comment ? comment.value.trim() : null });
            if (!gr2.ok) throw new Error(gr2.error);
            container._loaded = false;
            loadLogbooks(btn3.dataset.sid, container);
          } catch (err) { UI.showToast("error", err.message); UI.setLoading(btn3, false); }
        });
      });
    } catch (err) { container.innerHTML = '<p class="small muted">Error: ' + _esc(err.message) + '</p>'; }
  }

  async function apiFetch(method, path, body) {
    var opts = { method: method, headers: { Authorization: "Bearer " + token } };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    var resp = await fetch(path, opts);
    return resp.json();
  }

  function _esc(s) { return String(s || "").replace(/[&<>"']/g, function (c) { return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]; }); }
})();
