/* ============================================================
   script.js — Secure-Smart-Sync Documentation Site
   Shared across all pages.
   ============================================================ */

(function () {
  'use strict';

  /* ── Active nav link ─────────────────────────────────────── */
  function setActiveNav() {
    const page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      const href = a.getAttribute('href') || '';
      if (href === page || (page === 'index.html' && href === './') || href === './' && page === '') {
        a.classList.add('active');
      } else {
        a.classList.remove('active');
      }
    });
  }

  /* ── Mobile hamburger ────────────────────────────────────── */
  function initHamburger() {
    var btn = document.getElementById('nav-hamburger');
    var links = document.getElementById('nav-links');
    if (!btn || !links) return;
    btn.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
      // Animate bars
      var bars = btn.querySelectorAll('span');
      if (open) {
        bars[0].style.transform = 'translateY(7px) rotate(45deg)';
        bars[1].style.opacity   = '0';
        bars[2].style.transform = 'translateY(-7px) rotate(-45deg)';
      } else {
        bars[0].style.transform = '';
        bars[1].style.opacity   = '';
        bars[2].style.transform = '';
      }
    });
    // Close on link click
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        links.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        var bars = btn.querySelectorAll('span');
        bars[0].style.transform = '';
        bars[1].style.opacity   = '';
        bars[2].style.transform = '';
      });
    });
  }

  /* ── Scroll-reveal ───────────────────────────────────────── */
  function initScrollReveal() {
    var els = document.querySelectorAll('.reveal, .step-item');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in-view'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          // Stagger siblings inside same parent
          var siblings = Array.from(entry.target.parentNode.children)
            .filter(function (c) { return c.classList.contains('reveal') || c.classList.contains('step-item'); });
          var idx = siblings.indexOf(entry.target);
          setTimeout(function () {
            entry.target.classList.add('in-view');
          }, idx * 80);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ── Accordion ───────────────────────────────────────────── */
  function initAccordions() {
    document.querySelectorAll('.accordion-trigger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.accordion-item');
        var wasOpen = item.classList.contains('open');
        // Close all in same group
        var group = item.closest('[data-accordion-group]');
        if (group) {
          group.querySelectorAll('.accordion-item.open').forEach(function (el) {
            el.classList.remove('open');
          });
        }
        if (!wasOpen) item.classList.add('open');
      });
    });
  }

  /* ── Copy code blocks ────────────────────────────────────── */
  function initCopyCode() {
    document.querySelectorAll('pre').forEach(function (pre) {
      var wrap = document.createElement('div');
      wrap.style.position = 'relative';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      var btn = document.createElement('button');
      btn.setAttribute('aria-label', 'Copy code');
      btn.style.cssText = [
        'position:absolute', 'top:0.6rem', 'right:0.6rem',
        'background:rgba(255,255,255,0.06)', 'border:1px solid rgba(255,255,255,0.1)',
        'border-radius:5px', 'padding:4px 8px', 'cursor:pointer',
        'color:#9aa3b8', 'font-size:0.75rem', 'font-family:inherit',
        'display:flex', 'align-items:center', 'gap:4px',
        'transition:background 0.15s ease'
      ].join(';');
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
      btn.addEventListener('mouseover', function () { btn.style.background = 'rgba(255,255,255,0.1)'; });
      btn.addEventListener('mouseout',  function () { btn.style.background = 'rgba(255,255,255,0.06)'; });
      btn.addEventListener('click', function () {
        var text = pre.querySelector('code') ? pre.querySelector('code').innerText : pre.innerText;
        navigator.clipboard.writeText(text).then(function () {
          btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied';
          btn.style.color = '#6ee7b7';
          setTimeout(function () {
            btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
            btn.style.color = '#9aa3b8';
          }, 2000);
        });
      });
      wrap.appendChild(btn);
    });
  }

  /* ── Smooth anchor scroll (offset for fixed nav) ────────── */
  function initAnchorScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href').slice(1);
        var target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        var offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height') || '60');
        var top = target.getBoundingClientRect().top + window.pageYOffset - offset - 16;
        window.scrollTo({ top: top, behavior: 'smooth' });
      });
    });
  }

  /* ── Table of contents highlight ────────────────────────── */
  function initTocHighlight() {
    var toc = document.getElementById('toc');
    if (!toc) return;
    var links = toc.querySelectorAll('a[href^="#"]');
    var headings = Array.from(links).map(function (a) {
      return document.getElementById(a.getAttribute('href').slice(1));
    }).filter(Boolean);
    if (!headings.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          links.forEach(function (a) { a.style.color = ''; });
          var active = toc.querySelector('a[href="#' + entry.target.id + '"]');
          if (active) active.style.color = 'var(--purple-light)';
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    headings.forEach(function (h) { io.observe(h); });
  }

  /* ── Init ────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    setActiveNav();
    initHamburger();
    initScrollReveal();
    initAccordions();
    initCopyCode();
    initAnchorScroll();
    initTocHighlight();
  });
})();
