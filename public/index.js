// public/index.js — landing page

// Smooth-scroll for in-page anchor links
document.querySelectorAll('a[href^="#"]').forEach(function (a) {
  a.addEventListener("click", function (e) {
    var target = document.querySelector(a.getAttribute("href"));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// Highlight active nav link as user scrolls through sections
(function () {
  var sections = document.querySelectorAll("[id]");
  var navLinks = document.querySelectorAll(".lp-nav-links a[href^='#']");
  if (!sections.length || !navLinks.length) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        navLinks.forEach(function (a) {
          var isActive = a.getAttribute("href") === "#" + entry.target.id;
          a.style.color = isActive ? "var(--text)" : "";
        });
      }
    });
  }, { threshold: 0.4 });

  sections.forEach(function (s) { observer.observe(s); });
})();
