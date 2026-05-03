// public/deadlines.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

(async function () {
  // Allow any logged-in role
  var session = await UI.protectRoute();
  if (!session) return;

  var role = (window._userProfile && window._userProfile.role) || "student";

  UI.renderNav(role, session.user.email);
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  // Show create form only for supervisors
  if (role === "university_supervisor") {
    document.getElementById("create-section").style.display = "";
  }

  var alertEl = document.getElementById("deadline-alert");

  async function loadDeadlines() {
    try {
      var r = await fetch("/api/deadlines?role=" + encodeURIComponent(role), {
        headers: { Authorization: "Bearer " + session.access_token }
      });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error);

      var container = document.getElementById("deadlines-list");
      if (!d.deadlines || d.deadlines.length === 0) {
        container.innerHTML = '<p class="muted small">No deadlines yet.</p>';
        return;
      }

      var now = new Date();
      container.innerHTML = d.deadlines.map(function (dl) {
        var due        = dl.due_date ? new Date(dl.due_date) : null;
        var isOverdue  = due && due < now;
        var dueTxt     = due ? due.toLocaleDateString() : "No due date";
        var audienceMap = {
          all: "Everyone",
          student: "Assigned students",
          assigned_students: "Assigned students",
          organization: "Organisations",
          coordinator: "Coordinator",
          industrial_supervisor: "Industrial supervisors",
          university_supervisor: "University supervisors"
        };
        var audienceTxt = audienceMap[dl.audience_role] || dl.audience_role;
        var typeTxt = dl.deadline_type ? (dl.deadline_type.charAt(0).toUpperCase() + dl.deadline_type.slice(1)) : "Deadline";
        var actions = '';
        if (role === 'coordinator') {
          actions = '<div class="deadline-item-actions"><button class="btn btn-danger btn-sm btn-delete-deadline" data-id="' + _esc(dl.id) + '">Delete</button></div>';
        }
        return [
          '<div class="card mb-8" style="padding:16px;border-left:4px solid ' + (isOverdue ? "var(--danger)" : "var(--accent)") + '">',
          '  <div class="flex-between mb-4">',
          '    <strong>' + _esc(dl.title) + '</strong>',
          '    <span class="status-pill info">' + _esc(typeTxt) + '</span>',
          '  </div>',
          '  <p class="small ' + (isOverdue ? "danger" : "muted") + '" style="margin:0">',
          '    Due: ' + _esc(dueTxt) + (isOverdue ? ' <em>(overdue)</em>' : ''),
          '  </p>',
          dl.message
            ? '<p class="small muted mt-8" style="white-space:pre-wrap">' + _esc(dl.message) + '</p>'
            : '',
          actions,
          '</div>'
        ].join("");
      }).join("");

      container.querySelectorAll('.btn-delete-deadline').forEach(function(btn){
        btn.addEventListener('click', async function(){
          if (!confirm('Delete this deadline?')) return;
          try {
            var resp = await fetch('/api/deadlines?id=' + encodeURIComponent(this.dataset.id), {
              method: 'DELETE',
              headers: { Authorization: 'Bearer ' + session.access_token }
            });
            var result = await resp.json();
            if (!result.ok) throw new Error(result.error);
            loadDeadlines();
          } catch (err) {
            UI.showToast('error', err.message);
          }
        });
      });

    } catch (err) {
      document.getElementById("deadlines-list").innerHTML =
        '<p class="muted small">Could not load deadlines: ' + _esc(err.message) + '</p>';
    }
  }

  loadDeadlines();
  if (role === "university_supervisor") loadStudentOptions();

  async function loadStudentOptions() {
    var select = document.getElementById("dl-student");
    if (!select) return;
    try {
      var r = await fetch("/api/supervisor/my-students", {
        headers: { Authorization: "Bearer " + session.access_token }
      });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error);
      var students = d.students || [];
      select.innerHTML = '<option value="">No specific student</option>' + students.map(function (s) {
        var label = (s.full_name || s.email || "Student") + (s.extra && s.extra.student_number ? " (" + s.extra.student_number + ")" : "");
        return '<option value="' + _esc(s.student_id) + '">' + _esc(label) + '</option>';
      }).join("");
    } catch (err) {
      select.innerHTML = '<option value="">Could not load students</option>';
    }
  }

  // ---- Create form (supervisors only) ----
  var form = document.getElementById("deadlineForm");
  if (form) {
    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      UI.hideAlert(alertEl);

      var title    = document.getElementById("dl-title").value.trim();
      var due_date = document.getElementById("dl-due").value || null;
      var deadline_type = document.getElementById("dl-type") ? document.getElementById("dl-type").value : "report";
      var audience_role = document.getElementById("dl-audience").value;
      var target_student_id = document.getElementById("dl-student") ? document.getElementById("dl-student").value : "";
      var message  = document.getElementById("dl-message").value.trim() || null;

      if (!title) {
        UI.showAlert(alertEl, "error", "Title is required.");
        return;
      }
      if (!due_date) {
        UI.showAlert(alertEl, "error", "Due date is required.");
        return;
      }

      var btn = document.getElementById("btnDeadline");
      UI.setLoading(btn, true);

      try {
        var r = await fetch("/api/deadlines", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + session.access_token
          },
          body: JSON.stringify({ title, due_date, audience_role, target_student_id, message, deadline_type })
        });
        var d = await r.json();
        if (!d.ok) throw new Error(d.error);

        UI.showAlert(alertEl, "success", "Deadline created.");
        form.reset();
        loadDeadlines();
      } catch (err) {
        UI.showAlert(alertEl, "error", "Error: " + err.message);
      } finally {
        UI.setLoading(btn, false);
      }
    });
  }

  function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }
})();
