// public/auth.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);
const sb = window._sb;

// ---- Tab switching ----
document.querySelectorAll(".auth-tab").forEach(function (tab) {
  tab.addEventListener("click", function () { switchTab(tab.dataset.tab); });
});
document.querySelectorAll("[data-switch]").forEach(function (link) {
  link.addEventListener("click", function (e) {
    e.preventDefault();
    switchTab(link.dataset.switch);
  });
});

function switchTab(name) {
  document.querySelectorAll(".auth-tab").forEach(function (t) {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".auth-panel").forEach(function (p) {
    p.classList.toggle("active", p.id === "panel-" + name);
  });
}

// ---- Role-specific field toggling ----
var regRole = document.getElementById("regRole");
var fieldsStudent = document.getElementById("fields-student");
var fieldsOrg     = document.getElementById("fields-org");
var labelName     = document.getElementById("label-regName");

function applyRoleFields() {
  var role = regRole.value;
  if (role === "student") {
    fieldsStudent.style.display = "";
    fieldsOrg.style.display     = "none";
    labelName.innerHTML = 'Full name <span class="required">*</span>';
  } else {
    fieldsStudent.style.display = "none";
    fieldsOrg.style.display     = "";
    labelName.innerHTML = 'Your full name (contact person) <span class="required">*</span>';
  }
}
regRole.addEventListener("change", applyRoleFields);
applyRoleFields(); // run once on load

// ---- Redirect if already signed in ----
(async function () {
  var session = (await sb.auth.getSession()).data.session;
  if (session) window.location.href = "/dashboard.html";
})();

// ---- LOGIN ----
document.getElementById("loginForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  var alertEl = document.getElementById("login-alert");
  var btn     = document.getElementById("btnLogin");
  UI.hideAlert(alertEl);
  clearFieldErrors(["logEmail", "logPass"]);

  var email = document.getElementById("logEmail").value.trim();
  var pass  = document.getElementById("logPass").value;

  var valid = true;
  if (!email) { setFieldError("logEmail", "Email is required."); valid = false; }
  if (!pass)  { setFieldError("logPass",  "Password is required."); valid = false; }
  if (!valid) return;

  UI.setLoading(btn, true);
  var result = await sb.auth.signInWithPassword({ email: email, password: pass });
  UI.setLoading(btn, false);

  if (result.error) {
    UI.showAlert(alertEl, "error", result.error.message);
    UI.showToast("error", result.error.message);
    return;
  }

  UI.showToast("success", "Signed in!");
  window.location.href = "/dashboard.html";
});

// ---- REGISTER ----
document.getElementById("regForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  var alertEl = document.getElementById("reg-alert");
  var btn     = document.getElementById("btnReg");
  UI.hideAlert(alertEl);

  var role     = document.getElementById("regRole").value;
  var fullName = document.getElementById("regName").value.trim();
  var email    = document.getElementById("regEmail").value.trim();
  var pass     = document.getElementById("regPass").value;

  // Clear all field errors
  clearFieldErrors(["regName", "regEmail", "regPass",
    "regStudentNum", "regProgram", "regYear",
    "regOrgName", "regIndustry", "regContact", "regOrgLocation"]);

  // --- Validate common fields ---
  var valid = true;
  if (!fullName)        { setFieldError("regName",  "Full name is required."); valid = false; }
  if (!email)           { setFieldError("regEmail", "Email is required."); valid = false; }
  if (pass.length < 6) { setFieldError("regPass",  "Min 6 characters."); valid = false; }

  // --- Validate role-specific fields ---
  var extraData = {};

  if (role === "student") {
    var studentNum = document.getElementById("regStudentNum").value.trim();
    var program    = document.getElementById("regProgram").value.trim();
    var year       = document.getElementById("regYear").value;
    var location   = document.getElementById("regLocation").value.trim();

    if (!studentNum) { setFieldError("regStudentNum", "Student number is required."); valid = false; }
    if (!program)    { setFieldError("regProgram",    "Programme is required."); valid = false; }
    if (!year)       { setFieldError("regYear",       "Year of study is required."); valid = false; }

    extraData = {
      student_number:    studentNum,
      program:           program,
      year_of_study:     parseInt(year, 10) || null,
      preferred_location: location,
    };

  } else if (role === "organization") {
    var orgName  = document.getElementById("regOrgName").value.trim();
    var industry = document.getElementById("regIndustry").value;
    var contact  = document.getElementById("regContact").value.trim();
    var orgLoc   = document.getElementById("regOrgLocation").value.trim();
    var slots    = parseInt(document.getElementById("regSlots").value, 10) || 0;

    if (!orgName)  { setFieldError("regOrgName",      "Organisation name is required."); valid = false; }
    if (!industry) { setFieldError("regIndustry",     "Please select an industry."); valid = false; }
    if (!contact)  { setFieldError("regContact",      "Contact person is required."); valid = false; }
    if (!orgLoc)   { setFieldError("regOrgLocation",  "Location is required."); valid = false; }

    extraData = {
      org_name:       orgName,
      industry:       industry,
      contact_person: contact,
      location:       orgLoc,
      slots:          slots,
    };
  }

  if (!valid) return;

  UI.setLoading(btn, true);

  // Create user + profile via backend admin API (no email sent)
  var r = await fetch("/api/profile/register", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ role: role, email: email, password: pass, full_name: fullName, extra: extraData })
  });

  var result = await r.json().catch(function () {
    return { ok: false, error: "Server did not respond. Please try again." };
  });

  UI.setLoading(btn, false);

  if (!result.ok) {
    UI.showAlert(alertEl, "error", result.error || "Registration failed.");
    UI.showToast("error", result.error || "Registration failed.");
    return;
  }

  UI.showAlert(alertEl, "success", "Account created! You can now sign in.");
  UI.showToast("success", "Account created successfully!");
  setTimeout(function () { switchTab("login"); }, 2000);
});

// ---- Helpers ----
function setFieldError(fieldId, msg) {
  var el  = document.getElementById(fieldId);
  var err = document.getElementById(fieldId + "-err");
  if (el)  el.classList.add("is-error");
  if (err) err.textContent = msg;
}
function clearFieldErrors(ids) {
  ids.forEach(function (id) {
    var el  = document.getElementById(id);
    var err = document.getElementById(id + "-err");
    if (el)  el.classList.remove("is-error");
    if (err) err.textContent = "";
  });
}
