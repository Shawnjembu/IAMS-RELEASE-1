// public/_ui.js — shared UI helpers
// Must be loaded AFTER config.js and the Supabase CDN script.
// Assumes window._sb is set by the page script before calling protectRoute().

(function () {

  // ------------------------------------------------------------------ Toast --
  function showToast(type, message, durationMs) {
    durationMs = durationMs || 4000;
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      document.body.appendChild(container);
    }
    const t = document.createElement("div");
    t.className = "toast toast-" + type;
    t.textContent = message;
    container.appendChild(t);
    setTimeout(function () {
      t.classList.add("hiding");
      setTimeout(function () { t.remove(); }, 280);
    }, durationMs);
  }

  // ------------------------------------------------------- Button loading state
  // Expects button HTML: <button class="btn ..."><span class="spinner"></span><span class="btn-label">Label</span></button>
  function setLoading(el, bool) {
    if (!el) return;
    el.disabled = bool;
    el.classList.toggle("is-loading", bool);
  }

  // ------------------------------------------------------- Inline alert helpers
  function showAlert(el, type, message) {
    if (!el) return;
    el.className = "alert alert-" + type;
    el.textContent = message;
    el.classList.remove("hidden");
  }
  function hideAlert(el) {
    if (!el) return;
    el.className = "alert hidden";
    el.textContent = "";
  }



  function applyRoleBackground(role) {
    var roles = ["student", "organization", "coordinator", "industrial_supervisor", "university_supervisor"];
    roles.forEach(function (r) {
      document.body.classList.remove("app-bg-" + r);
      document.body.classList.remove("bg-" + r);
    });
    if (role && roles.indexOf(role) >= 0) {
      document.body.classList.add("app-bg-" + role);
      document.body.classList.add("bg-" + role);
    }
  }

  // ------------------------------------------------------- Role-based nav
  var NAV_ITEMS = {
    student: [
      { href: "/dashboard.html",       label: "Dashboard"  },
      { href: "/student-profile.html", label: "My Profile" },
      { href: "/placement.html",       label: "Placement"  },
      { href: "/logbook.html",         label: "Logbook"    },
      { href: "/report.html",          label: "My Report"  },
      { href: "/deadlines.html",       label: "Deadlines"  },
      { href: "/messages.html",        label: "Messages"   }
    ],
    organization: [
      { href: "/dashboard.html",   label: "Dashboard"    },
      { href: "/org-profile.html", label: "My Profile" },
      { href: "/students.html",    label: "My Students"  },
      { href: "/deadlines.html",   label: "Deadlines"    },
      { href: "/messages.html",    label: "Messages"     }
    ],
    coordinator: [
      { href: "/dashboard.html",    label: "Dashboard"    },
      { href: "/coordinator-profile.html", label: "My Profile" },
      { href: "/matching.html",     label: "Matching"     },
      { href: "/coordinator.html",  label: "Supervisors"  },
      { href: "/deadlines.html",    label: "Deadlines"    },
      { href: "/messages.html",     label: "Messages"     }
    ],
    industrial_supervisor: [
      { href: "/dashboard.html",             label: "Dashboard"  },
      { href: "/supervisor-profile.html",    label: "My Profile" },
      { href: "/supervisor-industrial.html", label: "My Students" },
      { href: "/messages.html",              label: "Messages"   }
    ],
    university_supervisor: [
      { href: "/dashboard.html",             label: "Dashboard"  },
      { href: "/supervisor-profile.html",    label: "My Profile" },
      { href: "/supervisor-university.html", label: "Reports & Visits" },
      { href: "/deadlines.html",             label: "Deadlines"  },
      { href: "/messages.html",              label: "Messages"   }
    ]
  };

  function renderNav(role, userEmail) {
    applyRoleBackground(role);
    var header = document.getElementById("site-header");
    if (!header) return;

    var currentPath = window.location.pathname;
    var items = NAV_ITEMS[role] || [];
    var links = items.map(function (l) {
      var isActive = currentPath === l.href ||
                     currentPath.endsWith(l.href.replace(/^\//, ""));
      return '<a href="' + l.href + '"' + (isActive ? ' class="active"' : '') + '>' + l.label + '</a>';
    }).join("");

    var badgeClass = role || "student";
    var emailHtml  = userEmail
      ? '<span class="muted small">' + _esc(userEmail) + '</span>'
      : "";

    header.innerHTML =
      '<a class="brand" href="/dashboard.html">CS Attachment Portal</a>' +
      '<nav class="site-nav">' + links + '</nav>' +
      '<div class="header-user">' +
        '<span class="badge-role ' + badgeClass + '">' + _esc(role || "") + '</span>' +
        emailHtml +
        '<button class="btn btn-secondary btn-sm" id="btn-nav-logout">' +
          '<span class="spinner"></span><span class="btn-label">Sign out</span>' +
        '</button>' +
      '</div>';

    document.getElementById("btn-nav-logout").addEventListener("click", async function () {
      setLoading(this, true);
      try { sessionStorage.removeItem("iams_profile_cache"); sessionStorage.removeItem("iams_extra_cache"); } catch (_) {}
      if (window._sb) await window._sb.auth.signOut();
      window.location.href = "/auth.html";
    });
  }

  // ------------------------------------------------------- Route guard
  // Call at top of every protected page. Returns session or null (+ redirects).
  // Pass requiredRole (e.g. "student") to also enforce role.
  async function protectRoute(requiredRole) {
    var sb = window._sb;
    if (!sb) {
      console.error("_ui.js: window._sb must be set before calling protectRoute()");
      return null;
    }

    var sessionResult = await sb.auth.getSession();
    var session = sessionResult.data && sessionResult.data.session;

    if (!session) {
      window.location.replace("/auth.html");
      return null;
    }

    // Refresh first so /api/profile/me does not receive a stale token.
    try {
      var refreshed = await sb.auth.refreshSession();
      if (refreshed && refreshed.data && refreshed.data.session) {
        session = refreshed.data.session;
      }
    } catch (_) {}

    // Use a small session cache first to reduce visible flicker on pages like Organisation Profile.
    // The API call below still refreshes the data so existing flows stay correct.
    try {
      var cachedProfile = sessionStorage.getItem("iams_profile_cache");
      var cachedExtra = sessionStorage.getItem("iams_extra_cache");
      if (cachedProfile) window._userProfile = JSON.parse(cachedProfile);
      if (cachedExtra) window._userExtra = JSON.parse(cachedExtra);
    } catch (_) {}

    // Fetch profile from API to get role + details. If the token is invalid,
    // clear the local session and send the user back to login instead of
    // leaving a broken dashboard with 401 console noise.
    try {
      var r = await fetch("/api/profile/me", {
        headers: { Authorization: "Bearer " + session.access_token }
      });
      var json = await r.json().catch(function(){ return { ok:false, error:"Invalid server response" }; });
      if (r.status === 401) {
        await sb.auth.signOut();
        window.location.replace("/auth.html");
        return null;
      }
      if (json.ok) {
        window._userProfile = json.profile;
        window._userExtra   = json.extra;
        try {
          sessionStorage.setItem("iams_profile_cache", JSON.stringify(json.profile || null));
          sessionStorage.setItem("iams_extra_cache", JSON.stringify(json.extra || null));
        } catch (_) {}
      } else {
        showToast("error", json.error || "Could not load your profile.");
      }
    } catch (e) {
      console.warn("_ui.js: could not load profile —", e.message);
      showToast("error", "Could not connect to the profile service.");
    }

    var role = window._userProfile && window._userProfile.role;
    applyRoleBackground(role);

    if (requiredRole && role !== requiredRole) {
      // Wrong role — go to dashboard which will show correct section
      window.location.href = "/dashboard.html";
      return null;
    }

    return session;
  }

  // ------------------------------------------------------- Mini XSS escape
  function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }

  // ------------------------------------------------------- Expose globally
  window.UI = {
    showToast:    showToast,
    setLoading:   setLoading,
    showAlert:    showAlert,
    hideAlert:    hideAlert,
    renderNav:    renderNav,
    protectRoute: protectRoute,
    applyRoleBackground: applyRoleBackground
  };

})();
