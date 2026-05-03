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

  function renderAvatarPreview(url, fallbackName) {
    var el = document.getElementById("orgAvatarPreview");
    if (!el) return;
    if (url) el.innerHTML = '<img src="' + url + '" alt="Profile image" style="width:100%;height:100%;object-fit:cover"/>';
    else el.textContent = (String(fallbackName || 'ORG').trim().split(/\s+/).slice(0,2).map(function(x){ return x.charAt(0); }).join('') || 'ORG').toUpperCase();
  }

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
    renderAvatarPreview(profile.avatar_url || '', profile.full_name || profile.email);
  } else {
    renderAvatarPreview('', session.user.email);
  }
  if (extra) {
    document.getElementById("orgName").value     = extra.org_name       || "";
    document.getElementById("orgIndustry").value = extra.industry       || "";
    document.getElementById("orgLocation").value = extra.location       || "";
    document.getElementById("orgContact").value  = extra.contact_person || "";
    document.getElementById("orgSlots").value    = extra.slots != null  ? extra.slots : "";
  }

  

  var avatarInput = document.getElementById("orgAvatar");
  var avatarName = document.getElementById("orgAvatarName");
  var uploadedAvatarUrl = profile && profile.avatar_url ? profile.avatar_url : "";
  if (avatarInput) avatarInput.addEventListener("change", async function () {
    var file = avatarInput.files && avatarInput.files[0];
    if (!file) return;
    if (avatarName) avatarName.textContent = file.name;
    renderAvatarPreview(URL.createObjectURL(file), document.getElementById("orgName").value || session.user.email);
    try {
      var sign = await fetch('/api/uploads/sign', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + session.access_token }, body: JSON.stringify({ filename:file.name, content_type:file.type, size:file.size, kind:"profile" || 'image/jpeg' }) });
      var signed = await sign.json();
      if (!signed.ok) throw new Error(signed.error);
      var up = await fetch(signed.upload_url, { method:'PUT', headers:{ 'Content-Type': file.type || 'application/octet-stream', 'x-upsert':'true' }, body:file });
      if (!up.ok) throw new Error('Image upload failed');
      uploadedAvatarUrl = signed.download_url || signed.public_url || '';
      UI.showToast('success', 'Image uploaded. Remember to save the profile.');
    } catch (err) {
      console.error(err);
      UI.showToast('error', 'Image upload failed: ' + err.message);
    }
  });
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
      avatar_url: uploadedAvatarUrl || (profile && profile.avatar_url) || null,
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

      if (window._userProfile) {
        window._userProfile.phone = updates.phone;
        if (uploadedAvatarUrl) window._userProfile.avatar_url = uploadedAvatarUrl;
      }
      if (uploadedAvatarUrl) renderAvatarPreview(uploadedAvatarUrl, orgName);
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
