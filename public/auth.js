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

function isStudentUbEmail(email) {
  return /^\d{9}@ub\.co\.bw$/i.test(String(email || "").trim());
}
function isUniversitySupervisorEmail(email) {
  return /^[^\s@]+@ub\.ac\.bw$/i.test(String(email || "").trim());
}

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
  var activated = new URLSearchParams(window.location.search).get("activated");
  if (activated === "supervisor") {
    try { await sb.auth.signOut(); } catch (_) {}
    var loginAlert = document.getElementById("login-alert");
    if (loginAlert) UI.showAlert(loginAlert, "success", "Supervisor account activated. Please sign in with your email and password.");
    switchTab("login");
    return;
  }
  var session = (await sb.auth.getSession()).data.session;
  if (session) window.location.href = "/dashboard.html";
})();

// ---- LOGIN ----
document.getElementById("loginForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  var alertEl = document.getElementById("login-alert");
  var btn     = document.getElementById("btnLogin");
  UI.hideAlert(alertEl);
  clearFieldErrors(["logEmail", "logPass", "logRole"]);

  var email = document.getElementById("logEmail").value.trim();
  var pass  = document.getElementById("logPass").value;
  var selectedRole = document.getElementById("logRole").value;

  var valid = true;
  if (!email) { setFieldError("logEmail", "Email is required."); valid = false; }
  if (!pass)  { setFieldError("logPass",  "Password is required."); valid = false; }
  if (!selectedRole) { setFieldError("logRole", "Choose the account type you are signing in as."); valid = false; }
  if (!valid) return;

  UI.setLoading(btn, true);
  var result = await sb.auth.signInWithPassword({ email: email, password: pass });
  UI.setLoading(btn, false);

  if (result.error) {
    UI.showAlert(alertEl, "error", result.error.message);
    UI.showToast("error", result.error.message);
    return;
  }

  // Verify that the selected role matches the database profile role before routing.
  try {
    var session = (await sb.auth.getSession()).data.session;
    var profileResp = await fetch("/api/profile/me", { headers: { Authorization: "Bearer " + session.access_token } });
    var profileJson = await profileResp.json().catch(function(){ return { ok:false, error:"Could not verify profile role." }; });
    var actualRole = profileJson && profileJson.profile && profileJson.profile.role;
    if (!profileJson.ok || !actualRole) throw new Error(profileJson.error || "Could not verify profile role.");
    if (actualRole !== selectedRole) {
      await sb.auth.signOut();
      var roleLabels = {
        student: "Student", organization: "Organisation", coordinator: "Coordinator",
        industrial_supervisor: "Industrial Supervisor", university_supervisor: "University Supervisor"
      };
      var msg = "This account is registered as " + (roleLabels[actualRole] || actualRole) + ". Please choose the correct login role.";
      UI.showAlert(alertEl, "error", msg);
      setFieldError("logRole", msg);
      UI.showToast("error", "Wrong login role selected.");
      return;
    }
  } catch (roleErr) {
    await sb.auth.signOut();
    UI.showAlert(alertEl, "error", roleErr.message);
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
  var confirmPass = document.getElementById("regConfirmPass").value;

  // Clear all field errors
  clearFieldErrors(["regName", "regEmail", "regPass", "regConfirmPass",
    "regOrgName", "regIndustry", "regContact", "regOrgLocation"]);

  // --- Validate common fields ---
  var valid = true;
  if (!fullName)        { setFieldError("regName",  "Full name is required."); valid = false; }
  if (!email)           { setFieldError("regEmail", "Email is required."); valid = false; }
  else if (role === "student" && !isStudentUbEmail(email)) { setFieldError("regEmail", "Student email must use your 9-digit UB student number, for example 201801639@ub.co.bw."); valid = false; }
  if (pass.length < 6) { setFieldError("regPass",  "Min 6 characters."); valid = false; }
  if (!confirmPass) { setFieldError("regConfirmPass", "Please confirm your password."); valid = false; }
  else if (pass !== confirmPass) { setFieldError("regConfirmPass", "Passwords do not match."); valid = false; }

  // --- Validate role-specific fields ---
  var extraData = {};

  if (role === "student") {
    // Avoid duplicate data collection. Student academic details, skills and
    // preferred location are completed once in My Profile after registration.
    extraData = {};

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
