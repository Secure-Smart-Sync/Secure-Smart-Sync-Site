/* calculator.js — Precise R2 op-cost model
   Sources: docs token_usage_scenarios, SSS architecture notes
   ─────────────────────────────────────────────────────────────
   Class A (write/list):
     Remote walk LIST  : ceil(files/1000)  per sync
     File PUT          : 1 per file pushed
     Sentinel PUT      : 1 per sync (own pushes only)
   Class B (read/head):
     Sentinel HEAD poll: 1 per 2 s (active) | 1 per 30 s (idle)
     ETag HEAD         : 1 per file uploaded
     File GET          : 1 per file pulled
     Sentinel GET      : 1 per foreign sync detected (= ownSyncs * (D-1))
   ─────────────────────────────────────────────────────────────
*/
(function () {
  'use strict';

  const A_LIMIT = 1_000_000;
  const B_LIMIT = 10_000_000;
  const DAYS    = 30;

  function listOps(files) { return Math.ceil(files / 1000); }

  function calculate(devices, activeHrs, idleHrs, syncsPerDay, filesPerSync, totalFiles) {
    const D = devices;

    // ── Class B: sentinel poll budget ────────────────────────
    const activePolls = Math.round((3600 / 2)  * activeHrs); // HEAD every 2 s
    const idlePolls   = Math.round((3600 / 30) * idleHrs);   // HEAD every 30 s
    const pollsPerDevDay = activePolls + idlePolls;
    const totalPollB = pollsPerDevDay * D * DAYS;

    // ── Per own sync (each device does syncsPerDay) ───────────
    const L = listOps(totalFiles);
    const f = filesPerSync;

    // Class A per device per own sync
    const ownSyncA = L + f + 1;              // LIST + PUTs + sentinel PUT
    // Class B per device per own sync
    const ownSyncB = f;                       // ETag HEAD per uploaded file

    // State-aware pull on other devices when they detect our sentinel
    // Each own sync → (D-1) devices each do: LIST + f GETs + 1 sentinel GET
    const stateA = L;                         // LIST per state-aware pull
    const stateB = f + 1;                     // f file GETs + 1 sentinel GET

    const totalOwnSyncs = syncsPerDay * D * DAYS;

    const classA = Math.round(
      totalOwnSyncs * ownSyncA +              // own syncs
      totalOwnSyncs * (D - 1) * stateA       // state-aware pulls
    );

    const classB = Math.round(
      totalPollB +                            // sentinel polling
      totalOwnSyncs * ownSyncB +             // ETag HEADs on own uploads
      totalOwnSyncs * (D - 1) * stateB      // file GETs + sentinel GETs on pulls
    );

    // Breakdown for display
    const pollBPerDev  = pollsPerDevDay * DAYS;
    const ownAPerDev   = syncsPerDay * ownSyncA * DAYS;
    const stateATotal  = totalOwnSyncs * (D - 1) * stateA;
    const ownBPerDev   = syncsPerDay * ownSyncB * DAYS;
    const stateBTotal  = totalOwnSyncs * (D - 1) * stateB;

    return {
      A: classA, B: classB,
      breakdown: {
        pollBPerDev, pollBTotal: totalPollB,
        ownAPerDev, ownATotal: totalOwnSyncs * ownSyncA,
        stateATotal,
        ownBPerDev, ownBTotal: totalOwnSyncs * ownSyncB,
        stateBTotal,
        activePolls, idlePolls, pollsPerDevDay,
        listOpsPerSync: L
      }
    };
  }

  function fmt(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return Math.round(n / 1000) + 'K';
    return Math.round(n).toLocaleString();
  }

  function pct(n, limit) { return (n / limit * 100); }

  function colorClass(p) {
    if (p < 30) return 'ok';
    if (p < 70) return 'warn';
    return 'over';
  }

  function barWidth(p) { return Math.min(p, 100).toFixed(1) + '%'; }

  function getVal(id) { return parseInt(document.getElementById(id).value, 10) || 0; }

  function update() {
    const devices      = Math.max(1, getVal('inp-devices'));
    const activeHrs    = Math.max(0, Math.min(24, getVal('inp-active-hrs')));
    const idleHrs      = Math.max(0, 24 - activeHrs);
    const syncsPerDay  = Math.max(0, getVal('inp-syncs-day'));
    const filesPerSync = Math.max(1, getVal('inp-files-sync'));
    const totalFiles   = Math.max(1, getVal('inp-vault-files'));

    // Update derived idle display
    document.getElementById('idle-hrs-display').textContent = idleHrs + ' h idle';

    const r = calculate(devices, activeHrs, idleHrs, syncsPerDay, filesPerSync, totalFiles);
    const { breakdown: b } = r;

    const pA = pct(r.A, A_LIMIT);
    const pB = pct(r.B, B_LIMIT);

    // Results: main numbers
    document.getElementById('val-a').textContent = fmt(r.A);
    document.getElementById('val-b').textContent = fmt(r.B);
    document.getElementById('pct-a').textContent = pA.toFixed(1) + '% of 1M free tier';
    document.getElementById('pct-b').textContent = pB.toFixed(1) + '% of 10M free tier';

    const barA = document.getElementById('bar-a');
    const barB = document.getElementById('bar-b');
    barA.style.width = barWidth(pA);
    barB.style.width = barWidth(pB);
    barA.className   = 'calc-bar ' + colorClass(pA);
    barB.className   = 'calc-bar ' + colorClass(pB);

    document.getElementById('pct-a').className = 'calc-result-pct ' + colorClass(pA);
    document.getElementById('pct-b').className = 'calc-result-pct ' + colorClass(pB);

    // Breakdown rows
    document.getElementById('bd-poll').textContent    = fmt(b.pollBTotal);
    document.getElementById('bd-poll-d').textContent  = fmt(b.pollBPerDev) + '/dev';
    document.getElementById('bd-own-a').textContent   = fmt(b.ownATotal);
    document.getElementById('bd-own-a-d').textContent = fmt(b.ownAPerDev) + '/dev';
    document.getElementById('bd-state-a').textContent = fmt(b.stateATotal);
    document.getElementById('bd-own-b').textContent   = fmt(b.ownBTotal);
    document.getElementById('bd-own-b-d').textContent = fmt(b.ownBPerDev) + '/dev';
    document.getElementById('bd-state-b').textContent = fmt(b.stateBTotal);
    document.getElementById('bd-list').textContent    = b.listOpsPerSync + ' LIST / sync';

    // Poll detail
    document.getElementById('bd-active-polls').textContent = fmt(b.activePolls) + '/dev/day active';
    document.getElementById('bd-idle-polls').textContent   = fmt(b.idlePolls) + '/dev/day idle';

    // Verdict
    const maxP = Math.max(pA, pB);
    const vEl = document.getElementById('calc-verdict');
    if (maxP < 30) {
      vEl.className = 'calc-verdict ok';
      vEl.textContent = 'Comfortably within the free tier. No cost expected.';
    } else if (maxP < 70) {
      vEl.className = 'calc-verdict warn';
      vEl.textContent = 'Moderate usage — within free tier but worth monitoring on the Cloudflare dashboard.';
    } else if (maxP < 100) {
      vEl.className = 'calc-verdict warn';
      vEl.textContent = 'High usage — approaching free-tier limits. Consider adjusting polling intervals or devices.';
    } else {
      vEl.className = 'calc-verdict over';
      vEl.textContent = 'Likely to exceed the free tier. Review R2 pricing or reduce sync frequency.';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const ids = ['inp-devices','inp-active-hrs','inp-syncs-day','inp-files-sync','inp-vault-files'];
    ids.forEach(id => document.getElementById(id).addEventListener('input', update));
    update();
  });
})();
