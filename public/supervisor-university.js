// public/supervisor-university.js
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
    container.innerHTML = '<div class="card" style="padding:24px"><p class="muted">No students assigned yet. Ask your coordinator.</p></div>';
    return;
  }

  students.forEach(function (s) {
    var v1 = s.evaluations[1] != null ? s.evaluations[1] : null;
    var v2 = s.evaluations[2] != null ? s.evaluations[2] : null;

    var card = document.createElement("div");
    card.className = "card mb-16";
    card.style.padding = "20px";

    card.innerHTML = [
      '<div class="flex-between mb-16">',
      '  <div>',
      '    <h2 style="margin:0">' + _esc(s.full_name || "—") + '</h2>',
      '    <p class="small muted">' + _esc(s.email) + (s.extra ? " · " + _esc(s.extra.program || "") : "") + '</p>',
      '  </div>',
      '  <div class="small muted">',
      '    Visit 1: <strong>' + (v1 != null ? v1 : "—") + '</strong> &nbsp;|&nbsp; ',
      '    Visit 2: <strong>' + (v2 != null ? v2 : "—") + '</strong>',
      '  </div>',
      '</div>',
      visitPanel(s.student_id, 1, v1, "mb-8"),
      visitPanel(s.student_id, 2, v2, ""),
    ].join("");

    container.appendChild(card);

    // Bind only un-submitted visit forms
    [1, 2].forEach(function (visitNum) {
      var score = s.evaluations[visitNum];
      if (score != null) return; // already submitted — form not in DOM
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
        if (isNaN(sc)) { UI.showAlert(gaEl, "error", "Score is required."); return; }

        UI.setLoading(btn2, true);
        try {
          var gr = await apiFetch("POST", "/api/supervisor/evaluate", {
            student_id:   s.student_id,
            visit_number: visitNum,
            score:        sc,
            comments:     comments || null,
            visit_date:   date,
          });
          if (!gr.ok) throw new Error(gr.error);
          UI.showAlert(gaEl, "success", "Visit " + visitNum + " saved. Grade recomputed.");
          UI.showToast("success", "Evaluation saved.");
          // Disable form after save so it can't be re-submitted without a page reload
          Array.from(form.elements).forEach(function(el) { el.disabled = true; });
          btn2.innerHTML = '<span class="btn-label">Saved ✓</span>';
        } catch (err) {
          UI.showAlert(gaEl, "error", err.message);
        } finally {
          UI.setLoading(btn2, false);
        }
      });
    });
  });

  // Renders a locked read-only panel when score != null, or an input form otherwise
  function visitPanel(studentId, visitNum, score, extraClass) {
    var cls = "card" + (extraClass ? " " + extraClass : "");
    if (score != null) {
      return '<div class="' + cls + '" style="padding:16px">' +
        '<h3 class="mb-8">Visit ' + visitNum + ' Evaluation ' +
        '<span class="badge-role coordinator" style="font-size:.75rem;vertical-align:middle">Submitted ✓</span></h3>' +
        '<p class="small mb-4"><strong>Score:</strong> ' + score + ' / 100</p>' +
        '<p class="small muted"><em>This evaluation has been submitted and is locked.</em></p>' +
        '</div>';
    }
    return '<div class="' + cls + '" style="padding:16px">' +
      '<h3 class="mb-8">Visit ' + visitNum + ' Evaluation</h3>' +
      '<div id="eval-alert-' + studentId + '-' + visitNum + '" class="alert hidden mb-8"></div>' +
      '<form id="eval-form-' + studentId + '-' + visitNum + '" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">' +
      '<div class="form-group" style="margin:0;flex:1;min-width:120px">' +
      '<label>Score (0–100) <span class="required">*</span></label>' +
      '<input type="number" id="score-' + studentId + '-' + visitNum + '" class="form-control" min="0" max="100" step="0.5"/>' +
      '</div>' +
      '<div class="form-group" style="margin:0;flex:1;min-width:120px">' +
      '<label>Visit Date</label>' +
      '<input type="date" id="date-' + studentId + '-' + visitNum + '" class="form-control"/>' +
      '</div>' +
      '<div class="form-group" style="margin:0;flex:3;min-width:200px">' +
      '<label>Comments</label>' +
      '<input type="text" id="comments-' + studentId + '-' + visitNum + '" class="form-control" placeholder="Remarks…"/>' +
      '</div>' +
      '<div>' +
      '<button type="submit" class="btn btn-primary" id="btn-eval-' + studentId + '-' + visitNum + '">' +
      '<span class="spinner"></span><span class="btn-label">Save Visit ' + visitNum + '</span>' +
      '</button>' +
      '</div>' +
      '</form>' +
      '</div>';
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
