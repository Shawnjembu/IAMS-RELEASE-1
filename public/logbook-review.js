// public/logbook-review.js  — organisation view of a student's logbook
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  var session = await UI.protectRoute("organization");
  if (!session) return;

  UI.renderNav("organization", session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  // Read student_id from query string
  var params    = new URLSearchParams(window.location.search);
  var studentId = params.get("student");

  if (!studentId) {
    document.getElementById("page-content").innerHTML =
      '<div class="alert alert-error">No student specified. <a href="/students.html">Go back</a></div>';
    return;
  }

  // Build week-progress grid
  var grid = document.getElementById("week-grid");
  for (var w = 1; w <= 12; w++) {
    var cell = document.createElement("div");
    cell.id        = "wk-" + w;
    cell.textContent = "Wk " + w;
    cell.style.cssText =
      "text-align:center;padding:8px 4px;border-radius:var(--radius-sm);" +
      "border:1.5px solid var(--border);background:var(--bg-input);" +
      "font-size:.85rem;font-weight:600;";
    grid.appendChild(cell);
  }

  try {
    var r = await fetch("/api/logbook?student_id=" + encodeURIComponent(studentId), {
      headers: { Authorization: "Bearer " + session.access_token }
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || "Failed to load logbook");

    var entries = d.entries || [];
    var name    = d.student_name || d.student_email || studentId;

    document.getElementById("page-title").textContent    = name + "'s Logbook";
    document.getElementById("page-subtitle").textContent = d.student_email || "";
    document.getElementById("progress-label").textContent =
      entries.length + " / 12 weeks submitted";

    // Mark submitted weeks
    entries.forEach(function (e) {
      var cell = document.getElementById("wk-" + e.week_number);
      if (cell) {
        cell.style.borderColor = "var(--success)";
        cell.style.background  = "var(--success-bg)";
        cell.style.color       = "var(--success)";
        cell.textContent       = "Wk " + e.week_number + " ✓";
      }
    });

    var container = document.getElementById("entries-container");
    if (entries.length === 0) {
      container.innerHTML = '<p class="muted small" style="padding:16px">No entries submitted yet.</p>';
      return;
    }

    container.innerHTML = entries.map(function (e) {
      var statusClass = e.status === "reviewed" ? "coordinator" : "student";
      var statusLabel = e.status === "reviewed" ? "Reviewed ✓" : "Submitted";
      return [
        '<div class="logbook-entry">',
        '  <div class="entry-header">',
        '    <div class="flex" style="gap:10px">',
        '      <span class="week-badge">Week ' + (e.week_number || "?") + '</span>',
        '      <span class="badge-role ' + statusClass + '">' + statusLabel + '</span>',
        '    </div>',
        '    <span class="small muted">' +
          (e.submitted_at ? new Date(e.submitted_at).toLocaleDateString() : "") + '</span>',
        '  </div>',
        '  <p class="small muted mb-4"><strong>Activities:</strong></p>',
        '  <p class="small" style="white-space:pre-wrap;margin-bottom:8px">' + _esc(e.activities) + '</p>',
        e.learning_outcomes
          ? '<p class="small muted mb-4"><strong>Learning outcomes:</strong></p>' +
            '<p class="small" style="white-space:pre-wrap;margin-bottom:8px">' + _esc(e.learning_outcomes) + '</p>'
          : '',
        e.challenges
          ? '<p class="small muted mb-4"><strong>Challenges:</strong></p>' +
            '<p class="small" style="white-space:pre-wrap;margin-bottom:8px">' + _esc(e.challenges) + '</p>'
          : '',
        e.file_url
          ? '<p class="small mb-8"><a href="' + _esc(e.file_url) + '" target="_blank">📎 Attachment</a></p>'
          : '',
        e.supervisor_comments
          ? '<div class="alert alert-info small" style="padding:8px 12px"><strong>Supervisor feedback:</strong> ' + _esc(e.supervisor_comments) + '</div>'
          : '',
        '</div>'
      ].join("");
    }).join("");

  } catch (err) {
    document.getElementById("entries-container").innerHTML =
      '<div class="alert alert-error" style="margin:16px">Could not load logbook: ' + _esc(err.message) + '</div>';
  }

  function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }
})();
