/* docs.js — Documentation page: one section at a time navigation */
(function () {
  'use strict';

  var SECTIONS = [
    { id: 'quick-start',      label: 'Quick Start' },
    { id: 'beginners-guide',  label: "Beginner's Guide" },
    { id: 'philosophy',       label: 'Core Philosophy' },
    { id: 'architecture',     label: 'Architecture' },
    { id: 'why-r2',           label: 'Why Cloudflare R2?' },
    { id: 'mobile-indicator', label: 'Mobile Indicator' },
    { id: 'troubleshooting',  label: 'Troubleshooting' },
    { id: 'token-usage',      label: 'Token Usage' },
    { id: 'about',            label: 'About' }
  ];

  var currentIndex = 0;

  function getIndexById(id) {
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].id === id) return i;
    }
    return 0;
  }

  function showSection(idx, scroll) {
    idx = Math.max(0, Math.min(SECTIONS.length - 1, idx));
    currentIndex = idx;

    // Show only the active section
    SECTIONS.forEach(function (s, i) {
      var el = document.getElementById(s.id);
      if (el) el.style.display = (i === idx) ? '' : 'none';
    });

    // Update sidebar active state
    document.querySelectorAll('.docs-nav-link').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + SECTIONS[idx].id);
    });

    // Scroll to top of content area
    if (scroll !== false) {
      var main = document.getElementById('docs-content');
      if (main) {
        var navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height') || '60');
        window.scrollTo({ top: main.getBoundingClientRect().top + window.pageYOffset - navH - 12, behavior: 'smooth' });
      }
    }

    // Update URL hash
    try { history.replaceState(null, '', '#' + SECTIONS[idx].id); } catch (e) {}
  }

  function init() {
    // Wire sidebar links
    document.querySelectorAll('.docs-nav-link[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        showSection(getIndexById(a.getAttribute('href').slice(1)));
      });
    });

    // Wire all data-docs-next buttons
    document.querySelectorAll('[data-docs-next]').forEach(function (btn) {
      btn.addEventListener('click', function () { showSection(currentIndex + 1); });
    });

    // Detect initial section from URL hash
    var hash = window.location.hash.slice(1);
    showSection(hash ? getIndexById(hash) : 0, false);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
