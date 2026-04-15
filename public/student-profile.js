// public/student-profile.js
const { createClient } = supabase;
window._sb = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

var SKILLS = [
  "Python","Java","JavaScript","SQL","React","Node.js","C++","PHP",
  "HTML/CSS","Django","Data Analysis","Machine Learning",
  "Database Management","Network Administration","Cybersecurity",
  "Software Testing","Project Management","Microsoft Office","Communication"
];

(async function () {
  var session = await UI.protectRoute("student");
  if (!session) return;

  var profile = window._userProfile;
  var extra   = window._userExtra;

  UI.renderNav("student", session.user.email);

  // Build skills grid
  var savedSkills = extra && extra.skills
    ? extra.skills.split(",").map(function(s){ return s.trim().toLowerCase(); })
    : [];

  var grid = document.getElementById("skills-grid");
  grid.innerHTML = SKILLS.map(function(sk) {
    var isSelected = savedSkills.indexOf(sk.toLowerCase()) !== -1;
    return '<label class="skill-chip' + (isSelected ? ' selected' : '') + '">' +
      '<input type="checkbox" class="skill-cb" value="' + sk + '"' + (isSelected ? ' checked' : '') + '/>' +
      '<span>' + sk + '</span></label>';
  }).join("");

  // Toggle chip selected class
  grid.addEventListener("change", function(e) {
    if (e.target.classList.contains("skill-cb")) {
      e.target.closest("label").classList.toggle("selected", e.target.checked);
    }
  });

  // Pre-fill other skills (any saved skills NOT in the preset list go to "other")
  var otherSaved = savedSkills.filter(function(sk) {
    return SKILLS.map(function(s){ return s.toLowerCase(); }).indexOf(sk) === -1;
  });
  if (otherSaved.length) {
    document.getElementById("pfOtherSkills").value = otherSaved.join(", ");
  }

  // Pre-fill profile fields
  if (profile) {
    document.getElementById("pfName").value  = profile.full_name || "";
    document.getElementById("pfPhone").value = profile.phone     || "";
    document.getElementById("pfEmail").value = profile.email     || session.user.email;
  }
  if (extra) {
    document.getElementById("pfStudentNum").value = extra.student_number     || "";
    document.getElementById("pfProgram").value    = extra.program            || "";
    document.getElementById("pfYear").value       = extra.year_of_study      || "";
    document.getElementById("pfLocation").value   = extra.preferred_location || "";
    // Show existing CV link
    if (extra.cv_url) {
      var cvCurrent = document.getElementById("cv-current");
      var cvLink    = document.getElementById("cv-link");
      if (cvCurrent) cvCurrent.style.display = "";
      if (cvLink)    cvLink.href = extra.cv_url;
    }
  }

  // CV file name display
  document.getElementById("pfCv").addEventListener("change", function() {
    var file = this.files[0];
    document.getElementById("cv-filename").textContent = file ? file.name : "No file chosen";
  });

  // Save handler
  document.getElementById("profileForm").addEventListener("submit", async function(e) {
    e.preventDefault();
    var alertEl = document.getElementById("profile-alert");
    var btn     = document.getElementById("btnSave");
    UI.hideAlert(alertEl);
    clearErrors();

    var fullName = document.getElementById("pfName").value.trim();
    var location = document.getElementById("pfLocation").value.trim();

    var valid = true;
    if (!fullName) {
      document.getElementById("pfName").classList.add("is-error");
      document.getElementById("pfName-err").textContent = "Full name is required.";
      valid = false;
    }

    // Collect skills
    var checked = Array.from(document.querySelectorAll(".skill-cb:checked")).map(function(el){ return el.value; });
    var other   = document.getElementById("pfOtherSkills").value.trim();
    if (other) {
      var extra_skills = other.split(",").map(function(s){ return s.trim(); }).filter(Boolean);
      checked = checked.concat(extra_skills);
    }
    if (checked.length === 0) {
      document.getElementById("pfSkills-err").textContent = "Please select at least one skill.";
      valid = false;
    }
    if (!location) {
      document.getElementById("pfLocation-err").textContent = "Please select a preferred location.";
      valid = false;
    }
    if (!valid) {
      UI.showAlert(alertEl, "error", "Please fill in the required fields.");
      return;
    }

    UI.setLoading(btn, true);

    try {
      // Upload CV if selected
      var cv_url = (extra && extra.cv_url) || null;
      var cvFile = document.getElementById("pfCv").files[0];
      if (cvFile) {
        try {
          var statusEl = document.getElementById("cv-status");
          if (statusEl) statusEl.textContent = "Uploading CV…";
          var signRes = await fetch("/api/uploads/sign", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
            body: JSON.stringify({ filename: cvFile.name, content_type: cvFile.type })
          });
          var signData = await signRes.json();
          if (signData.ok) {
            var uploadRes = await fetch(signData.upload_url, {
              method: "PUT",
              headers: { "Content-Type": cvFile.type },
              body: cvFile
            });
            if (uploadRes.ok) {
              // Prefer the pre-signed download URL so the stored value is
              // directly accessible; fall back to storage_path if unavailable.
              cv_url = signData.download_url || signData.public_url || signData.storage_path;
              if (statusEl) statusEl.textContent = "CV uploaded successfully.";
            }
          }
        } catch (uploadErr) {
          UI.showToast("error", "CV upload failed: " + uploadErr.message + ". Profile saved without CV.");
        }
      }

      var updates = {
        full_name: fullName,
        phone:     document.getElementById("pfPhone").value.trim()
      };
      var extraPayload = {
        student_number:     document.getElementById("pfStudentNum").value.trim() || null,
        program:            document.getElementById("pfProgram").value.trim(),
        year_of_study:      document.getElementById("pfYear").value || null,
        skills:             checked.join(", "),
        preferred_location: location
      };
      if (cv_url) extraPayload.cv_url = cv_url;

      var r = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ updates: updates, extra: extraPayload, role: "student" })
      });
      var result = await r.json().catch(function(){ return { ok: false, error: "Server error." }; });

      if (!result.ok) throw new Error(result.error || "Save failed");

      UI.showAlert(alertEl, "success", "Profile saved successfully!");
      UI.showToast("success", "Profile updated!");

      // Update in-memory
      if (window._userProfile) {
        window._userProfile.full_name = updates.full_name;
        window._userProfile.phone     = updates.phone;
      }
      if (window._userExtra) {
        window._userExtra.skills             = extraPayload.skills;
        window._userExtra.preferred_location = extraPayload.preferred_location;
        if (cv_url) window._userExtra.cv_url = cv_url;
      }

    } catch (err) {
      UI.showAlert(alertEl, "error", err.message || "Failed to save profile.");
      UI.showToast("error", err.message || "Save failed.");
    } finally {
      UI.setLoading(btn, false);
    }
  });

  function clearErrors() {
    ["pfName","pfLocation"].forEach(function(id) {
      var el  = document.getElementById(id);
      var err = document.getElementById(id + "-err");
      if (el)  el.classList.remove("is-error");
      if (err) err.textContent = "";
    });
    document.getElementById("pfSkills-err").textContent = "";
  }
})();
