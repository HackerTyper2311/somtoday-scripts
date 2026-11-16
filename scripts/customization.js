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
  var IMAGE_KEY = 'rooster-bg-image';
  var activeImage = null;     /* image mode: data URL */

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
    h.backgroundSize = '';
    h.backgroundPosition = '';
    activeImage = null;
    var st = document.getElementById(STYLE_ID);
    if (st) st.remove();
    activeMid = null;
  }

  function injectGradientStyle(css, mid, extra) {
    var st = document.getElementById(STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = GRADIENT_SELECTORS.join(',') +
      '{background-color:' + mid + ' !important;' +
      'background-image:' + css + ' !important;' +
      'background-attachment:fixed !important;' + (extra || '') + '}';
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
    if (save) { store(STORAGE_KEY, color); store(GRADIENT_KEY, null); store(IMAGE_KEY, null); }
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
    if (save) { store(GRADIENT_KEY, JSON.stringify(activeGradient)); store(STORAGE_KEY, null); store(IMAGE_KEY, null); }
    updateActiveRing();
  }

  /* In image mode the toolbars/sticky bars become frosted glass: a tinted,
     translucent layer that blurs whatever image sits behind them. */
  function injectBarBlurStyle() {
    var st = document.getElementById(STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(st);
    }
    var glass = 'rgba(24,28,32,.6)';
    var blur = 'blur(16px) saturate(1.3)';
    st.textContent = GRADIENT_SELECTORS.join(',') +
      '{background-color:' + glass + ' !important;' +
      'background-image:none !important;' +
      '-webkit-backdrop-filter:' + blur + ' !important;' +
      'backdrop-filter:' + blur + ' !important;}';
  }

  function setImage(dataUrl, save) {
    clearGradientStyles();
    var s = document.documentElement.style;
    var mid = '#181c20';
    RESET_VARS.forEach(function (v) { s.setProperty(v, mid); });
    var css = 'url("' + dataUrl + '")';
    s.backgroundColor = mid;
    s.backgroundImage = css;
    s.backgroundSize = 'cover';
    s.backgroundPosition = 'center';
    s.backgroundAttachment = 'fixed';
    if (document.body) document.body.style.backgroundColor = 'transparent';
    injectBarBlurStyle();
    activeMid = mid;
    mode = 'image';
    activeColor = null;
    activeGradient = null;
    activeImage = dataUrl;
    if (save) { store(IMAGE_KEY, dataUrl); store(STORAGE_KEY, null); store(GRADIENT_KEY, null); }
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
    store(IMAGE_KEY, null);
    updateActiveRing();
  }
  window.__somtodayBgReset = reset; /* handy from the console */

  function reapply() {
    if (mode === 'solid') setBg(activeColor, false);
    else if (mode === 'gradient') setGradient(activeGradient, false);
    else if (mode === 'image' && activeImage) setImage(activeImage, false);
  }

  /* restore saved state */
  (function () {
    var img = load(IMAGE_KEY);
    if (img) { setImage(img, false); return; }
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
    var expected = (mode === 'gradient' || mode === 'image') ? activeMid : activeColor;
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

  /* ============================================================
   * 5. CUSTOM TAB IN MOD 2.0 SETTINGS
   * Registers with the loader's public API, so the background
   * tool gets its own tab next to "SomToday MOD 2.0" instead of
   * being injected into the Weergave section.
   * ============================================================ */
  var TAB_ID = 'bg-customization';

  /* ---------- image upload ---------- */
  var IMAGE_MAX_CHARS = 4500000; /* keep well under localStorage's ~5 MB quota */

  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Kon het bestand niet lezen.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Dit is geen geldige afbeelding.')); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxSide / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * scale));
          c.height = Math.max(1, Math.round(h * scale));
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#181c20';   /* flatten transparency onto a dark base */
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleUpload(file) {
    /* Try a good quality first, then smaller/lower quality if storage would be too full */
    var attempts = [[1920, 0.85], [1280, 0.75], [960, 0.6]];
    var step = 0;

    function next() {
      var a = attempts[step++];
      if (!a) return Promise.reject(new Error('Afbeelding is te groot om op te slaan.'));
      return compressImage(file, a[0], a[1]).then(function (data) {
        if (data.length > IMAGE_MAX_CHARS) return next();
        return data;
      });
    }

    return next().then(function (data) {
      setImage(data, true);
      if (load(IMAGE_KEY) !== data) {
        throw new Error('Opslaan lukt niet (opslagruimte vol?).');
      }
    });
  }

  function buildImageSection(refresh) {
    var box = el('div', {
      display: 'flex', flexDirection: 'column', gap: '10px',
      padding: '16px 24px 0', boxSizing: 'border-box', width: '100%',
      borderTop: '1px solid var(--border-neutral-weak, #e5e5e5)', marginTop: '8px'
    });

    box.appendChild(el('div', { fontWeight: '600', fontSize: '15px' }, 'Eigen afbeelding'));

    var preview = el('div', {
      height: '90px', borderRadius: '10px', width: '100%',
      border: '1px solid rgba(128,128,128,.5)',
      backgroundSize: 'cover', backgroundPosition: 'center',
      backgroundColor: 'rgba(128,128,128,.15)',
      backgroundImage: activeImage ? 'url("' + activeImage + '")' : 'none'
    });
    box.appendChild(preview);

    var status = el('div', { fontSize: '13px', minHeight: '18px',
      color: 'var(--fg-neutral-moderate, #666)' }, '');
    var input = el('input', { display: 'none' });
    input.type = 'file';
    input.accept = 'image/*';

    var row = el('div', { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' });
    var uploadBtn = smallBtn('Afbeelding uploaden');
    var removeBtn = smallBtn('Afbeelding verwijderen');
    removeBtn.disabled = !activeImage;
    if (!activeImage) removeBtn.style.opacity = '.5';
    row.appendChild(uploadBtn);
    row.appendChild(removeBtn);

    uploadBtn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { status.textContent = 'Kies een afbeeldingsbestand.'; return; }
      status.textContent = 'Bezig met laden…';
      handleUpload(file).then(function () {
        status.textContent = '';
        refresh();
      }, function (err) {
        status.textContent = err.message || 'Uploaden mislukt.';
      });
    });
    removeBtn.addEventListener('click', function () {
      reset();
      refresh();
    });

    box.appendChild(input);
    box.appendChild(row);
    box.appendChild(status);
    return box;
  }

  function renderTab(panel) {
    panel.textContent = '';

    panel.appendChild(el('div', {
      padding: '8px 24px 12px', fontSize: '13px', lineHeight: '18px',
      color: 'var(--fg-neutral-moderate, #666)'
    }, 'Kies een achtergrondkleur, verloop of eigen afbeelding voor Somtoday.'));

    var body = buildSettingsRow();
    body.style.padding = '6px 24px 16px';
    panel.appendChild(body);

    /* Re-render the tab after an upload/removal so the preview and buttons update */
    panel.appendChild(buildImageSection(function () { renderTab(panel); }));
    updateActiveRing();
  }

  function registerCustomTab() {
    var api = window.SomtodayMods;
    if (!api || typeof api.registerTab !== 'function') return false;

    api.registerTab({
      id: TAB_ID,
      label: 'Achtergrond',
      render: renderTab
    });
    return true;
  }

  /* The loader defines SomtodayMods before running mods, but poll briefly
     in case this file is run on its own. */
  (function waitForLoader(tries) {
    if (registerCustomTab() || tries <= 0) return;
    setTimeout(function () { waitForLoader(tries - 1); }, 300);
  })(40);
}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
