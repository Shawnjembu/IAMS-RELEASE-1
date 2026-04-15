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

  // ------------------------------------------------------- Role-based nav
  var NAV_ITEMS = {
    student: [
      { href: "/dashboard.html",       label: "Dashboard"  },
      { href: "/student-profile.html", label: "My Profile" },
      { href: "/placement.html",       label: "Placement"  },
      { href: "/logbook.html",         label: "Logbook"    },
      { href: "/report.html",          label: "My Report"  }
    ],
    organization: [
      { href: "/dashboard.html",   label: "Dashboard"    },
      { href: "/org-profile.html", label: "Organisation" },
      { href: "/students.html",    label: "My Students"  }
    ],
    coordinator: [
      { href: "/dashboard.html",    label: "Dashboard"    },
      { href: "/matching.html",     label: "Matching"     },
      { href: "/deadlines.html",    label: "Deadlines"    },
      { href: "/assessment.html",   label: "Assessments"  }
    ],
    industrial_supervisor: [
      { href: "/dashboard.html",            label: "Dashboard"  },
      { href: "/supervisor-industrial.html", label: "My Students" }
    ],
    university_supervisor: [
      { href: "/dashboard.html",            label: "Dashboard"  },
      { href: "/supervisor-university.html", label: "My Students" }
    ]
  };

  function renderNav(role, userEmail) {
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
      '<a class="brand" href="/dashboard.html">IAM<span>S</span></a>' +
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
      window.location.href = "/auth.html";
      return null;
    }

    // Fetch profile from API to get role + details
    try {
      var r = await fetch("/api/profile/me", {
        headers: { Authorization: "Bearer " + session.access_token }
      });
      var json = await r.json();
      if (json.ok) {
        window._userProfile = json.profile;
        window._userExtra   = json.extra;
      }
    } catch (e) {
      console.warn("_ui.js: could not load profile —", e.message);
    }

    var role = window._userProfile && window._userProfile.role;

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
    protectRoute: protectRoute
  };

})();
