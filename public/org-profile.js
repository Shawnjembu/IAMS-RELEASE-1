// public/org-profile.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

var SKILLS = [
  "Python","Java","JavaScript","SQL","React","Node.js","C++","PHP",
  "HTML/CSS","Django","Data Analysis","Machine Learning",
  "Database Management","Network Administration","Cybersecurity",
  "Software Testing","Project Management","Microsoft Office","Communication"
];

(async function () {
  var session = await UI.protectRoute("organization");
  if (!session) return;

  var profile = window._userProfile;
  var extra   = window._userExtra;

  UI.renderNav("organization", session.user.email);

  // Build required skills grid
  var savedSkills = extra && extra.required_skills
    ? extra.required_skills.split(",").map(function(s){ return s.trim().toLowerCase(); })
    : [];

  var grid = document.getElementById("org-skills-grid");
  grid.innerHTML = SKILLS.map(function(sk) {
    var isSelected = savedSkills.indexOf(sk.toLowerCase()) !== -1;
    return '<label class="skill-chip' + (isSelected ? ' selected' : '') + '">' +
      '<input type="checkbox" class="skill-cb" value="' + sk + '"' + (isSelected ? ' checked' : '') + '/>' +
      '<span>' + sk + '</span></label>';
  }).join("");

  grid.addEventListener("change", function(e) {
    if (e.target.classList.contains("skill-cb")) {
      e.target.closest("label").classList.toggle("selected", e.target.checked);
    }
  });

  // Other saved skills that aren't in the preset list
  var otherSaved = savedSkills.filter(function(sk) {
    return SKILLS.map(function(s){ return s.toLowerCase(); }).indexOf(sk) === -1;
  });
  if (otherSaved.length) {
    document.getElementById("orgOtherSkills").value = otherSaved.join(", ");
  }

  // Pre-fill org fields
  if (profile) {
    document.getElementById("orgPhone").value = profile.phone || "";
    document.getElementById("orgEmail").value = profile.email || session.user.email;
  }
  if (extra) {
    document.getElementById("orgName").value     = extra.org_name       || "";
    document.getElementById("orgIndustry").value = extra.industry       || "";
    document.getElementById("orgLocation").value = extra.location       || "";
    document.getElementById("orgContact").value  = extra.contact_person || "";
    document.getElementById("orgSlots").value    = extra.slots != null  ? extra.slots : "";
  }

  // Save handler
  document.getElementById("orgForm").addEventListener("submit", async function(e) {
    e.preventDefault();
    var alertEl = document.getElementById("org-alert");
    var btn     = document.getElementById("btnSaveOrg");
    UI.hideAlert(alertEl);
    clearErrors();

    var orgName  = document.getElementById("orgName").value.trim();
    var location = document.getElementById("orgLocation").value.trim();
    var contact  = document.getElementById("orgContact").value.trim();

    var valid = true;
    if (!orgName)  { setErr("orgName",     "Organisation name is required."); valid = false; }
    if (!location) { setErr("orgLocation", "Location is required.");           valid = false; }
    if (!contact)  { setErr("orgContact",  "Contact person is required.");     valid = false; }
    if (!valid) {
      UI.showAlert(alertEl, "error", "Please fill in the required fields.");
      return;
    }

    // Collect required skills
    var checked = Array.from(document.querySelectorAll(".skill-cb:checked")).map(function(el){ return el.value; });
    var other   = document.getElementById("orgOtherSkills").value.trim();
    if (other) {
      checked = checked.concat(other.split(",").map(function(s){ return s.trim(); }).filter(Boolean));
    }

    var updates = {
      phone: document.getElementById("orgPhone").value.trim()
    };
    var extraPayload = {
      org_name:        orgName,
      industry:        document.getElementById("orgIndustry").value.trim(),
      location:        location,
      contact_person:  contact,
      slots:           parseInt(document.getElementById("orgSlots").value, 10) || 0,
      required_skills: checked.join(", ")
    };

    UI.setLoading(btn, true);
    try {
      var r = await fetch("/api/profile/update", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body:    JSON.stringify({ updates: updates, extra: extraPayload, role: "organization" })
      });
      var result = await r.json().catch(function(){ return { ok: false, error: "Server error." }; });

      if (!result.ok) throw new Error(result.error || "Save failed");

      UI.showAlert(alertEl, "success", "Organisation profile saved!");
      UI.showToast("success", "Profile updated!");

      if (window._userProfile) window._userProfile.phone = updates.phone;
      if (window._userExtra) Object.assign(window._userExtra, extraPayload);

    } catch (err) {
      UI.showAlert(alertEl, "error", err.message || "Failed to save profile.");
      UI.showToast("error", err.message || "Save failed.");
    } finally {
      UI.setLoading(btn, false);
    }
  });

  function setErr(id, msg) {
    var el  = document.getElementById(id);
    var err = document.getElementById(id + "-err");
    if (el)  el.classList.add("is-error");
    if (err) err.textContent = msg;
  }
  function clearErrors() {
    ["orgName","orgLocation","orgContact"].forEach(function(id) {
      var el  = document.getElementById(id);
      var err = document.getElementById(id + "-err");
      if (el)  el.classList.remove("is-error");
      if (err) err.textContent = "";
    });
  }
})();
