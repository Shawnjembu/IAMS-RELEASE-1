// public/report.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute("student");
  if (!session) return;

  UI.renderNav("student", session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  var alertEl = document.getElementById("report-alert");
  var token   = session.access_token;

  // Load existing report
  try {
    var r = await apiFetch("GET", "/api/reports/submit");
    if (r.ok && r.report) {
      var rp = r.report;
      var existingCard = document.getElementById("existing-report");
      existingCard.style.display = "";
      document.getElementById("rep-title").textContent = rp.title;
      document.getElementById("rep-status-badge").textContent = rp.status;
      document.getElementById("rep-status-badge").className = "badge-role " +
        (rp.status === "graded" ? "coordinator" : rp.status === "reviewed" ? "organization" : "student");
      if (rp.file_url)  document.getElementById("rep-file-link").innerHTML = '<a href="' + _esc(rp.file_url) + '" target="_blank">📎 Download report</a>';
      if (rp.score != null) document.getElementById("rep-score").textContent = "Score: " + rp.score + " / 100";
      if (rp.comments)  document.getElementById("rep-comments").innerHTML = '<em>Supervisor feedback: ' + _esc(rp.comments) + '</em>';
      document.getElementById("rep-date").textContent = "Submitted: " + (rp.submitted_at ? new Date(rp.submitted_at).toLocaleDateString() : "—");

      // Pre-fill form for update
      document.getElementById("rep-inp-title").value   = rp.title;
      document.getElementById("rep-inp-content").value = rp.content || "";
      document.getElementById("form-heading").textContent = "Update Report";
    }
  } catch (_) {}

  // Load grade summary
  try {
    var g = await apiFetch("GET", "/api/assessments/grade");
    if (g.ok && g.grade && g.grade.final_grade != null) {
      document.getElementById("grade-summary").innerHTML = [
        '<div class="grid-3">',
        '  <div class="card" style="padding:12px;text-align:center">',
        '    <div class="small muted">Report score</div>',
        '    <div style="font-size:1.5rem;font-weight:700">' + (g.grade.report_score != null ? g.grade.report_score : "—") + '</div>',
        '  </div>',
        '  <div class="card" style="padding:12px;text-align:center">',
        '    <div class="small muted">Visit avg</div>',
        '    <div style="font-size:1.5rem;font-weight:700">' +
             (g.grade.visit1_score != null && g.grade.visit2_score != null
               ? ((g.grade.visit1_score + g.grade.visit2_score) / 2).toFixed(1)
               : (g.grade.visit1_score != null ? g.grade.visit1_score : "—")) +
        '    </div>',
        '  </div>',
        '  <div class="card" style="padding:12px;text-align:center;background:var(--primary);color:#fff">',
        '    <div class="small" style="opacity:.8">Final grade</div>',
        '    <div style="font-size:1.8rem;font-weight:700">' + (g.grade.final_grade != null ? parseFloat(g.grade.final_grade).toFixed(1) : "—") + ' (' + (g.grade.letter_grade || "—") + ')</div>',
        '  </div>',
        '</div>',
      ].join("");
    }
  } catch (_) {}

  // ── Form submission ──
  document.getElementById("reportForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    UI.hideAlert(alertEl);

    var title   = document.getElementById("rep-inp-title").value.trim();
    var content = document.getElementById("rep-inp-content").value.trim();
    var fileInput = document.getElementById("rep-inp-file");
    var file    = fileInput && fileInput.files[0] || null;

    if (!title) {
      document.getElementById("rep-inp-title-err").textContent = "Title is required.";
      return;
    }
    document.getElementById("rep-inp-title-err").textContent = "";

    var btn = document.getElementById("btnReport");
    UI.setLoading(btn, true);

    try {
      var file_url = null;
      if (file) {
        var statusEl = document.getElementById("rep-file-status");
        if (statusEl) statusEl.textContent = "Uploading…";
        try {
          var signRes = await apiFetch("POST", "/api/uploads/sign", {
            filename: file.name, content_type: file.type
          });
          if (!signRes.ok) throw new Error(signRes.error);
          var uploadRes = await fetch(signRes.upload_url, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!uploadRes.ok) throw new Error("Upload failed");
          file_url = signRes.storage_path;
          if (statusEl) statusEl.textContent = "Uploaded: " + file.name;
        } catch (ue) {
          UI.showToast("error", "File upload failed: " + ue.message + ". Report submitted without attachment.");
        }
      }

      var r = await apiFetch("POST", "/api/reports/submit", {
        title, content: content || null, file_url
      });
      if (!r.ok) throw new Error(r.error);

      UI.showAlert(alertEl, "success", "Report submitted successfully!");
      UI.showToast("success", "Report saved.");
      document.getElementById("form-heading").textContent = "Update Report";

      var existingCard = document.getElementById("existing-report");
      existingCard.style.display = "";
      document.getElementById("rep-title").textContent = r.report.title;
      document.getElementById("rep-date").textContent = "Submitted: " + new Date(r.report.submitted_at).toLocaleDateString();

    } catch (err) {
      UI.showAlert(alertEl, "error", "Error: " + err.message);
    } finally {
      UI.setLoading(btn, false);
    }
  });

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
