// public/logbook.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

var MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
var ALLOWED_TYPES = ["application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword"];
var ALLOWED_EXT   = [".pdf", ".docx", ".doc"];

(async function () {
  var session = await UI.protectRoute("student");
  if (!session) return;

  UI.renderNav("student", session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  var alertEl = document.getElementById("logbook-alert");

  // Build week-progress grid (12 cells, filled after entries load)
  var grid = document.getElementById("week-progress-grid");
  for (var w = 1; w <= 12; w++) {
    var cell = document.createElement("div");
    cell.className = "week-cell";
    cell.id = "wk-" + w;
    cell.textContent = "Wk " + w;
    grid.appendChild(cell);
  }

  // ── Load entries ──
  var submittedWeeks = new Set();

  async function loadEntries() {
    submittedWeeks.clear();
    try {
      var r = await fetch("/api/logbook", {
        headers: { Authorization: "Bearer " + session.access_token }
      });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error);

      var entries = d.entries || [];

      // Mark submitted weeks in grid
      for (var w = 1; w <= 12; w++) {
        document.getElementById("wk-" + w).classList.remove("done");
      }
      entries.forEach(function(e) {
        if (e.week_number >= 1 && e.week_number <= 12) {
          submittedWeeks.add(e.week_number);
          var cell = document.getElementById("wk-" + e.week_number);
          if (cell) cell.classList.add("done");
        }
      });

      // Render entries list
      var container = document.getElementById("logbook-entries");
      if (!entries.length) {
        container.innerHTML = '<p class="muted small" style="padding:16px">No entries yet. Submit your first week above!</p>';
        return;
      }

      container.innerHTML = entries.map(function(e) {
        var statusClass = e.status === "reviewed" ? "coordinator" : "student";
        var statusLabel = e.status === "reviewed" ? "Reviewed ✓" : "Submitted";
        return [
          '<div class="logbook-row">',
          '  <div class="logbook-row-header">',
          '    <strong>Week ' + (e.week_number || "?") + '</strong>',
          '    <span class="badge-role ' + statusClass + '">' + statusLabel + '</span>',
          '  </div>',
          '  <p class="small muted" style="margin:4px 0 2px"><strong>Activities:</strong></p>',
          '  <p class="small" style="white-space:pre-wrap;margin-bottom:6px">' + _esc(e.activities) + '</p>',
          e.learning_outcomes
            ? '<p class="small muted" style="margin-bottom:2px"><strong>Learning outcomes:</strong></p>' +
              '<p class="small" style="white-space:pre-wrap;margin-bottom:6px">' + _esc(e.learning_outcomes) + '</p>'
            : '',
          e.challenges
            ? '<p class="small muted" style="margin-bottom:2px"><strong>Challenges:</strong></p>' +
              '<p class="small" style="white-space:pre-wrap;margin-bottom:6px">' + _esc(e.challenges) + '</p>'
            : '',
          e.file_url
            ? '<p class="small mb-4"><a href="' + _esc(e.file_url) + '" target="_blank">📎 Attachment</a></p>'
            : '',
          e.supervisor_comments
            ? '<div class="alert alert-info small mt-8" style="padding:8px 12px"><strong>Supervisor feedback:</strong> ' + _esc(e.supervisor_comments) + '</div>'
            : '',
          '  <p class="small muted" style="margin-top:6px;font-size:.78rem">Submitted: ' +
            (e.submitted_at ? new Date(e.submitted_at).toLocaleDateString() : "—") + '</p>',
          '</div>'
        ].join("");
      }).join("");
    } catch (err) {
      document.getElementById("logbook-entries").innerHTML =
        '<p class="muted small" style="padding:16px">Could not load entries: ' + _esc(err.message) + '</p>';
    }
  }

  loadEntries();

  // ── File validation ──
  document.getElementById("lb-file").addEventListener("change", function() {
    var errEl    = document.getElementById("lb-file-err");
    var statusEl = document.getElementById("lb-file-status");
    errEl.textContent    = "";
    statusEl.textContent = "";

    var file = this.files[0];
    if (!file) return;

    // Check extension
    var name = file.name.toLowerCase();
    var validExt = ALLOWED_EXT.some(function(ext){ return name.endsWith(ext); });
    if (!validExt) {
      errEl.textContent = "Only PDF and DOCX files are allowed.";
      this.value = "";
      return;
    }
    // Check size
    if (file.size > MAX_FILE_SIZE) {
      errEl.textContent = "File is too large. Maximum size is 10 MB.";
      this.value = "";
      return;
    }
    statusEl.textContent = file.name + " (" + (file.size / (1024*1024)).toFixed(1) + " MB) — ready to upload";
  });

  // ── File upload helper ──
  async function uploadFile(file) {
    var statusEl = document.getElementById("lb-file-status");
    if (statusEl) statusEl.textContent = "Uploading…";

    var signRes = await fetch("/api/uploads/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ filename: file.name, content_type: guessContentType(file.name, file.type), size: file.size })
    });
    var signData = await signRes.json();
    if (!signData.ok) throw new Error(signData.error || "Could not get upload URL");

    var uploadRes = await fetch(signData.upload_url, {
      method: "PUT",
      headers: { "Content-Type": guessContentType(file.name, file.type) },
      body: file
    });
    if (!uploadRes.ok) throw new Error("Upload failed (" + uploadRes.status + ")");

    if (statusEl) statusEl.textContent = "Uploaded: " + file.name;
    return signData.storage_path;
  }

  function guessContentType(name, existing) {
    if (existing) return existing;
    var lower = String(name || "").toLowerCase();
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (lower.endsWith(".doc")) return "application/msword";
    return "application/octet-stream";
  }

  // ── Form submission ──
  document.getElementById("logbookForm").addEventListener("submit", async function(ev) {
    ev.preventDefault();
    UI.hideAlert(alertEl);
    clearErrors();

    var weekSel    = document.getElementById("lb-week");
    var week       = parseInt(weekSel.value, 10);
    var activities = document.getElementById("lb-activities").value.trim();
    var outcomes   = document.getElementById("lb-outcomes").value.trim();
    var challenges = document.getElementById("lb-challenges").value.trim();
    var fileInput  = document.getElementById("lb-file");
    var file       = fileInput && fileInput.files[0] || null;

    var valid = true;
    if (!week) {
      document.getElementById("lb-week-err").textContent = "Please select a week.";
      valid = false;
    } else if (submittedWeeks.has(week)) {
      document.getElementById("lb-week-err").textContent =
        "You have already submitted an entry for Week " + week + ". Each week can only be submitted once.";
      valid = false;
    }
    if (!activities) {
      document.getElementById("lb-activities-err").textContent = "Activities are required.";
      valid = false;
    }
    if (!valid) return;

    var btn = document.getElementById("btnLogbook");
    UI.setLoading(btn, true);

    try {
      var file_url = null;
      if (file) {
        try {
          file_url = await uploadFile(file);
        } catch (uploadErr) {
          UI.showToast("error", "File upload failed: " + uploadErr.message + ". Entry will be submitted without attachment.");
        }
      }

      var r = await fetch("/api/logbook", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({
          week_number:       week,
          activities:        activities,
          learning_outcomes: outcomes   || null,
          challenges:        challenges || null,
          file_url:          file_url
        })
      });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error);

      UI.showAlert(alertEl, "success", "Week " + week + " entry submitted successfully!");
      UI.showToast("success", "Logbook entry saved.");
      document.getElementById("logbookForm").reset();
      document.getElementById("lb-file-status").textContent = "";
      loadEntries();
    } catch (err) {
      UI.showAlert(alertEl, "error", "Could not submit: " + err.message);
      UI.showToast("error", err.message);
    } finally {
      UI.setLoading(btn, false);
    }
  });

  function clearErrors() {
    ["lb-week-err","lb-activities-err","lb-file-err"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.textContent = "";
    });
  }

  function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, function(c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }
})();
