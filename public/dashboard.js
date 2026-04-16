// public/dashboard.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);
const sb = window._sb;

var SKILLS = [
  "Python","Java","JavaScript","SQL","React","Node.js","C++","PHP",
  "HTML/CSS","Django","Data Analysis","Machine Learning",
  "Database Management","Network Administration","Cybersecurity",
  "Software Testing","Project Management","Microsoft Office","Communication"
];

(async function () {
  // Guard: redirect to /auth.html if no session
  var session = await UI.protectRoute();
  if (!session) return;

  // Retry profile fetch up to 3 times (handles first-visit auto-create race)
  var profile  = window._userProfile;
  var extra    = window._userExtra;
  var lastErr  = null;
  if (!profile) {
    for (var attempt = 0; attempt < 3 && !profile; attempt++) {
      await new Promise(function(r){ setTimeout(r, 600 * (attempt + 1)); });
      try {
        var rr = await fetch("/api/profile/me", {
          headers: { Authorization: "Bearer " + session.access_token }
        });
        var json = await rr.json();
        if (json.ok) { profile = json.profile; extra = json.extra; }
        else lastErr = json.error || "Server returned error";
      } catch (fetchErr) { lastErr = fetchErr.message; }
    }
    window._userProfile = profile;
    window._userExtra   = extra;
  }

  var role = profile ? profile.role : null;

  // Show content
  document.getElementById("page-loading").style.display = "none";
  document.getElementById("page-content").style.display = "";

  // Greeting
  var name = (profile && profile.full_name) ? profile.full_name : session.user.email;
  document.getElementById("dash-greeting").textContent = "Welcome, " + name;
  document.getElementById("dash-sub").textContent =
    _esc(role ? role.replace(/_/g, " ") : "user") + " · " + _esc(session.user.email);

  // Inject nav
  UI.renderNav(role, session.user.email);

  // ── STUDENT ──────────────────────────────────────────────────
  if (role === "student") {
    document.getElementById("dash-student").style.display = "";
    _loadStudentStats(session.access_token);

    // Show profile-completion warning if skills or location are missing
    var hasSkills   = extra && extra.skills && extra.skills.trim() !== "";
    var hasLocation = extra && extra.preferred_location && extra.preferred_location.trim() !== "";
    if (!hasSkills || !hasLocation) {
      _initQuickProfile(session.access_token, extra);
    } else {
      var aCard = document.getElementById("dash-student-assessment");
      if (aCard) aCard.style.display = "";
    }

  // ── ORGANISATION ─────────────────────────────────────────────
  } else if (role === "organization") {
    document.getElementById("dash-org").style.display = "";
    if (extra && extra.slots != null) {
      document.getElementById("stat-org-slots").textContent = extra.slots;
    }
    try {
      var r = await fetch("/api/organization/students", {
        headers: { Authorization: "Bearer " + session.access_token }
      });
      if (r.ok) {
        var d = await r.json();
        var el = document.getElementById("stat-org-students");
        if (el && d.ok) el.textContent = (d.students || []).length;
        _populateOrgStudentsTable(d.students || []);
      }
    } catch (_) {}
    _initOrgRequirements(session.access_token, extra);
    _initOrgSupervisors(session.access_token);

  // ── COORDINATOR ───────────────────────────────────────────────
  } else if (role === "coordinator") {
    document.getElementById("dash-coordinator").style.display = "";
    _loadCoordStats(session.access_token);

  // ── SUPERVISORS ───────────────────────────────────────────────
  } else if (role === "industrial_supervisor" || role === "university_supervisor") {
    var supSection = document.getElementById("dash-supervisor");
    if (supSection) supSection.style.display = "";
    _loadSupervisorStats(session.access_token, role);

  // ── UNKNOWN ROLE ──────────────────────────────────────────────
  } else {
    var errMsg = profile
      ? "Account role not configured — please contact your coordinator."
      : ("Could not load profile" + (lastErr ? ": " + lastErr : " — please refresh the page."));
    document.getElementById("dash-sub").textContent = errMsg;
    var setupEl = document.getElementById("dash-setup");
    if (setupEl) setupEl.style.display = "";
  }

  // Load deadlines for this role
  _loadDeadlines(session.access_token, role);
})();

// ── Quick profile completion (inline card in student dashboard) ──────────────
function _initQuickProfile(token, extra) {
  var warningEl = document.getElementById("dash-profile-warning");
  if (!warningEl) return;
  warningEl.style.display = "";

  // Build skill checkboxes
  var grid = document.getElementById("quick-skills-grid");
  var savedSkills = extra && extra.skills
    ? extra.skills.split(",").map(function(s){ return s.trim().toLowerCase(); })
    : [];

  grid.innerHTML = SKILLS.map(function(sk) {
    var checked = savedSkills.indexOf(sk.toLowerCase()) !== -1 ? "checked" : "";
    return '<label class="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700 hover:text-gray-900">' +
      '<input type="checkbox" class="quick-skill-cb rounded text-primary" value="' + _esc(sk) + '" ' + checked + '/>' +
      '<span>' + _esc(sk) + '</span></label>';
  }).join("");

  // Pre-fill location
  var locSel = document.getElementById("quick-location");
  if (locSel && extra && extra.preferred_location) {
    locSel.value = extra.preferred_location;
  }

  // Pre-fill phone
  var phoneEl = document.getElementById("quick-phone");
  if (phoneEl && window._userProfile && window._userProfile.phone) {
    phoneEl.value = window._userProfile.phone;
  }

  // CV Upload (optional)
  var cvFileEl = document.createElement("input");
  cvFileEl.type = "file";
  cvFileEl.accept = ".pdf";
  cvFileEl.id = "quick-cv";
  cvFileEl.className = "mt-3 w-full border border-gray-300 rounded-lg px-3 py-2 hidden file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-white hover:file:bg-accent-dark";
  phoneEl.parentNode.appendChild(cvFileEl);
  var cvLabel = document.createElement("label");
  cvLabel.htmlFor = "quick-cv";
  cvLabel.className = "mt-3 block text-sm text-gray-700 font-medium hover:text-primary cursor-pointer";
  cvLabel.innerHTML = '<i class="fas fa-file-pdf mr-1"></i>Upload CV (optional PDF)';
  phoneEl.parentNode.appendChild(cvLabel);

  // Save handler (now with CV)
  var btn = document.getElementById("btnQuickSave");
  if (!btn) return;

  btn.addEventListener("click", async function() {
    var msgEl    = document.getElementById("quick-profile-msg");
    var checked  = Array.from(document.querySelectorAll(".quick-skill-cb:checked")).map(function(el){ return el.value; });
    var location = locSel ? locSel.value.trim() : "";
    var phone    = phoneEl ? phoneEl.value.trim() : "";
    if (checked.length === 0) {
      _showMsg(msgEl, "error", "Please select at least one skill.");
      return;
    }
    if (!location) {
      _showMsg(msgEl, "error", "Please select a preferred location.");
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i>Saving…';

    try {
      var resp = await fetch("/api/profile/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({
          updates: { phone: phone },
          extra:   { skills: checked.join(", "), preferred_location: location },
          role:    "student"
        })
      });
      var result = await resp.json();
      if (!result.ok) throw new Error(result.error || "Save failed");

      // Update in-memory profile
      if (window._userExtra) {
        window._userExtra.skills             = checked.join(", ");
        window._userExtra.preferred_location = location;
      }
      if (window._userProfile) window._userProfile.phone = phone;

      _showMsg(msgEl, "success", "Profile saved! You can now be matched with organisations.");
      btn.innerHTML = '<i class="fas fa-check mr-2"></i>Saved!';

      // After 1.5s hide warning and show assessment card
      setTimeout(function() {
        warningEl.style.display = "none";
        var aCard = document.getElementById("dash-student-assessment");
        if (aCard) aCard.style.display = "";
        UI.showToast("success", "Profile complete! You can now be matched.");
      }, 1500);

    } catch (err) {
      _showMsg(msgEl, "error", err.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save &amp; Continue';
    }
  });
}

function _showMsg(el, type, msg) {
  if (!el) return;
  el.className = type === "success"
    ? "text-sm p-3 rounded-lg mb-3 bg-green-50 text-green-800 border border-green-200"
    : "text-sm p-3 rounded-lg mb-3 bg-red-50 text-red-800 border border-red-200";
  el.textContent = msg;
  el.classList.remove("hidden");
}

function _initOrgRequirements(token, extra) {
  var section = document.getElementById("org-requirements-section");
  var toggleBtn = document.getElementById("btn-org-skills-edit");
  var grid = document.getElementById("org-skills-grid");
  var locSel = document.getElementById("org-location");
  var saveBtn = document.getElementById("btn-org-save");
  var cancelBtn = document.getElementById("btn-org-cancel");
  var msgEl = document.getElementById("org-msg");

  if (!toggleBtn) return;

  // Populate skills checkboxes
  grid.innerHTML = SKILLS.map(function(sk) {
    var checked = extra && extra.required_skills && extra.required_skills.split(",").includes(sk);
    return '<label class="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer text-sm">' +
      '<input type="checkbox" class="org-skill-cb rounded text-primary" value="' + _esc(sk) + '" ' + (checked ? 'checked' : '') + '/>' +
      sk + '</label>';
  }).join("");

  if (locSel && extra && extra.location) locSel.value = extra.location;

  toggleBtn.addEventListener("click", function() {
    section.classList.toggle("hidden");
  });

  cancelBtn.addEventListener("click", function() {
    section.classList.add("hidden");
  });

  saveBtn.addEventListener("click", async function() {
    var checked = Array.from(document.querySelectorAll(".org-skill-cb:checked")).map(el => el.value);
    var location = locSel.value.trim();

    if (checked.length === 0) {
      _showMsg(msgEl, "error", "Please select at least one required skill");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';

    try {
      var resp = await fetch("/api/profile/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({
          extra: { required_skills: checked.join(", "), location: location },
          role: "organization"
        })
      });
      var result = await resp.json();
      if (!result.ok) throw new Error(result.error || "Save failed");

      UI.showToast("success", "Organisation requirements updated!");
      _showMsg(msgEl, "success", "Requirements saved successfully");
      window._userExtra.required_skills = checked.join(", ");
      window._userExtra.location = location;

    } catch (err) {
      _showMsg(msgEl, "error", err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
    }
  });
}

// ── Org: Industrial Supervisor Management ────────────────────────────────────
async function _initOrgSupervisors(token) {
  var listEl    = document.getElementById("org-sup-list");
  var formEl    = document.getElementById("org-sup-form");
  var alertEl   = document.getElementById("org-sup-alert");
  var toggleBtn = document.getElementById("btnToggleSupForm");
  var cancelBtn = document.getElementById("btnCancelSup");
  var createBtn = document.getElementById("btnCreateSup");
  var spinner   = document.getElementById("sup-spinner");
  if (!listEl) return;

  function showAlert(type, msg) {
    if (!alertEl) return;
    alertEl.className = "mb-4 rounded-lg p-3 text-sm " +
      (type === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200");
    alertEl.textContent = msg;
    alertEl.classList.remove("hidden");
  }
  function hideAlert() { if (alertEl) alertEl.classList.add("hidden"); }

  async function loadSupervisors() {
    listEl.innerHTML = '<p class="text-gray-500 text-sm">Loading…</p>';
    try {
      var resp = await fetch("/api/organization/supervisor", {
        headers: { Authorization: "Bearer " + token }
      });
      var d = await resp.json();
      if (!d.ok) throw new Error(d.error);
      var sups = d.supervisors || [];
      if (sups.length === 0) {
        listEl.innerHTML = '<p class="text-gray-500 text-sm">No industrial supervisors added yet.</p>';
        return;
      }
      listEl.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-sm">' +
        '<thead class="bg-gray-50"><tr>' +
        '<th class="px-4 py-2 text-left text-gray-700">Name</th>' +
        '<th class="px-4 py-2 text-left text-gray-700">Email</th>' +
        '<th class="px-4 py-2 text-left text-gray-700">Department</th>' +
        '</tr></thead><tbody>' +
        sups.map(function(s) {
          return '<tr class="border-t border-gray-100">' +
            '<td class="px-4 py-2 font-medium">' + _esc(s.full_name || "—") + '</td>' +
            '<td class="px-4 py-2 text-gray-600">' + _esc(s.email) + '</td>' +
            '<td class="px-4 py-2 text-gray-600">' + _esc(s.department || "—") + '</td>' +
            '</tr>';
        }).join("") +
        '</tbody></table></div>';
    } catch (err) {
      listEl.innerHTML = '<p class="text-red-500 text-sm">Could not load supervisors: ' + _esc(err.message) + '</p>';
    }
  }

  loadSupervisors();

  if (toggleBtn) {
    toggleBtn.addEventListener("click", function() {
      formEl.classList.toggle("hidden");
      hideAlert();
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function() {
      formEl.classList.add("hidden");
      hideAlert();
    });
  }
  if (createBtn) {
    createBtn.addEventListener("click", async function() {
      hideAlert();
      var email    = (document.getElementById("sup-email")      || {}).value || "";
      var password = (document.getElementById("sup-password")   || {}).value || "";
      var fullName = (document.getElementById("sup-name")       || {}).value || "";
      var dept     = (document.getElementById("sup-department") || {}).value || "";
      var phone    = (document.getElementById("sup-phone")      || {}).value || "";

      if (!email.trim()) { showAlert("error", "Email is required."); return; }
      if (password.length < 6) { showAlert("error", "Password must be at least 6 characters."); return; }

      createBtn.disabled = true;
      if (spinner) spinner.classList.remove("hidden");
      try {
        var resp = await fetch("/api/organization/supervisor", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({
            email:      email.trim(),
            password,
            full_name:  fullName.trim(),
            department: dept.trim(),
            phone:      phone.trim(),
          })
        });
        var d = await resp.json();
        if (!d.ok) throw new Error(d.error);
        showAlert("success", "Supervisor account created: " + d.supervisor.email);
        document.getElementById("sup-email").value = "";
        document.getElementById("sup-password").value = "";
        document.getElementById("sup-name").value = "";
        document.getElementById("sup-department").value = "";
        document.getElementById("sup-phone").value = "";
        loadSupervisors();
      } catch (err) {
        showAlert("error", err.message);
      } finally {
        createBtn.disabled = false;
        if (spinner) spinner.classList.add("hidden");
      }
    });
  }
}

function _populateOrgStudentsTable(students) {
  var tbody = document.getElementById("org-students-body");
  if (!tbody) return;

  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-gray-500">No students assigned yet</td></tr>';
    return;
  }

  tbody.innerHTML = students.map(function(s) {
    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="px-4 py-4 font-medium">${_esc(s.name || s.full_name)}</td>
        <td class="px-4 py-4 text-sm text-gray-700">${_esc(s.email)}</td>
        <td class="px-4 py-4">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            ${_esc(s.status || 'assigned')}
          </span>
        </td>
      </tr>`;
  }).join("");
}

// ── Stats loaders ────────────────────────────────────────────────────────────
async function _loadStudentStats(token) {
  // Placement status
  try {
    var r = await fetch("/api/placements/my", {
      headers: { Authorization: "Bearer " + token }
    });
    if (r.ok) {
      var d = await r.json();
      if (d.ok && d.placement) {
        document.getElementById("stat-placement").textContent = d.placement.status;
      }
    }
  } catch (_) {}

  // Logbook count + load history
  try {
    var r2 = await fetch("/api/logbook", { headers: { Authorization: "Bearer " + token } });
    if (r2.ok) {
      var d2 = await r2.json();
      var countEl = document.getElementById("stat-logbook-count");
      if (countEl && d2.ok) countEl.textContent = (d2.entries || []).length;
      
      // Populate logbook history table
      _populateLogbookHistory(d2.entries || []);
    }
  } catch (_) {}

  // Assessment grade
  try {
    var r3 = await fetch("/api/assessments/grade", { headers: { Authorization: "Bearer " + token } });
    if (r3.ok) {
      var d3 = await r3.json();
      if (d3.ok && d3.grade) {
        var g   = d3.grade;
        var v1  = g.visit1_score, v2 = g.visit2_score;
        var avg = (v1 != null && v2 != null) ? ((v1 + v2) / 2).toFixed(1)
                : (v1 != null ? v1 : null);
        var setText = function(id, val) {
          var el = document.getElementById(id);
          if (el) el.textContent = val != null ? val : "—";
        };
        setText("stu-g-report", g.report_score  != null ? g.report_score : null);
        setText("stu-g-visits", avg);
        setText("stu-g-final",  g.final_grade   != null
          ? parseFloat(g.final_grade).toFixed(1) + (g.letter_grade ? " (" + g.letter_grade + ")" : "")
          : null);
      }
    }
  } catch (_) {}
  
  // Init logbook handlers
  _initStudentLogbook(token);
}

function _populateLogbookHistory(entries) {
  var tbody = document.querySelector("#logbook-history tbody");
  var progressEl = document.getElementById("logbook-progress");
  if (!tbody) return;
  
  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-gray-500">No logbooks submitted yet</td></tr>';
    if (progressEl) progressEl.textContent = "0/12 weeks submitted";
    return;
  }

  var submittedCount = entries.length;
  tbody.innerHTML = entries.map(function(entry) {
    var date = new Date(entry.submitted_at).toLocaleDateString();
    return `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 font-medium">Week ${entry.week_number}</td>
        <td class="px-4 py-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <i class="fas fa-check mr-1"></i>Submitted
          </span>
        </td>
        <td class="px-4 py-3 text-sm text-gray-500">${date}</td>
      </tr>`;
  }).join("");
  
  if (progressEl) progressEl.textContent = `${submittedCount}/12 weeks submitted`;
}

function _initStudentLogbook(token) {
  var section     = document.getElementById("student-logbook-section");
  var toggleBtn   = document.getElementById("btn-logbook-upload");
  var weekSel     = document.getElementById("logbook-week");
  var activitiesEl= document.getElementById("logbook-activities");
  var activitiesErr = document.getElementById("logbook-activities-err");
  var fileInput   = document.getElementById("logbook-file");
  var submitBtn   = document.getElementById("btn-logbook-submit");
  var msgEl       = document.getElementById("logbook-msg");

  if (!toggleBtn) return;

  // Populate weeks 1-12
  for (var w = 1; w <= 12; w++) {
    weekSel.innerHTML += '<option value="' + w + '">Week ' + w + '</option>';
  }

  toggleBtn.addEventListener("click", function() {
    section.classList.toggle("hidden");
    if (!section.classList.contains("hidden")) _loadStudentLogbooks(token);
  });

  // File validation
  fileInput.addEventListener("change", function() {
    var file = this.files[0];
    if (file) {
      if (!file.name.match(/\.pdf$|\.docx$/i)) {
        _showMsg(msgEl, "error", "Only PDF and DOCX files allowed");
        this.value = "";
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        _showMsg(msgEl, "error", "File must be ≤10MB");
        this.value = "";
        return;
      }
      _showMsg(msgEl, "success", "Selected: " + file.name + " (" + (file.size/1024/1024).toFixed(1) + "MB)");
    }
  });

  submitBtn.addEventListener("click", async function() {
    var week       = weekSel.value;
    var activities = activitiesEl ? activitiesEl.value.trim() : "";
    var file       = fileInput.files[0];

    // Clear previous errors
    if (activitiesErr) { activitiesErr.textContent = ""; activitiesErr.classList.add("hidden"); }

    if (!week) {
      _showMsg(msgEl, "error", "Please select a week.");
      return;
    }
    if (!activities) {
      _showMsg(msgEl, "error", "Activities description is required.");
      if (activitiesErr) { activitiesErr.textContent = "Activities are required."; activitiesErr.classList.remove("hidden"); }
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i>Submitting...';

    try {
      // Step 1: upload file via signed URL if provided
      var file_url = null;
      if (file) {
        _showMsg(msgEl, "success", "Uploading file…");
        var signResp = await fetch("/api/uploads/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ filename: file.name, content_type: file.type })
        });
        var signData = await signResp.json();
        if (!signData.ok) throw new Error(signData.error || "Could not get upload URL");

        var uploadResp = await fetch(signData.upload_url, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file
        });
        if (!uploadResp.ok) throw new Error("File upload failed (" + uploadResp.status + ")");
        file_url = signData.download_url || signData.public_url || signData.storage_path;
      }

      // Step 2: submit logbook entry as JSON
      var resp = await fetch("/api/logbook", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          week_number: parseInt(week, 10),
          activities:  activities,
          file_url:    file_url
        })
      });

      var result = await resp.json();
      if (!result.ok) throw new Error(result.error || "Submit failed");

      UI.showToast("success", "Week " + week + " logbook submitted!");
      weekSel.value = "";
      if (activitiesEl) activitiesEl.value = "";
      fileInput.value = "";
      _showMsg(msgEl, "success", "Submitted successfully");
      _loadStudentLogbooks(token);

    } catch (err) {
      _showMsg(msgEl, "error", err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Logbook';
    }
  });
}

async function _loadStudentLogbooks(token) {
  try {
    var r = await fetch("/api/logbook", { headers: { Authorization: "Bearer " + token } });
    if (r.ok) {
      var d = await r.json();
      _populateLogbookHistory(d.entries || []);
    }
  } catch (_) {}
}

async function _loadCoordStats(token) {
  window._coordToken = token; // make token available for assign buttons
  try {
    var r = await fetch("/api/coordinator/stats", {
      headers: { Authorization: "Bearer " + token }
    });
    if (r.ok) {
      var d = await r.json();
      if (d.ok) {
        if (d.students   != null) document.getElementById("stat-coord-students").textContent   = d.students;
        if (d.orgs       != null) document.getElementById("stat-coord-orgs").textContent       = d.orgs;
        if (d.unassigned != null) document.getElementById("stat-coord-unassigned").textContent = d.unassigned;
      }
    }
  } catch (_) {}
  _initCoordinatorMatching(token);
}

function _initCoordinatorMatching(token) {
  // Load matching data on init
  _loadMatchingData(token);

  var btn = document.getElementById("btn-auto-match");
  if (!btn || btn._bound) return;
  btn._bound = true;

  btn.addEventListener("click", async function() {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i>Running...';

    try {
      // Correct: send action as URL query param, not in body
      var resp = await fetch("/api/coordinator/matching?action=auto", {
        method: "POST",
        headers: { Authorization: "Bearer " + token }
      });
      var result = await resp.json();
      if (!result.ok) throw new Error(result.error || "Matching failed");

      UI.showToast("success", result.assigned_count + " students auto-matched!");
      // Refresh stats + matching data
      _loadCoordStats(token);
      _loadMatchingData(token);

    } catch (err) {
      UI.showToast("error", err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-magic mr-2"></i>Run Auto-Match';
    }
  });
}

async function _loadMatchingData(token) {
  try {
    var r = await fetch("/api/coordinator/matching", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!r.ok) return;
    var d = await r.json();
    if (!d.ok) return;

    var students  = d.students  || [];
    var orgs      = d.orgs      || [];

    var unmatched = students.filter(function(s) { return !s.placement || s.placement.status === "suggested"; });
    var matched   = students.filter(function(s) { return s.placement && s.placement.status === "assigned"; });

    // Available orgs: those with remaining capacity (no slot check for now — show all)
    _populateUnmatchedStudents(unmatched);
    _populateAvailableOrgs(orgs);

    // Build suggestions from unmatched students
    var suggestions = [];
    unmatched.forEach(function(s) {
      (s.suggestions || []).forEach(function(sg) {
        suggestions.push({
          student_name:  s.full_name || s.email,
          student_email: s.email,
          student_id:    s.student_id,
          org_id:        sg.org_id,
          org_name:      sg.org_name,
          match_score:   sg.score,
          status:        "suggested",
        });
      });
    });

    if (suggestions.length) _populateMatchSuggestions(suggestions);
  } catch (_) {}
}

function _populateUnmatchedStudents(students) {
  var container = document.getElementById("unmatched-students");
  var countEl = document.getElementById("unmatched-count");
  if (!container) return;

  countEl.textContent = students.length;
  container.innerHTML = students.map(function(s) {
    var skills = (s.extra && s.extra.skills) || 'No skills';
    var loc    = (s.extra && s.extra.preferred_location) || '—';
    return '<div class="p-4 border-b hover:bg-gray-50">' +
      '<div class="flex justify-between items-center">' +
        '<div>' +
          '<div class="font-semibold">' + _esc(s.full_name || s.email) + '</div>' +
          '<div class="text-sm text-gray-600">' + _esc(s.email) + '</div>' +
          '<div class="text-xs text-gray-500">' + _esc(skills) + '</div>' +
        '</div>' +
        '<span class="px-3 py-1 bg-gray-200 text-xs rounded-full">' + _esc(loc) + '</span>' +
      '</div>' +
    '</div>';
  }).join('') || '<p class="text-gray-500 text-center py-12">All students matched!</p>';
}

function _populateAvailableOrgs(orgs) {
  var container = document.getElementById("avail-orgs");
  var countEl = document.getElementById("avail-orgs-count");
  if (!container) return;

  countEl.textContent = orgs.length;
  container.innerHTML = orgs.map(function(o) {
    var name  = (o.extra && o.extra.org_name) || o.full_name || o.email;
    var skills = (o.extra && o.extra.required_skills) || 'No requirements';
    var loc    = (o.extra && o.extra.location) || '—';
    var slots  = (o.extra && o.extra.slots != null) ? o.extra.slots : '?';
    return '<div class="p-4 border-b hover:bg-gray-50">' +
      '<div class="flex justify-between items-center">' +
        '<div>' +
          '<div class="font-semibold">' + _esc(name) + '</div>' +
          '<div class="text-sm text-gray-600">' + _esc(skills) + '</div>' +
        '</div>' +
        '<span class="px-3 py-1 bg-blue-200 text-xs rounded-full">' + _esc(loc) + ' • ' + _esc(String(slots)) + ' slots</span>' +
      '</div>' +
    '</div>';
  }).join('') || '<p class="text-gray-500 text-center py-12">No orgs available</p>';
}

function _populateMatchSuggestions(suggestions) {
  var container = document.getElementById("suggestions-list");
  var section   = document.getElementById("match-suggestions");
  if (!container || !suggestions.length) return;

  section.classList.remove("hidden");

  container.innerHTML = suggestions.slice(0, 20).map(function(sugg) {
    var score = Math.round(sugg.match_score || 0);
    return '<div class="bg-white/20 backdrop-blur-sm rounded-xl p-4 flex items-center justify-between gap-4">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="font-bold">' + _esc(sugg.student_name || sugg.student_email) + '</div>' +
        '<div class="text-sm text-white/80">→ ' + _esc(sugg.org_name) + '</div>' +
        '<div class="text-xs text-white/60 mt-1">Match score: ' + score + '%</div>' +
      '</div>' +
      '<button class="assign-match flex-shrink-0 bg-green-500/80 hover:bg-green-400 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition"' +
        ' data-student="' + _esc(sugg.student_id) + '" data-org="' + _esc(sugg.org_id) + '">' +
        '<i class="fas fa-check mr-1"></i>Assign' +
      '</button>' +
    '</div>';
  }).join('');

  // Wire assign buttons — directly calls the manual assign endpoint
  container.querySelectorAll('.assign-match').forEach(function(btn) {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', async function() {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
      try {
        var token = window._coordToken;
        var resp  = await fetch("/api/coordinator/matching", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ student_id: btn.dataset.student, org_id: btn.dataset.org })
        });
        var r = await resp.json();
        if (!r.ok) throw new Error(r.error);
        btn.innerHTML = '<i class="fas fa-check"></i> Assigned';
        btn.className = btn.className.replace("bg-green-500/80", "bg-white/30");
        UI.showToast("success", "Student assigned.");
        _loadCoordStats(token);
      } catch (err) {
        UI.showToast("error", err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check mr-1"></i>Assign';
      }
    });
  });
}

async function _loadSupervisorStats(token, role) {
  try {
    var r = await fetch("/api/supervisor/my-students", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!r.ok) return;
    var d = await r.json();
    if (!d.ok) return;

    var countEl = document.getElementById("stat-sup-students");
    if (countEl) countEl.textContent = (d.students || []).length;

    var pendingEl = document.getElementById("stat-sup-pending");
    if (pendingEl) {
      var pending = (d.students || []).filter(function(s) {
        return role === "industrial_supervisor"
          ? (!s.report || s.report.status === "submitted")
          : (!s.evaluations || (!s.evaluations[1] && !s.evaluations[2]));
      }).length;
      pendingEl.textContent = pending;
    }

    // Populate students table
    _populateSupervisorStudents(d.students || [], role);

    // Init handlers
    _initSupervisorHandlers(token, role);

  } catch (_) {}
}

function _populateSupervisorStudents(students, role) {
  var tbody = document.getElementById("sup-students-body");
  var countEl = document.getElementById("sup-students-count");
  if (!tbody) return;

  countEl.textContent = students.length;

  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-12 text-gray-500">No students assigned</td></tr>';
    return;
  }

  tbody.innerHTML = students.map(function(student) {
    // API returns student_id (not id) and logbooks: { total, reviewed }
    var sid      = student.student_id || student.id || "";
    var progress = (student.logbooks && student.logbooks.total != null)
      ? student.logbooks.total
      : (student.logbook_count || 0);
    var reportStatus = student.report ? '✓ Submitted' : 'Pending';
    var evalCount    = student.evaluations ? Object.keys(student.evaluations).length : 0;
    var visitStatus  = evalCount + '/2';

    return '<tr class="hover:bg-gray-50 border-b last:border-b-0">' +
      '<td class="px-4 py-4 font-medium">' + _esc(student.full_name || student.email || "—") + '</td>' +
      '<td class="px-4 py-4">' +
        '<div>Logbooks: <span class="font-semibold">' + progress + '/12</span></div>' +
        '<div class="text-sm text-gray-600">' + (role === 'industrial_supervisor' ? reportStatus : visitStatus) + '</div>' +
      '</td>' +
      '<td class="px-6 py-4 text-center">' +
        (role === 'industrial_supervisor'
          ? '<button class="report-btn bg-warning text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-warning-dark transition ml-1" data-student-id="' + _esc(sid) + '"><i class="fas fa-star mr-1"></i>Report</button>'
          : '<button class="visit-btn bg-primary text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-primary-dark mr-1" data-visit="1" data-student-id="' + _esc(sid) + '">Visit 1</button>' +
            '<button class="visit-btn bg-accent text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-accent-dark" data-visit="2" data-student-id="' + _esc(sid) + '">Visit 2</button>'
        ) +
      '</td>' +
    '</tr>';
  }).join('');
}

function _initSupervisorHandlers(token, role) {
  // Report modal (industrial)
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('report-btn')) {
      var studentId = e.target.dataset.studentId;
      _showReportModal(studentId, token);
    } else if (e.target.classList.contains('visit-btn')) {
      var studentId = e.target.dataset.studentId;
      var visitNum = e.target.dataset.visit;
      _showEvalModal(studentId, visitNum, token);
    }
  });

  // Modal close handlers
  ['report-cancel', 'eval-cancel'].forEach(id => {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', _closeModals);
  });

  document.addEventListener('click', function(e) {
    if (e.target.id === 'report-modal' || e.target.id === 'eval-modal') _closeModals();
  });
}

function _closeModals() {
  document.getElementById('report-modal').style.display = 'none';
  document.getElementById('eval-modal').style.display = 'none';
  // Reset forms
  document.querySelectorAll('.star-rating').forEach(star => star.classList.remove('filled'));
  document.getElementById('report-rating-val').textContent = 'Select rating';
  document.getElementById('eval-rating-val').textContent = 'Select rating';
  ['report-comments', 'eval-comments'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('report-file').value = '';
  document.getElementById('eval-date').value = '';
  document.querySelectorAll('#report-submit, #eval-submit').forEach(btn => btn.disabled = true);
}

function _showReportModal(studentId, token) {
  window.currentStudentId = studentId;
  document.getElementById('report-modal').style.display = 'flex';
  _initStarRatings('report-stars', 'report-rating-val', 'report-submit');
}

function _showEvalModal(studentId, visitNum, token) {
  window.currentStudentId = studentId;
  window.currentVisitNum = visitNum;
  document.getElementById('eval-title').textContent = `Visit ${visitNum} Evaluation`;
  document.getElementById('eval-modal').style.display = 'flex';
  _initStarRatings('eval-stars', 'eval-rating-val', 'eval-submit');
}

function _initStarRatings(containerId, valId, submitId) {
  var stars = document.querySelectorAll(`#${containerId} .star-rating`);
  var valEl = document.getElementById(valId);
  var submitBtn = document.getElementById(submitId);

  stars.forEach(function(star, index) {
    star.addEventListener('click', function() {
      var rating = parseInt(this.dataset.rating);
      stars.forEach((s, i) => s.classList.toggle('filled', i < rating));
      valEl.textContent = `${rating}/5 stars`;
      submitBtn.disabled = false;
    });
    star.addEventListener('mouseover', function() {
      var rating = parseInt(this.dataset.rating);
      stars.forEach((s, i) => s.classList.toggle('filled', i < rating));
    });
  });

  stars[0].dispatchEvent(new Event('mouseover')); // Reset hover

  // Submit handlers
  document.getElementById('report-submit')?.addEventListener('click', _submitReport.bind(null, token));
  document.getElementById('eval-submit')?.addEventListener('click', _submitEval.bind(null, token));
}

async function _submitReport(token) {
  var rating = parseInt(document.querySelector('#report-stars .filled:last-child')?.dataset.rating || 0);
  var comments = document.getElementById('report-comments').value.trim();

  if (rating === 0 || !comments) {
    UI.showToast("error", "Rating and comments required");
    return;
  }

  // Convert 1-5 stars to 0-100 score (each star = 20 points)
  var score = rating * 20;

  try {
    var resp = await fetch("/api/reports/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        student_id: window.currentStudentId,
        score:      score,
        comments:   comments
      })
    });
    var result = await resp.json();
    if (!result.ok) throw new Error(result.error);

    UI.showToast("success", "Report graded (" + score + "/100)!");
    _closeModals();
    _loadSupervisorStats(token, window._userProfile.role);
  } catch (err) {
    UI.showToast("error", err.message);
  }
}

async function _submitEval(token) {
  var rating = parseInt(document.querySelector('#eval-stars .filled:last-child')?.dataset.rating || 0);
  var comments = document.getElementById('eval-comments').value.trim();
  var date = document.getElementById('eval-date').value;

  if (rating === 0 || !comments) {
    UI.showToast("error", "Rating and comments required");
    return;
  }

  // Convert 1-5 stars to 0-100 score
  var score = rating * 20;

  try {
    var resp = await fetch("/api/supervisor/evaluate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({
        student_id:   window.currentStudentId,
        visit_number: parseInt(window.currentVisitNum, 10),
        score:        score,
        comments:     comments,
        visit_date:   date || null
      })
    });
    var result = await resp.json();
    if (!result.ok) throw new Error(result.error);
    
    UI.showToast("success", `Visit ${window.currentVisitNum} evaluation submitted!`);
    _closeModals();
    _loadSupervisorStats(token, window._userProfile.role);
  } catch (err) {
    UI.showToast("error", err.message);
  }
}

async function _loadDeadlines(token, role) {
  try {
    var r = await fetch("/api/deadlines?role=" + encodeURIComponent(role || ""), {
      headers: { Authorization: "Bearer " + token }
    });
    if (!r.ok) return;
    var d = await r.json();
    if (!d.ok || !d.deadlines || !d.deadlines.length) return;

    var list = document.getElementById("deadlines-list");
    list.innerHTML = d.deadlines.map(function(dl) {
      return (
        '<div class="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">' +
          '<div>' +
            '<div class="font-semibold text-gray-800 text-sm">' + _esc(dl.title) + '</div>' +
            (dl.message ? '<div class="text-xs text-gray-500 mt-0.5">' + _esc(dl.message) + '</div>' : '') +
          '</div>' +
          '<div class="text-xs text-gray-400 ml-4 flex-shrink-0">' + _esc(dl.due_date || "") + '</div>' +
        '</div>'
      );
    }).join("");

    var countEl = document.getElementById("stat-deadlines-s") ||
                  document.getElementById("stat-deadlines-o");
    if (countEl) countEl.textContent = d.deadlines.length;
  } catch (_) {}
}

function _esc(s) {
  return String(s || "").replace(/[&<>"']/g, function(c) {
    return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
  });
}
