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
  var MAX_FILE_SIZE = 10 * 1024 * 1024;
  var ALLOWED_EXT = [".pdf", ".docx", ".doc"];
  var reportDeadlineClosed = false;

  var reportFileInput = document.getElementById("rep-inp-file");
  if (reportFileInput) {
    reportFileInput.addEventListener("change", function () {
      var errEl = document.getElementById("rep-inp-file-err");
      var statusEl = document.getElementById("rep-file-status");
      if (errEl) errEl.textContent = "";
      if (statusEl) statusEl.textContent = "";
      var file = this.files && this.files[0];
      if (!file) return;
      var lower = file.name.toLowerCase();
      var validExt = ALLOWED_EXT.some(function (ext) { return lower.endsWith(ext); });
      if (!validExt) {
        if (errEl) errEl.textContent = "Only PDF, DOC, and DOCX files are allowed.";
        this.value = "";
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        if (errEl) errEl.textContent = "File is too large. Maximum size is 10 MB.";
        this.value = "";
        return;
      }
      if (statusEl) statusEl.textContent = file.name + " ready to upload";
    });
  }

  // Load existing report
  try {
    var r = await apiFetch("GET", "/api/reports/submit");
    if (r.ok) {
      renderReportDeadline(r.report_deadline, r.deadline_closed);
      reportDeadlineClosed = !!r.deadline_closed;
      if (reportDeadlineClosed) lockReportForm("Report submission is closed because the deadline has passed.");
    }
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
      if (rp.status === "graded" || rp.status === "reviewed") {
        lockReportForm(rp.status === "graded" ? "Your report has already been graded and cannot be changed." : "Your report is under supervisor review and cannot be changed now.");
      }
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

    if (reportDeadlineClosed) {
      UI.showAlert(alertEl, "error", "Report submission is closed. The deadline has passed.");
      return;
    }

    var title   = document.getElementById("rep-inp-title").value.trim();
    var content = document.getElementById("rep-inp-content").value.trim();
    var fileInput = document.getElementById("rep-inp-file");
    var file    = fileInput && fileInput.files[0] || null;

    document.getElementById("rep-inp-title-err").textContent = "";
    var contentErr = document.getElementById("rep-inp-content-err");
    var fileErr = document.getElementById("rep-inp-file-err");
    if (contentErr) contentErr.textContent = "";
    if (fileErr) fileErr.textContent = "";

    var valid = true;
    if (!title || title.length < 5) {
      document.getElementById("rep-inp-title-err").textContent = "Report title is required and must be at least 5 characters.";
      valid = false;
    }
    if (!content && !file) {
      if (contentErr) contentErr.textContent = "Add a report summary or upload the report file.";
      valid = false;
    }
    if (!valid) return;

    var btn = document.getElementById("btnReport");
    UI.setLoading(btn, true);

    try {
      var file_url = null;
      if (file) {
        var statusEl = document.getElementById("rep-file-status");
        if (statusEl) statusEl.textContent = "Uploading…";
        try {
          var ctype = guessContentType(file.name, file.type);
          var signRes = await apiFetch("POST", "/api/uploads/sign", {
            filename: file.name, content_type: ctype, size: file.size
          });
          if (!signRes.ok) throw new Error(signRes.error);
          var uploadRes = await fetch(signRes.upload_url, {
            method: "PUT",
            headers: { "Content-Type": ctype },
            body: file,
          });
          if (!uploadRes.ok) throw new Error("Upload failed");
          file_url = signRes.storage_path || signRes.file_url;
          if (statusEl) statusEl.textContent = "Uploaded: " + file.name;
        } catch (ue) {
          throw new Error("File upload failed: " + ue.message);
        }
      }

      var r = await apiFetch("POST", "/api/reports/submit", {
        title, content: content || null, file_url
      });
      if (!r.ok) throw new Error(r.error);

      UI.showAlert(alertEl, "success", "Report submitted successfully!");
      UI.showToast("success", "Report saved.");
      document.getElementById("form-heading").textContent = "Update Report";
      if (rp.status === "graded" || rp.status === "reviewed") {
        lockReportForm(rp.status === "graded" ? "Your report has already been graded and cannot be changed." : "Your report is under supervisor review and cannot be changed now.");
      }

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


  function renderReportDeadline(deadline, closed) {
    var card = document.getElementById("report-deadline-card");
    if (!card || !deadline) return;
    card.style.display = "";
    var status = document.getElementById("report-deadline-status");
    var text = document.getElementById("report-deadline-text");
    var due = deadline.due_date ? new Date(deadline.due_date + "T23:59:59") : null;
    var dueTxt = due ? due.toLocaleDateString() : "No due date set";
    if (status) {
      status.textContent = closed ? "Closed" : "Open";
      status.className = "status-pill " + (closed ? "pending" : "success");
    }
    if (text) {
      text.textContent = closed
        ? "Final report submission closed on " + dueTxt + ". Contact your university supervisor if you need assistance."
        : "Final report submission is open until " + dueTxt + ". Submit before the deadline to avoid being locked out.";
    }
  }

  function lockReportForm(message) {
    var form = document.getElementById("reportForm");
    if (!form) return;
    Array.from(form.elements).forEach(function (el) { el.disabled = true; });
    var btn = document.getElementById("btnReport");
    if (btn) {
      btn.disabled = true;
      var label = btn.querySelector(".btn-label");
      if (label) label.textContent = "Submission Closed";
    }
    UI.showAlert(alertEl, "warn", message);
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

  function guessContentType(name, existing) {
    if (existing) return existing;
    var lower = String(name || "").toLowerCase();
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (lower.endsWith(".doc")) return "application/msword";
    return "application/octet-stream";
  }

  function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }
})();
