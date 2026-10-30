(function () {
  'use strict';

function init() {
  'use strict';

  if (window.__somtodayBgTool) return; /* prevent double injection */
  window.__somtodayBgTool = true;

  var STORAGE_KEY = 'rooster-bg-color';
  var GRADIENT_KEY = 'rooster-bg-gradient';
  var SETTINGS_ID = 'rooster-bg-setting';
  var PICKER_ID = 'rooster-bg-picker';

  var RESET_VARS = [
    '--bg-neutral-none', '--bg-neutral-weakest', '--bg-neutral-weak',
    '--bg-neutral-moderate', '--bg-elevated-none', '--bg-elevated-weakest',
    '--bg-elevated-weak', '--bg-elevated-strong'
  ];
  /* Gradient mode: sticky bars etc. must stay OPAQUE (otherwise the lessons
     scroll visibly through them). They get the same viewport-fixed gradient,
     so they blend seamlessly with the page background. */
  var STYLE_ID = 'rooster-bg-gradient-style';
  var GRADIENT_SELECTORS = [
    'sl-header', 'sl-tab-bar', 'sl-dagen-header', '.headers-container',
    '.navigation', '.dagen', 'sl-rooster-tijden', '.vakanties',
    '.week-nummer', '.stack'
  ];
  var activeMid = null;

  var PRESETS = [
    ['dark', '#181c20'], ['grey', '#2e363e'], ['blue', '#1a2a4d'],
    ['green', '#16301d'], ['purple', '#241a3a'], ['pink', '#3a1a2c']
  ];

  var mode = 'none';        /* 'none' | 'solid' | 'gradient' */
  var activeColor = null;   /* solid mode */
  var activeGradient = null; /* gradient mode: { stops: [...], angle: n } */
  var lastSolid = null;

  /* ============================================================
   * 1. STATE / APPLY
   * ============================================================ */
  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {}
  }
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function clearGradientStyles() {
    var h = document.documentElement.style;
    h.backgroundImage = '';
    h.backgroundAttachment = '';
    var st = document.getElementById(STYLE_ID);
    if (st) st.remove();
    activeMid = null;
  }

  function injectGradientStyle(css, mid) {
    var st = document.getElementById(STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = GRADIENT_SELECTORS.join(',') +
      '{background-color:' + mid + ' !important;' +
      'background-image:' + css + ' !important;' +
      'background-attachment:fixed !important;}';
  }

  function setBg(color, save) {
    var s = document.documentElement.style;
    clearGradientStyles();
    RESET_VARS.forEach(function (v) { s.setProperty(v, color); });
    if (document.body) document.body.style.backgroundColor = color;
    s.backgroundColor = color;
    mode = 'solid';
    activeColor = color;
    activeGradient = null;
    lastSolid = color;
    if (save) { store(STORAGE_KEY, color); store(GRADIENT_KEY, null); }
    updateActiveRing();
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function averageHex(stops) {
    var t = [0, 0, 0];
    stops.forEach(function (c) {
      var r = hexToRgb(c);
      t[0] += r[0]; t[1] += r[1]; t[2] += r[2];
    });
    return 'rgb(' + t.map(function (x) { return Math.round(x / stops.length); }).join(',') + ')';
  }
  function gradientCss(g) {
    return 'linear-gradient(' + g.angle + 'deg, ' + g.stops.join(', ') + ')';
  }

  function setGradient(g, save) {
    var s = document.documentElement.style;
    var mid = averageHex(g.stops);
    RESET_VARS.forEach(function (v) { s.setProperty(v, mid); });
    s.backgroundColor = mid;
    s.backgroundImage = gradientCss(g);
    s.backgroundAttachment = 'fixed';
    /* body must be transparent or it would hide the gradient on <html> */
    if (document.body) document.body.style.backgroundColor = 'transparent';
    injectGradientStyle(gradientCss(g), mid);
    activeMid = mid;
    mode = 'gradient';
    activeColor = null;
    activeGradient = { stops: g.stops.slice(), angle: g.angle };
    if (save) { store(GRADIENT_KEY, JSON.stringify(activeGradient)); store(STORAGE_KEY, null); }
    updateActiveRing();
  }

  function reset() {
    var s = document.documentElement.style;
    RESET_VARS.forEach(function (v) { s.removeProperty(v); });
    clearGradientStyles();
    if (document.body) document.body.style.backgroundColor = '';
    s.backgroundColor = '';
    mode = 'none';
    activeColor = null;
    activeGradient = null;
    store(STORAGE_KEY, null);
    store(GRADIENT_KEY, null);
    updateActiveRing();
  }
  window.__somtodayBgReset = reset; /* handy from the console */

  function reapply() {
    if (mode === 'solid') setBg(activeColor, false);
    else if (mode === 'gradient') setGradient(activeGradient, false);
  }

  /* restore saved state */
  (function () {
    var g = null;
    try { g = JSON.parse(load(GRADIENT_KEY)); } catch (e) {}
    if (g && g.stops && g.stops.length >= 2 && typeof g.angle === 'number') {
      setGradient(g, false);
      return;
    }
    var c = load(STORAGE_KEY);
    if (c) setBg(c, false);
  })();

  window.addEventListener('load', reapply);
  setTimeout(reapply, 1500);
  setTimeout(reapply, 4000);

  /* Somtoday (Angular) rewrites the style attribute on theme changes: re-apply */
  new MutationObserver(function () {
    if (mode === 'none') return;
    var expected = mode === 'gradient' ? activeMid : activeColor;
    var s = document.documentElement.style;
    if (s.getPropertyValue('--bg-neutral-none').trim() !== expected) reapply();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  /* ============================================================
   * 2. HELPERS
   * ============================================================ */
  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) Object.assign(e.style, style);
    if (text != null) e.textContent = text;
    return e;
  }

  function updateActiveRing() {
    var row = document.getElementById(SETTINGS_ID);
    if (!row) return;
    var activePreset = PRESETS.find(function (p) { return p[1] === activeColor; });
    row.querySelectorAll('button[title]').forEach(function (c) {
      var on = activePreset
        ? c.getAttribute('title') === activePreset[0]
        : (c.title === 'Eigen kleur' && mode === 'solid');
      if (c.title === 'Eigen kleur') {
        c.style.boxShadow = on
          ? 'inset 0 0 0 3px rgba(128,128,128,.7), 0 0 0 3px #fff'
          : 'inset 0 0 0 3px rgba(128,128,128,.7)';
      } else {
        c.style.borderColor = on ? '#fff' : 'rgba(128,128,128,.6)';
      }
    });
  }

  function smallBtn(text) {
    return el('button', {
      cursor: 'pointer', background: 'transparent', color: 'inherit',
      border: '1px solid rgba(128,128,128,.6)', borderRadius: '6px',
      padding: '4px 10px', font: 'inherit', fontSize: '13px'
    }, text);
  }

  /* ============================================================
   * 3. ADVANCED: GRADIENT EDITOR
   * ============================================================ */
  function buildAdvanced() {
    var wrap = el('div', { width: '100%', boxSizing: 'border-box', textAlign: 'center' });

    var toggle = smallBtn('Geavanceerd \u25BE');
    wrap.appendChild(toggle);

    var panel = el('div', {
      display: 'none', boxSizing: 'border-box', width: '100%',
      padding: '12px 4px 4px', fontSize: '13px', textAlign: 'left'
    });
    wrap.appendChild(panel);

    var g = activeGradient
      ? { stops: activeGradient.stops.slice(), angle: activeGradient.angle }
      : { stops: ['#1a2a4d', '#3a1a2c'], angle: 135 };

    panel.appendChild(el('div', { fontWeight: '600', marginBottom: '8px' }, 'Verloop'));

    var preview = el('div', {
      height: '28px', borderRadius: '8px', marginBottom: '10px',
      border: '1px solid rgba(128,128,128,.5)'
    });
    panel.appendChild(preview);

    var stopsBox = el('div', { display: 'flex', flexDirection: 'column', gap: '6px' });
    panel.appendChild(stopsBox);

    var addBtn = smallBtn('+ Kleur toevoegen');
    addBtn.style.marginTop = '8px';
    panel.appendChild(addBtn);

    var angleHead = el('div', {
      display: 'flex', justifyContent: 'space-between', margin: '12px 0 4px', fontWeight: '600'
    });
    var angleVal = el('span', null, '');
    angleHead.appendChild(el('span', null, 'Hoek'));
    angleHead.appendChild(angleVal);
    panel.appendChild(angleHead);

    var angle = el('input', { width: '100%', cursor: 'pointer' });
    angle.type = 'range'; angle.min = '0'; angle.max = '360'; angle.step = '1';
    panel.appendChild(angle);

    var actions = el('div', { display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'center' });
    var applyBtn = smallBtn('Verloop toepassen');
    var offBtn = smallBtn('Verloop uit');
    actions.appendChild(applyBtn);
    actions.appendChild(offBtn);
    panel.appendChild(actions);

    function paintPreview() {
      preview.style.background = gradientCss(g);
      angleVal.textContent = g.angle + '\u00B0';
      angle.value = String(g.angle);
    }
    function commit() { paintPreview(); setGradient(g, true); }

    function renderStops() {
      stopsBox.textContent = '';
      g.stops.forEach(function (color, i) {
        var line = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
        var pick = el('input', {
          width: '44px', height: '30px', padding: '0', border: 'none',
          background: 'none', cursor: 'pointer'
        });
        pick.type = 'color';
        pick.value = color;
        var label = el('span', { font: '13px monospace', flex: '1' }, color.toUpperCase());
        pick.addEventListener('input', function () {
          g.stops[i] = pick.value;
          label.textContent = pick.value.toUpperCase();
          commit();
        });
        line.appendChild(pick);
        line.appendChild(label);
        if (g.stops.length > 2) {
          var rm = smallBtn('\u00D7');
          rm.title = 'Verwijder kleur';
          rm.style.padding = '2px 9px';
          rm.addEventListener('click', function () {
            g.stops.splice(i, 1);
            renderStops();
            commit();
          });
          line.appendChild(rm);
        }
        stopsBox.appendChild(line);
      });
      addBtn.style.display = g.stops.length >= 5 ? 'none' : '';
    }

    addBtn.addEventListener('click', function () {
      if (g.stops.length >= 5) return;
      g.stops.push(g.stops[g.stops.length - 1]);
      renderStops();
      commit();
    });
    angle.addEventListener('input', function () {
      g.angle = parseInt(angle.value, 10) || 0;
      commit();
    });
    applyBtn.addEventListener('click', commit);
    offBtn.addEventListener('click', function () {
      if (lastSolid) setBg(lastSolid, true); else reset();
    });

    toggle.addEventListener('click', function () {
      var open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      toggle.textContent = open ? 'Geavanceerd \u25BE' : 'Geavanceerd \u25B4';
    });

    renderStops();
    paintPreview();
    /* keep the panel open if a gradient is already active */
    if (mode === 'gradient') {
      panel.style.display = 'block';
      toggle.textContent = 'Geavanceerd \u25B4';
    }
    return wrap;
  }

  /* ============================================================
   * 4. SETTINGS ROW (account modal > Weergave)
   * ============================================================ */
  function buildSettingsRow() {
    var outer = el('div', {
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
      boxSizing: 'border-box', width: '100%', padding: '6px 0'
    });
    outer.id = SETTINGS_ID;

    var row = el('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
      flexWrap: 'wrap', boxSizing: 'border-box', width: '100%'
    });
    outer.appendChild(row);

    function makeCircle(background, title) {
      var b = el('button', {
        width: '40px', height: '40px', borderRadius: '50%', cursor: 'pointer',
        border: '3px solid rgba(128,128,128,.6)', background: background,
        padding: '0', flexShrink: '0', transition: 'transform .15s ease'
      });
      if (title) b.title = title;
      b.addEventListener('mouseenter', function () { b.style.transform = 'scale(1.12)'; });
      b.addEventListener('mouseleave', function () { b.style.transform = ''; });
      return b;
    }

    PRESETS.forEach(function (p) {
      var b = makeCircle(p[1], p[0]);
      b.addEventListener('click', function () { setBg(p[1], true); });
      row.appendChild(b);
    });

    var rainbow = makeCircle(
      'conic-gradient(#ff0000, #ff8800, #ffee00, #33cc33, #00bbcc, #2244ff, #8800cc, #ff0088, #ff0000)',
      'Eigen kleur'
    );
    rainbow.style.boxSizing = 'border-box';
    rainbow.style.border = 'none';
    rainbow.style.boxShadow = 'inset 0 0 0 3px rgba(128,128,128,.7)';

    var picker = buildScratchPicker(function (hex) { setBg(hex, true); });
    rainbow.addEventListener('click', function (e) {
      e.stopPropagation();
      if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
      var rc = rainbow.getBoundingClientRect();
      picker.style.display = 'block';
      var top = rc.top - picker.offsetHeight - 8;
      if (top < 8) top = rc.bottom + 8;
      var left = rc.left + rc.width / 2 - picker.offsetWidth / 2;
      if (left < 8) left = 8;
      if (left + picker.offsetWidth > innerWidth - 8) left = innerWidth - 8 - picker.offsetWidth;
      picker.style.top = top + 'px';
      picker.style.left = left + 'px';
    });

    if (!document.__roosterBgPickerClose) {
      document.__roosterBgPickerClose = function (e) {
        var p = document.getElementById(PICKER_ID);
        if (p && p.style.display !== 'none' && !p.contains(e.target) &&
            !(e.target.closest && e.target.closest('button[title="Eigen kleur"]'))) {
          p.style.display = 'none';
        }
      };
      document.addEventListener('click', document.__roosterBgPickerClose);
    }

    /* picker lives on <body>; remove stale copy from earlier injections */
    var old = document.getElementById(PICKER_ID);
    if (old) old.remove();
    picker.id = PICKER_ID;
    document.body.appendChild(picker);
    row.appendChild(rainbow);

    outer.appendChild(buildAdvanced());
    return outer;
  }

  /* Scratch-style picker: Color / Saturation / Brightness sliders + hex input */
  function buildScratchPicker(onChange) {
    var hsv = { h: 220, s: 0.4, v: 0.15 };

    function hsvToHex(h, s, v) {
      var f = function (n) {
        var k = (n + h / 60) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
      };
      var to = function (x) {
        var hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      };
      return '#' + to(f(5)) + to(f(3)) + to(f(1));
    }

    function hexToHsv(hex) {
      var m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) return null;
      var n = parseInt(m[1], 16);
      var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      var h = 0;
      if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
      }
      return { h: h, s: max ? d / max : 0, v: max };
    }

    var box = el('div', {
      display: 'none', position: 'fixed', zIndex: '2147483647',
      borderRadius: '10px', padding: '12px 14px',
      boxShadow: '0 6px 24px rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.2)',
      width: '230px', userSelect: 'none', touchAction: 'none',
      font: '13px system-ui, sans-serif', color: '#fff'
    });

    function sliderRow(label, trackBackground) {
      var wrap = el('div', { marginBottom: '12px' });
      var head = el('div', { display: 'flex', justifyContent: 'space-between', marginBottom: '5px' });
      head.appendChild(el('span', { fontWeight: '600' }, label));
      var val = el('span', { fontWeight: '600' }, '0');
      head.appendChild(val);
      var track = el('div', {
        width: '100%', height: '18px', borderRadius: '9px', cursor: 'pointer',
        position: 'relative', background: trackBackground, border: '1px solid rgba(0,0,0,.15)'
      });
      var knob = el('div', {
        position: 'absolute', top: '50%', width: '22px', height: '22px', borderRadius: '50%',
        border: '2px solid rgba(0,0,0,.25)', boxShadow: 'inset 0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,.3)',
        transform: 'translate(-50%,-50%)', pointerEvents: 'none'
      });
      track.appendChild(knob);
      wrap.appendChild(head); wrap.appendChild(track);
      return { wrap: wrap, val: val, track: track, knob: knob };
    }

    var hueRow = sliderRow('Color',
      'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)');
    var satRow = sliderRow('Saturation', '');
    var briRow = sliderRow('Brightness', '');

    var hexInput = el('input', {
      flex: '1', minWidth: '0', font: '13px monospace', color: '#fff',
      background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)',
      borderRadius: '6px', padding: '5px 8px', boxSizing: 'border-box',
      textTransform: 'uppercase'
    });
    hexInput.type = 'text';
    hexInput.maxLength = 7;

    function paint() {
      var hex = hsvToHex(hsv.h, hsv.s, hsv.v);
      hueRow.knob.style.left = ((hsv.h / 360) * 100) + '%';
      hueRow.knob.style.background = hsvToHex(hsv.h, 1, 1);
      hueRow.val.textContent = String(Math.round(hsv.h / 3.6));
      satRow.track.style.background = 'linear-gradient(to right, #808080, ' + hsvToHex(hsv.h, 1, hsv.v) + ')';
      satRow.knob.style.left = (hsv.s * 100) + '%';
      satRow.knob.style.background = hex;
      satRow.val.textContent = String(Math.round(hsv.s * 100));
      briRow.track.style.background = 'linear-gradient(to right, #000, ' + hsvToHex(hsv.h, hsv.s, 1) + ')';
      briRow.knob.style.left = (hsv.v * 100) + '%';
      briRow.knob.style.background = hex;
      briRow.val.textContent = String(Math.round(hsv.v * 100));
      box.style.background = hex;
      hexInput.value = hex.toUpperCase();
    }

    function bindDrag(track, apply) {
      var drag = false;
      function fromEvent(e) {
        var r = track.getBoundingClientRect();
        apply(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      }
      track.addEventListener('pointerdown', function (e) {
        drag = true; track.setPointerCapture(e.pointerId); fromEvent(e);
      });
      track.addEventListener('pointermove', function (e) { if (drag) fromEvent(e); });
      track.addEventListener('pointerup', function () { drag = false; });
    }
    function emit() { paint(); onChange(hsvToHex(hsv.h, hsv.s, hsv.v)); }
    bindDrag(hueRow.track, function (t) { hsv.h = t * 360; emit(); });
    bindDrag(satRow.track, function (t) { hsv.s = t; emit(); });
    bindDrag(briRow.track, function (t) { hsv.v = t; emit(); });

    hexInput.addEventListener('input', function () {
      var parsed = hexToHsv(hexInput.value.trim());
      if (parsed) {
        hsv = parsed;
        emit();
        hexInput.style.borderColor = 'rgba(255,255,255,.3)';
      } else {
        hexInput.style.borderColor = '#ff5555';
      }
    });
    hexInput.addEventListener('keydown', function (e) { e.stopPropagation(); });

    var bottom = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    bottom.appendChild(hexInput);

    box.appendChild(hueRow.wrap);
    box.appendChild(satRow.wrap);
    box.appendChild(briRow.wrap);
    box.appendChild(bottom);

    var start = activeColor && hexToHsv(activeColor);
    if (start) hsv = start;
    paint();
    return box;
  }

  function tryInjectSettings() {
    if (document.getElementById(SETTINGS_ID)) return;
    /* inject into the LAST (topmost) modal; stacked copies would hide the row */
    var modals = Array.prototype.slice.call(document.querySelectorAll('sl-modal'));
    var host = modals.length ? modals[modals.length - 1] : document;
    var all = Array.prototype.slice.call(host.querySelectorAll('sl-weergave'));
    if (modals.length > 1 && !all.length) return;
    if (!all.length) all = Array.prototype.slice.call(document.querySelectorAll('sl-weergave'));
    var wrapper = all.filter(function (w) {
      return w.getBoundingClientRect().height > 0;
    }).pop() || all[all.length - 1] || document.querySelector('.weergave-wrapper');
    if (!wrapper) return;
    if (!wrapper.querySelector('.blok')) return;

    var blok = Array.prototype.filter.call(
      wrapper.querySelectorAll('.blok'),
      function (b) { return b.getClientRects().length > 0; }
    )[0] || wrapper.querySelector('.blok');

    var row = buildSettingsRow();
    if (blok) {
      blok.style.flexWrap = 'wrap';
      var themeBox = blok.querySelector('.container.dark') || blok.querySelector('.container.light');
      if (themeBox && themeBox.nextSibling) blok.insertBefore(row, themeBox.nextSibling);
      else if (themeBox) themeBox.after(row);
      else blok.appendChild(row);
    } else {
      wrapper.appendChild(row);
    }
    updateActiveRing();
  }

  /* Somtoday is a single-page app: keep watching for the settings modal,
     debounced so it stays cheap. */
  var pending = false;
  function check() {
    pending = false;
    try {
      var row = document.getElementById(SETTINGS_ID);
      var modals = document.querySelectorAll('sl-modal');
      if (row && modals.length > 1 && row.closest('sl-modal') !== modals[modals.length - 1]) {
        row.remove();
      }
      tryInjectSettings();
    } catch (e) {
      console.error('[Somtoday BG] inject error', e);
    }
  }
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    setTimeout(check, 200);
  }).observe(document.body, { childList: true, subtree: true });
  check();
}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
