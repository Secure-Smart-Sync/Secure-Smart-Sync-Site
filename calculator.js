/* calculator.js — Token Usage Calculator (rebuilt)
   Multi-step flow: Method → Settings → Vault → Results
   ───────────────────────────────────────────────────
   Calculation model:
   ─ Class A (write/list):
       LIST per sync  = ceil(files / 1000)
       PUT per file   = 1 per file changed
       Sentinel PUT   = 1 per sync that modifies remote
   ─ Class B (read/head):
       Sentinel HEAD poll (Smart Sync only): continuous
       ETag HEAD      = 1 per file uploaded
       File GET       = 1 per file downloaded (cross-device pulls)
       Sentinel GET   = 1 per foreign sync detected
   ─ All costs per-device, then multiplied and summed.
   ─────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ──────────────────────────────────────────────────
     CONSTANTS & DEFAULTS
  ────────────────────────────────────────────────── */
  var A_LIMIT = 1_000_000;
  var B_LIMIT = 10_000_000;
  var DAYS    = 30;

  // Vault file count buckets [slider 0–7]
  var FILE_BUCKETS = [75, 500, 1000, 2000, 5000, 10000, 20000, 50000];

  // Active hours slider [1–13 maps to actual hours]
  var HOUR_VALUES = [1,2,3,4,5,6,7,8,9,10,11,12,13];

  // Smart Sync plugin defaults
  var SS_DEFAULTS = {
    idleSec:         4,
    activePollMs:    2000,
    idlePollMs:      30000,
    postSyncRePollMs:500
  };

  /* ──────────────────────────────────────────────────
     STATE
  ────────────────────────────────────────────────── */
  var state = {
    currentStep: 1,
    method: null,         // 'smart' | 'manual-auto' | 'manual-only'

    // Step 2 — settings
    // Smart Sync
    ss_useDefaults:      true,
    ss_idleSec:          SS_DEFAULTS.idleSec,
    ss_activePollMs:     SS_DEFAULTS.activePollMs,
    ss_idlePollMs:       SS_DEFAULTS.idlePollMs,
    ss_syncOnStartup:    true,
    ss_manualFreq:       'never',   // 'never'|'rarely'|'occasionally'|'regularly'|'frequently'

    // Manual automation
    ma_interval:         false,
    ma_intervalMin:      30,
    ma_save:             false,
    ma_saveDebounce:     5,
    ma_idle:             false,
    ma_idleSec:          30,
    ma_startup:          false,
    ma_manualFreq:       'never',

    // Manual only
    mo_syncsPerMonth:    10,

    // Editing pattern (shared step 2)
    editPattern:         'moderate',  // 'light'|'moderate'|'heavy'

    // Step 3 — vault
    vaultFilesIdx:       3,          // index into FILE_BUCKETS → 2000
    activeHrsIdx:        4,          // index into HOUR_VALUES → 4h
    devices:             2,
    simultaneity:        'separate'  // 'separate'|'sometimes'|'concurrent'
  };

  /* ──────────────────────────────────────────────────
     HELPERS
  ────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }

  function fmt(n) {
    n = Math.round(n);
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  function pct(n, limit) { return n / limit * 100; }

  function colorClass(p) {
    if (p < 35)  return 'ok';
    if (p < 75)  return 'warn';
    return 'over';
  }

  function listOps(files) { return Math.max(1, Math.ceil(files / 1000)); }

  function svg(path, size) {
    size = size || 16;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  function makeToggle(id, checked, onChange) {
    var wrap = document.createElement('label');
    wrap.className = 'calc-toggle';
    var inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.id = id;
    inp.checked = checked;
    var track = document.createElement('span');
    track.className = 'calc-toggle-track';
    wrap.appendChild(inp);
    wrap.appendChild(track);
    inp.addEventListener('change', function () { onChange(inp.checked); });
    return wrap;
  }

  function makeNumInput(id, value, min, max, unit, onChange) {
    var wrap = document.createElement('div');
    wrap.className = 'calc-num-input-wrap';
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.id = id;
    inp.value = value;
    inp.min = min;
    inp.max = max;
    inp.step = 1;
    var u = document.createElement('span');
    u.className = 'calc-num-unit';
    u.textContent = unit;
    wrap.appendChild(inp);
    wrap.appendChild(u);
    inp.addEventListener('input', function () {
      var v = parseFloat(inp.value);
      if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
    });
    return wrap;
  }

  function makeSelect(id, options, value, onChange) {
    var sel = document.createElement('select');
    sel.className = 'calc-select';
    sel.id = id;
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }

  function makeToggleRow(id, labelStrong, labelDesc, checked, onChange) {
    var row = document.createElement('div');
    row.className = 'calc-toggle-row';
    var lbl = document.createElement('div');
    lbl.className = 'calc-toggle-label';
    lbl.innerHTML = '<strong>' + labelStrong + '</strong><span>' + labelDesc + '</span>';
    row.appendChild(lbl);
    row.appendChild(makeToggle(id, checked, onChange));
    return row;
  }

  /* ──────────────────────────────────────────────────
     PROGRESS BAR
  ────────────────────────────────────────────────── */
  function updateProgress(step) {
    document.querySelectorAll('.calc-progress-step').forEach(function (el) {
      var s = parseInt(el.dataset.step);
      el.classList.remove('active', 'done');
      if (s === step) el.classList.add('active');
      else if (s < step) el.classList.add('done');
    });
    document.querySelectorAll('.calc-progress-line').forEach(function (el, i) {
      // line i sits between step (i+1) and step (i+2)
      el.classList.toggle('filled', step > i + 1);
    });
  }

  /* ──────────────────────────────────────────────────
     STEP NAVIGATION
  ────────────────────────────────────────────────── */
  function showStep(n) {
    state.currentStep = n;
    for (var i = 1; i <= 4; i++) {
      var el = $('step-' + i);
      if (el) el.classList.toggle('hidden', i !== n);
    }
    updateProgress(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ──────────────────────────────────────────────────
     STEP 1 — Method selection
  ────────────────────────────────────────────────── */
  function initStep1() {
    document.querySelectorAll('.calc-method-card').forEach(function (card) {
      card.addEventListener('click', function () {
        document.querySelectorAll('.calc-method-card').forEach(function (c) {
          c.classList.remove('selected');
        });
        card.classList.add('selected');
        state.method = card.dataset.method;
        $('step1-next').disabled = false;
      });
    });
    $('step1-next').addEventListener('click', function () {
      if (!state.method) return;
      buildStep2();
      showStep(2);
    });
  }

  /* ──────────────────────────────────────────────────
     STEP 2 — Settings (dynamic)
  ────────────────────────────────────────────────── */
  function buildStep2() {
    var container = $('step2-content');
    container.innerHTML = '';

    if (state.method === 'smart') {
      $('step2-title').textContent = 'Smart Sync settings';
      $('step2-desc').textContent  = 'Match these to your plugin settings, or use defaults if you haven\'t changed them.';
      buildStep2SmartSync(container);
    } else if (state.method === 'manual-auto') {
      $('step2-title').textContent = 'Manual automation settings';
      $('step2-desc').textContent  = 'Enable the triggers you have turned on in the plugin and enter their values.';
      buildStep2ManualAuto(container);
    } else {
      $('step2-title').textContent = 'Manual sync frequency';
      $('step2-desc').textContent  = 'How often do you manually press the sync button?';
      buildStep2ManualOnly(container);
    }
  }

  /* ── Step 2: Smart Sync ── */
  function buildStep2SmartSync(container) {
    var card = document.createElement('div');
    card.className = 'calc-card';

    // Use defaults toggle
    var defRow = makeToggleRow(
      'ss-use-defaults',
      'I use the default settings',
      'Active poll 2s · Idle poll 30s · Idle threshold 4s. Most users haven\'t changed these.',
      state.ss_useDefaults,
      function (v) {
        state.ss_useDefaults = v;
        advSec.style.display = v ? 'none' : '';
      }
    );
    card.appendChild(defRow);

    // Startup toggle
    card.appendChild(document.createElement('div')).className = 'calc-field-divider';
    card.lastChild.remove();
    var div1 = document.createElement('div'); div1.className = 'calc-field-divider'; card.appendChild(div1);
    var startupRow = makeToggleRow(
      'ss-startup',
      'Sync on startup',
      'Triggers a sync check when Obsidian opens. Enabled by default in Smart Sync.',
      state.ss_syncOnStartup,
      function (v) { state.ss_syncOnStartup = v; }
    );
    card.appendChild(startupRow);

    // Advanced settings collapsible
    var adv = document.createElement('div');
    adv.className = 'calc-sub-section';
    adv.style.display = state.ss_useDefaults ? 'none' : '';
    var advId = 'ss-adv-section';
    adv.id = advId;

    var advHdr = document.createElement('button');
    advHdr.className = 'calc-sub-header';
    advHdr.type = 'button';
    advHdr.innerHTML = 'Advanced settings ' + svg('<polyline points="9 18 15 12 9 6"/>', 14).replace('aria-hidden="true"', 'class="calc-sub-chevron" aria-hidden="true"');
    adv.appendChild(advHdr);

    var advBody = document.createElement('div');
    advBody.className = 'calc-sub-body';
    var advInner = document.createElement('div');
    advInner.className = 'calc-sub-body-inner';

    // Idle sec
    var r1 = document.createElement('div'); r1.className = 'calc-num-row';
    var l1 = document.createElement('label'); l1.htmlFor = 'ss-idle-sec'; l1.textContent = 'Idle time before sync (seconds)';
    r1.appendChild(l1);
    r1.appendChild(makeNumInput('ss-idle-sec', state.ss_idleSec, 1, 300, 'sec', function (v) { state.ss_idleSec = v; }));
    advInner.appendChild(r1);

    // Active poll
    var r2 = document.createElement('div'); r2.className = 'calc-num-row';
    var l2 = document.createElement('label'); l2.htmlFor = 'ss-active-poll'; l2.textContent = 'Active poll interval (ms)';
    r2.appendChild(l2);
    r2.appendChild(makeNumInput('ss-active-poll', state.ss_activePollMs, 500, 60000, 'ms', function (v) { state.ss_activePollMs = v; }));
    advInner.appendChild(r2);

    // Idle poll
    var r3 = document.createElement('div'); r3.className = 'calc-num-row';
    var l3 = document.createElement('label'); l3.htmlFor = 'ss-idle-poll'; l3.textContent = 'Idle poll interval (ms)';
    r3.appendChild(l3);
    r3.appendChild(makeNumInput('ss-idle-poll', state.ss_idlePollMs, 5000, 300000, 'ms', function (v) { state.ss_idlePollMs = v; }));
    advInner.appendChild(r3);

    advBody.appendChild(advInner);
    adv.appendChild(advBody);
    advHdr.addEventListener('click', function () { adv.classList.toggle('open'); });

    var advSec = adv;
    card.appendChild(advSec);

    // Divider + editing pattern
    var div2 = document.createElement('div'); div2.className = 'calc-field-divider'; card.appendChild(div2);
    card.appendChild(buildEditPatternSection());

    // Divider + manual trigger frequency
    var div3 = document.createElement('div'); div3.className = 'calc-field-divider'; card.appendChild(div3);
    card.appendChild(buildManualFreqSection('ss', state.ss_manualFreq, function (v) { state.ss_manualFreq = v; }));

    container.appendChild(card);
  }

  /* ── Step 2: Manual Automation ── */
  function buildStep2ManualAuto(container) {
    var card = document.createElement('div');
    card.className = 'calc-card';

    // Interval
    card.appendChild(buildAutomationToggleSection(
      'ma-interval-toggle', 'Auto-sync interval', 'Syncs on a fixed timer regardless of edits.',
      state.ma_interval,
      function (v) {
        state.ma_interval = v;
        intervalDetail.style.display = v ? '' : 'none';
      }
    ));
    var intervalDetail = buildNumDetail('ma-interval-min', state.ma_intervalMin, 1, 1440, 'minutes', function (v) { state.ma_intervalMin = v; });
    intervalDetail.style.display = state.ma_interval ? '' : 'none';
    card.appendChild(intervalDetail);

    card.appendChild(document.createElement('div')).className = '';
    var d1 = document.createElement('div'); d1.className = 'calc-field-divider'; card.appendChild(d1);

    // On-save debounce
    card.appendChild(buildAutomationToggleSection(
      'ma-save-toggle', 'Sync on save debounce', 'Syncs N seconds after a file is saved.',
      state.ma_save,
      function (v) {
        state.ma_save = v;
        saveDetail.style.display = v ? '' : 'none';
      }
    ));
    var saveDetail = buildNumDetail('ma-save-sec', state.ma_saveDebounce, 1, 300, 'seconds', function (v) { state.ma_saveDebounce = v; });
    saveDetail.style.display = state.ma_save ? '' : 'none';
    card.appendChild(saveDetail);

    var d2 = document.createElement('div'); d2.className = 'calc-field-divider'; card.appendChild(d2);

    // On-idle
    card.appendChild(buildAutomationToggleSection(
      'ma-idle-toggle', 'Sync on idle', 'Syncs N seconds after you stop typing.',
      state.ma_idle,
      function (v) {
        state.ma_idle = v;
        idleDetail.style.display = v ? '' : 'none';
      }
    ));
    var idleDetail = buildNumDetail('ma-idle-sec', state.ma_idleSec, 1, 3600, 'seconds', function (v) { state.ma_idleSec = v; });
    idleDetail.style.display = state.ma_idle ? '' : 'none';
    card.appendChild(idleDetail);

    var d3 = document.createElement('div'); d3.className = 'calc-field-divider'; card.appendChild(d3);

    // Startup
    card.appendChild(makeToggleRow(
      'ma-startup',
      'Sync on startup',
      'Triggers a sync a few seconds after Obsidian opens.',
      state.ma_startup,
      function (v) { state.ma_startup = v; }
    ));

    var d4 = document.createElement('div'); d4.className = 'calc-field-divider'; card.appendChild(d4);
    card.appendChild(buildEditPatternSection());

    var d5 = document.createElement('div'); d5.className = 'calc-field-divider'; card.appendChild(d5);
    card.appendChild(buildManualFreqSection('ma', state.ma_manualFreq, function (v) { state.ma_manualFreq = v; }));

    container.appendChild(card);
  }

  /* ── Step 2: Manual only ── */
  function buildStep2ManualOnly(container) {
    var card = document.createElement('div');
    card.className = 'calc-card';

    // Monthly sync count
    var block = document.createElement('div');
    block.className = 'calc-field-block';

    var titleEl = document.createElement('label');
    titleEl.className = 'calc-field-label-static';
    titleEl.textContent = 'How many times a month do you manually trigger a sync?';
    block.appendChild(titleEl);

    var hint = document.createElement('p');
    hint.className = 'calc-hint';
    hint.textContent = 'Count all manual syncs across all devices combined.';
    block.appendChild(hint);

    var freqOptions = [
      { value: '1-10',    label: 'A handful — 1 to 10 times' },
      { value: '10-50',   label: 'Sometimes — 10 to 50 times' },
      { value: '50-150',  label: 'Often — 50 to 150 times' },
      { value: '150-500', label: 'Frequently — 150 to 500 times' },
      { value: '500+',    label: 'Very frequently — 500 or more times' }
    ];
    var sel = makeSelect('mo-syncs-select', freqOptions, '1-10', function (v) {
      state.mo_syncsPerMonth = freqRangeToMid(v);
    });
    block.appendChild(sel);
    card.appendChild(block);

    var d1 = document.createElement('div'); d1.className = 'calc-field-divider'; card.appendChild(d1);
    card.appendChild(buildEditPatternSection());

    container.appendChild(card);
  }

  /* ── Sub-builders ── */
  function buildAutomationToggleSection(id, title, desc, checked, onChange) {
    return makeToggleRow(id, title, desc, checked, onChange);
  }

  function buildNumDetail(id, value, min, max, unit, onChange) {
    var row = document.createElement('div');
    row.className = 'calc-num-row';
    row.style.paddingLeft = '0.5rem';
    var lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = 'Set to:';
    lbl.style.color = 'var(--text-muted)';
    row.appendChild(lbl);
    row.appendChild(makeNumInput(id, value, min, max, unit, onChange));
    return row;
  }

  function buildEditPatternSection() {
    var block = document.createElement('div');
    block.className = 'calc-field-block';
    var lbl = document.createElement('label');
    lbl.className = 'calc-field-label-static';
    lbl.textContent = 'How would you describe your editing pattern?';
    block.appendChild(lbl);
    var hint = document.createElement('p');
    hint.className = 'calc-hint';
    hint.textContent = 'Used to estimate how many files change per sync trigger on average.';
    block.appendChild(hint);
    var rg = document.createElement('div');
    rg.className = 'calc-radio-group';
    var patterns = [
      { value: 'light',    title: 'One or two files at a time', desc: 'You usually edit a single note per session.' },
      { value: 'moderate', title: 'Several files per session', desc: 'A handful of notes touched per writing session.' },
      { value: 'heavy',    title: 'Broad changes across many files', desc: 'Reorganising, mass tagging, or scripted edits.' }
    ];
    patterns.forEach(function (p) {
      var opt = document.createElement('label');
      opt.className = 'calc-radio-option';
      var inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'edit-pattern';
      inp.value = p.value;
      if (p.value === state.editPattern) inp.checked = true;
      inp.addEventListener('change', function () { if (inp.checked) state.editPattern = p.value; });
      var body = document.createElement('span');
      body.className = 'calc-radio-body';
      body.innerHTML = '<span class="calc-radio-title">' + p.title + '</span><span class="calc-radio-desc">' + p.desc + '</span>';
      opt.appendChild(inp);
      opt.appendChild(body);
      rg.appendChild(opt);
    });
    block.appendChild(rg);
    return block;
  }

  function buildManualFreqSection(prefix, currentVal, onChange) {
    var block = document.createElement('div');
    block.className = 'calc-field-block';
    var lbl = document.createElement('label');
    lbl.className = 'calc-field-label-static';
    lbl.textContent = 'Do you also trigger syncs manually on top of automation?';
    block.appendChild(lbl);
    var freqOptions = [
      { value: 'never',       label: 'Never — automation handles everything' },
      { value: 'rarely',      label: 'Rarely — a few times a month' },
      { value: 'occasionally',label: 'Occasionally — a few times a week' },
      { value: 'regularly',   label: 'Regularly — once or twice a day' },
      { value: 'frequently',  label: 'Frequently — many times a day' }
    ];
    var sel = makeSelect(prefix + '-manual-freq', freqOptions, currentVal, onChange);
    block.appendChild(sel);
    return block;
  }

  function freqRangeToMid(v) {
    var map = { '1-10': 5, '10-50': 25, '50-150': 90, '150-500': 300, '500+': 700 };
    return map[v] || 5;
  }

  function manualFreqToMonthly(v) {
    var map = { never: 0, rarely: 4, occasionally: 16, regularly: 52, frequently: 150 };
    return map[v] || 0;
  }

  /* ──────────────────────────────────────────────────
     STEP 3 — Vault sliders
  ────────────────────────────────────────────────── */
  function initStep3() {
    // Vault files
    var vf = $('inp-vault-files');
    vf.addEventListener('input', function () {
      state.vaultFilesIdx = parseInt(vf.value);
      $('val-vault-files').textContent = FILE_BUCKETS[state.vaultFilesIdx].toLocaleString() + ' files';
    });

    // Active hours
    var ah = $('inp-active-hrs');
    ah.max = HOUR_VALUES.length - 1;
    ah.value = 3; // index 3 = 4h
    ah.addEventListener('input', function () {
      state.activeHrsIdx = parseInt(ah.value);
      var h = HOUR_VALUES[state.activeHrsIdx];
      $('val-active-hrs').textContent = h + (h === 13 ? 'h+' : 'h') + ' / day';
    });

    // Devices
    var dev = $('inp-devices');
    dev.addEventListener('input', function () {
      state.devices = parseInt(dev.value);
      $('val-devices').textContent = state.devices + (state.devices === 1 ? ' device' : ' devices');
      // Dim simultaneity if only 1 device
      var sb = $('simultaneity-block');
      if (sb) sb.classList.toggle('dimmed', state.devices === 1);
    });

    // Simultaneity
    document.querySelectorAll('input[name="simultaneity"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (r.checked) state.simultaneity = r.value;
      });
    });

    $('step3-next').addEventListener('click', function () {
      var result = calculate();
      renderResults(result);
      showStep(4);
    });
    $('step3-back').addEventListener('click', function () { showStep(2); });
  }

  /* ──────────────────────────────────────────────────
     CALCULATION ENGINE
  ────────────────────────────────────────────────── */
  function calculate() {
    var D      = state.devices;
    var files  = FILE_BUCKETS[state.vaultFilesIdx];
    var activeHrs = HOUR_VALUES[state.activeHrsIdx];
    // Cap active hours to a realistic fraction; never more than 16h of the day
    activeHrs = Math.min(activeHrs, 16);
    var idleHrs   = Math.max(0, 14 - activeHrs); // assume ~14h awake time

    // Edit pattern → files changed per sync
    var patternFiles = { light: 1.2, moderate: 3, heavy: 8 };
    var filesPerSync = patternFiles[state.editPattern] || 3;

    // Simultaneity multiplier for cross-device active overlap
    var simMult = { separate: 0.25, sometimes: 0.55, concurrent: 0.85 };
    var concurrencyFactor = simMult[state.simultaneity] || 0.25;

    var L = listOps(files);

    // ── Polling (Smart Sync only) ──────────────────
    var pollBPerDevPerDay = 0;
    var activePollCount = 0;
    var idlePollCount   = 0;

    if (state.method === 'smart') {
      var activePollMs = state.ss_useDefaults ? SS_DEFAULTS.activePollMs : state.ss_activePollMs;
      var idlePollMs   = state.ss_useDefaults ? SS_DEFAULTS.idlePollMs   : state.ss_idlePollMs;
      // Active phase: during active hours
      activePollCount = Math.round(activeHrs * 3600 * 1000 / activePollMs);
      // Idle phase: remaining awake time
      idlePollCount   = Math.round(idleHrs  * 3600 * 1000 / idlePollMs);
      pollBPerDevPerDay = activePollCount + idlePollCount;
    }

    var totalPollB = pollBPerDevPerDay * D * DAYS;

    // ── Syncs per day (per device) ─────────────────
    var syncsPerDevPerDay = 0;
    var startupSyncs = 0; // per device per month

    if (state.method === 'smart') {
      var idleSec  = state.ss_useDefaults ? SS_DEFAULTS.idleSec : state.ss_idleSec;
      // Number of "stop typing" transitions per active hour: faster idle = more triggers
      var triggersPerActiveHour = idleSec <= 5 ? 8 : idleSec <= 15 ? 6 : idleSec <= 30 ? 4 : 2;
      syncsPerDevPerDay = triggersPerActiveHour * activeHrs;
      if (state.ss_syncOnStartup) startupSyncs = 26; // ~26 opens per month

    } else if (state.method === 'manual-auto') {
      var intervalSyncs = 0, saveSyncs = 0, idleAutoSyncs = 0;
      if (state.ma_interval) {
        intervalSyncs = (24 * 60) / Math.max(1, state.ma_intervalMin); // per day
      }
      if (state.ma_save) {
        // Save burst: ~1 burst per 3 min of active writing
        saveSyncs = (activeHrs * 60) / Math.max(1, state.ma_saveDebounce / 60 + 3);
      }
      if (state.ma_idle) {
        var idleTriggersPerHr = state.ma_idleSec <= 10 ? 7 : state.ma_idleSec <= 30 ? 5 : state.ma_idleSec <= 120 ? 3 : 1.5;
        idleAutoSyncs = idleTriggersPerHr * activeHrs;
      }
      // Interval and event syncs can coincide; take max of interval vs events
      syncsPerDevPerDay = Math.max(intervalSyncs, saveSyncs + idleAutoSyncs);
      if (state.ma_startup) startupSyncs = 26;

    } else {
      // manual-only: total monthly manual syncs spread across devices
      syncsPerDevPerDay = (state.mo_syncsPerMonth / D) / DAYS;
    }

    // Add manual trigger bonus (applies to smart + manual-auto)
    var manualBonusSyncs = 0;
    if (state.method !== 'manual-only') {
      var freq = state.method === 'smart' ? state.ss_manualFreq : state.ma_manualFreq;
      manualBonusSyncs = manualFreqToMonthly(freq); // total across all devices per month
    }

    var autoSyncsPerDevPerMonth = syncsPerDevPerDay * DAYS + startupSyncs;
    var totalAutoSyncs = autoSyncsPerDevPerMonth * D;
    var totalSyncs     = totalAutoSyncs + manualBonusSyncs;

    // Fraction of syncs that actually change something (have files to push)
    // ~35% of triggered syncs find real changes on average
    var activeSyncFraction = 0.35;
    var activeSyncs = Math.round(totalSyncs * activeSyncFraction);

    // ── Class A ────────────────────────────────────
    // Each sync = 1 LIST (regardless of changes)
    // Active sync = LIST + filePUTs + sentinelPUT
    var listA         = totalSyncs * L;
    var filePutA      = activeSyncs * filesPerSync;
    var sentinelPutA  = activeSyncs; // 1 sentinel write per sync with remote changes

    // Cross-device state-aware pulls: each active sync on one device triggers
    // (D-1) other devices to do a LIST-based scan
    // Modulated by concurrency factor and that some devices may be offline
    var crossDeviceSyncs = activeSyncs * (D - 1) * concurrencyFactor;
    var crossListA = crossDeviceSyncs * L;

    var classA = Math.round(listA + filePutA + sentinelPutA + crossListA);

    // ── Class B ────────────────────────────────────
    // Own syncs: ETag HEAD per file pushed
    var etagHeadB    = activeSyncs * filesPerSync;
    // Connection check HEAD: 1 per sync run
    var connCheckB   = totalSyncs;
    // Cross-device: file GETs + sentinel GET per triggered pull
    var crossGetB    = crossDeviceSyncs * (filesPerSync + 1);
    // Sentinel GET: when a foreign change is actually confirmed after poll
    var sentinelGetB = activeSyncs * (D - 1) * concurrencyFactor;

    var classB = Math.round(totalPollB + etagHeadB + connCheckB + crossGetB + sentinelGetB);

    // ── Range ──────────────────────────────────────
    var classA_low  = Math.round(classA * 0.6);
    var classA_high = Math.round(classA * 1.6);
    var classB_low  = Math.round(classB * 0.6);
    var classB_high = Math.round(classB * 1.6);

    return {
      A: classA, B: classB,
      A_low: classA_low, A_high: classA_high,
      B_low: classB_low, B_high: classB_high,
      breakdown: {
        pollB:        Math.round(totalPollB),
        etagHeadB:    Math.round(etagHeadB),
        connCheckB:   Math.round(connCheckB),
        crossGetB:    Math.round(crossGetB + sentinelGetB),
        listA:        Math.round(listA),
        filePutA:     Math.round(filePutA + sentinelPutA),
        crossListA:   Math.round(crossListA),
        activePollCount: activePollCount,
        idlePollCount:   idlePollCount,
        totalSyncs:      Math.round(totalSyncs),
        activeSyncs:     activeSyncs,
        L:               L
      }
    };
  }

  /* ──────────────────────────────────────────────────
     RENDER RESULTS
  ────────────────────────────────────────────────── */
  function renderResults(r) {
    var b   = r.breakdown;
    var pA  = pct(r.A, A_LIMIT);
    var pB  = pct(r.B, B_LIMIT);
    var maxP = Math.max(pA, pB);
    var clA  = colorClass(pA);
    var clB  = colorClass(pB);

    // Config recap chips
    var chips = $('result-chips');
    chips.innerHTML = '';
    var chipData = [
      { icon: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>', text: methodLabel() },
      { icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', text: FILE_BUCKETS[state.vaultFilesIdx].toLocaleString() + ' files' },
      { icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', text: HOUR_VALUES[state.activeHrsIdx] + 'h / day' },
      { icon: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>', text: state.devices + (state.devices === 1 ? ' device' : ' devices') }
    ];
    chipData.forEach(function (c) {
      var chip = document.createElement('span');
      chip.className = 'calc-chip';
      chip.innerHTML = svg(c.icon, 12) + c.text;
      chips.appendChild(chip);
    });

    // Verdict
    var verdict = $('result-verdict');
    var verdictMessages = {
      ok:   { cls: 'ok',   icon: '<polyline points="20 6 9 17 4 12"/>', text: 'Comfortably within the free tier. No charges expected at this usage level.' },
      warn: { cls: 'warn', icon: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', text: 'Moderate usage — within the free tier, but worth keeping an eye on your Cloudflare dashboard.' },
      over: { cls: 'over', icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', text: 'Approaching or exceeding free-tier limits. Consider reducing polling frequency, sync triggers, or connected devices.' }
    };
    var vm = verdictMessages[colorClass(maxP)];
    verdict.className = 'calc-verdict-banner ' + vm.cls;
    verdict.innerHTML = '<span class="calc-verdict-icon">' + svg(vm.icon, 18) + '</span><span>' + vm.text + '</span>';

    // Main numbers
    $('result-val-a').textContent = fmt(r.A);
    $('result-val-b').textContent = fmt(r.B);

    var barA = $('result-bar-a');
    barA.style.width = Math.min(pA, 100).toFixed(1) + '%';
    barA.className = 'calc-bar ' + clA;

    var barB = $('result-bar-b');
    barB.style.width = Math.min(pB, 100).toFixed(1) + '%';
    barB.className = 'calc-bar ' + clB;

    var pctA = $('result-pct-a');
    pctA.textContent = pA.toFixed(1) + '% of free tier';
    pctA.className = 'calc-meter-pct ' + clA;

    var pctB = $('result-pct-b');
    pctB.textContent = pB.toFixed(1) + '% of free tier';
    pctB.className = 'calc-meter-pct ' + clB;

    // Range card
    var rangeCard = $('result-range');
    var rangeMaxA = Math.max(r.A_high, 1);
    var rangeMaxB = Math.max(r.B_high, 1);
    rangeCard.innerHTML =
      '<div class="calc-range-title">Estimate range (low &ndash; expected &ndash; high)</div>' +
      '<div class="calc-range-rows">' +
      buildRangeRow('Class A', r.A_low, r.A, r.A_high, rangeMaxA, 'calc-pill-a') +
      buildRangeRow('Class B', r.B_low, r.B, r.B_high, rangeMaxB, 'calc-pill-b') +
      '</div>';

    // Breakdown list
    var bdList = $('result-breakdown');
    bdList.innerHTML = '';
    var totalOps = r.A + r.B;
    var rows = [];

    if (state.method === 'smart' && b.pollB > 0) {
      rows.push({
        label: 'Sentinel polling (HEAD)',
        sub: 'Active: ' + fmt(b.activePollCount) + '/dev/day &nbsp;&middot;&nbsp; Idle: ' + fmt(b.idlePollCount) + '/dev/day',
        pill: 'b', val: b.pollB
      });
    }
    rows.push({
      label: 'Sync scan (LIST)',
      sub: b.L + ' LIST per sync &nbsp;&middot;&nbsp; ' + fmt(b.totalSyncs) + ' syncs / month',
      pill: 'a', val: b.listA
    });
    rows.push({
      label: 'File uploads (PUT) + sentinel writes',
      sub: fmt(b.activeSyncs) + ' syncs with actual changes',
      pill: 'a', val: b.filePutA
    });
    if (b.crossListA > 0) {
      rows.push({
        label: 'Cross-device pull scans (LIST)',
        sub: 'Remote changes trigger scan on ' + (state.devices - 1) + ' other device(s)',
        pill: 'a', val: b.crossListA
      });
    }
    rows.push({
      label: 'ETag verification + connection checks (HEAD)',
      pill: 'b', val: b.etagHeadB + b.connCheckB
    });
    if (b.crossGetB > 0) {
      rows.push({
        label: 'Cross-device file downloads + sentinel reads (GET)',
        sub: 'Files pulled by other devices after remote changes',
        pill: 'b', val: b.crossGetB
      });
    }

    rows.forEach(function (row) {
      var el = document.createElement('div');
      el.className = 'calc-bd-row';
      var shareVal = totalOps > 0 ? (row.val / totalOps * 100).toFixed(0) + '%' : '—';
      el.innerHTML =
        '<div class="calc-bd-source">' +
          row.label +
          (row.sub ? '<small>' + row.sub + '</small>' : '') +
        '</div>' +
        '<span class="calc-pill calc-pill-' + row.pill + '">' + (row.pill === 'a' ? 'A' : 'B') + '</span>' +
        '<div class="calc-bd-val">' + fmt(row.val) + '</div>' +
        '<div class="calc-bd-share">' + shareVal + '</div>';
      bdList.appendChild(el);
    });

    // Tip
    renderTip(b, pA, pB);
  }

  function buildRangeRow(label, low, mid, high, maxVal, pillClass) {
    var lowPct  = (low  / maxVal * 100).toFixed(1);
    var midPct  = (mid  / maxVal * 100).toFixed(1);
    var highPct = (high / maxVal * 100).toFixed(1);
    return '<div class="calc-range-row">' +
      '<span class="calc-range-class"><span class="calc-pill ' + pillClass + '">' + (pillClass === 'calc-pill-a' ? 'A' : 'B') + '</span></span>' +
      '<span class="calc-range-label">low</span>' +
      '<div class="calc-range-bar-wrap"><div class="calc-range-bar low" style="width:' + lowPct + '%"></div></div>' +
      '<span class="calc-range-val">' + fmt(low) + '</span>' +
      '</div>' +
      '<div class="calc-range-row">' +
      '<span class="calc-range-class"></span>' +
      '<span class="calc-range-label">expected</span>' +
      '<div class="calc-range-bar-wrap"><div class="calc-range-bar mid" style="width:' + midPct + '%"></div></div>' +
      '<span class="calc-range-val">' + fmt(mid) + '</span>' +
      '</div>' +
      '<div class="calc-range-row">' +
      '<span class="calc-range-class"></span>' +
      '<span class="calc-range-label">high</span>' +
      '<div class="calc-range-bar-wrap"><div class="calc-range-bar high" style="width:' + highPct + '%"></div></div>' +
      '<span class="calc-range-val">' + fmt(high) + '</span>' +
      '</div>';
  }

  function renderTip(b, pA, pB) {
    var tipEl    = $('result-tip');
    var tipTitle = $('result-tip-title');
    var tipBody  = $('result-tip-body');
    var maxP     = Math.max(pA, pB);
    if (maxP < 20) {
      tipEl.style.display = 'none';
      return;
    }
    tipEl.style.display = '';

    // Find the biggest driver
    if (state.method === 'smart' && b.pollB > (b.etagHeadB + b.crossGetB + b.connCheckB) * 2) {
      tipTitle.textContent = 'Polling is your biggest Class B cost';
      tipBody.textContent  = 'Sentinel polling accounts for the majority of your read operations. ' +
        'Increasing the active poll interval from the default 2s to 5–10s would reduce Class B by 40–60% with minimal impact on sync responsiveness.';
    } else if (b.crossListA > b.listA * 0.5) {
      tipTitle.textContent = 'Cross-device pull scans are driving Class A usage';
      tipBody.textContent  = 'With ' + state.devices + ' frequently active devices, each sync on one device triggers scans on the others. ' +
        'Reducing devices from ' + state.devices + ' to ' + Math.max(1, state.devices - 1) + ' would meaningfully reduce Class A usage.';
    } else if (pA > 60) {
      tipTitle.textContent = 'Your vault size amplifies LIST cost';
      tipBody.textContent  = 'R2 paginates LIST at 1,000 objects. Your vault requires ' + b.L + ' LIST operations per sync scan. ' +
        'Increasing the auto-sync interval or using on-idle triggers instead of an interval would reduce how often these scans run.';
    } else {
      tipTitle.textContent = 'You\'re well within the free tier';
      tipBody.textContent  = 'Your configuration leaves plenty of headroom. Even the high estimate stays below the free-tier limit.';
    }
  }

  function methodLabel() {
    if (state.method === 'smart')       return 'Smart Sync';
    if (state.method === 'manual-auto') return 'Manual automation';
    return 'Always manual';
  }

  /* ──────────────────────────────────────────────────
     STEP 4 — Back / restart
  ────────────────────────────────────────────────── */
  function initStep4() {
    $('step4-back').addEventListener('click', function () { showStep(3); });
    $('step4-restart').addEventListener('click', function () {
      // Reset method selection
      document.querySelectorAll('.calc-method-card').forEach(function (c) { c.classList.remove('selected'); });
      $('step1-next').disabled = true;
      state.method = null;
      showStep(1);
    });
  }

  /* ──────────────────────────────────────────────────
     STEP 2 BACK / NEXT wiring
  ────────────────────────────────────────────────── */
  function initStep2Nav() {
    $('step2-back').addEventListener('click', function () { showStep(1); });
    $('step2-next').addEventListener('click', function () { showStep(3); });
  }

  /* ──────────────────────────────────────────────────
     INIT
  ────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    initStep1();
    initStep2Nav();
    initStep3();
    initStep4();
    updateProgress(1);
  });

})();
