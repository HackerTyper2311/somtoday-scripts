(function () {
  'use strict';

  /* ---------- config ---------- */
  var OWNER = 'HackerTyper2311';
  var REPO = 'somtoday-scripts';
  var BRANCH = 'main';
  var FOLDER = 'scripts';
  var CACHE_KEY = 'somtoday-loader-cache';
  var MODS_KEY = 'somtoday-mods-enabled';   // localStorage: { "name.js": true }
  var CACHE_FMT = 2;

  var TAB = 'sl-account-modal-tab';
  var MARK = 'data-mod-tab';
  var LABEL = 'SomToday MOD 2.0';
  var PANEL_ID = 'somtoday-mod-panel';

  var BASE = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/';
  var LIST_URL = BASE + FOLDER + '?ref=' + encodeURIComponent(BRANCH);

  if (window.__somtodayLoaderRan) return; /* never run twice per page */
  window.__somtodayLoaderRan = true;

  function log() {
    console.log.apply(console, ['[Somtoday Loader]'].concat([].slice.call(arguments)));
  }
  function warn() {
    console.warn.apply(console, ['[Somtoday Loader]'].concat([].slice.call(arguments)));
  }

  /* ---------- enabled mods (localStorage, default off) ---------- */
  function getEnabledMap() {
    try {
      var m = JSON.parse(window.localStorage.getItem(MODS_KEY) || '{}');
      return (m && typeof m === 'object') ? m : {};
    } catch (e) { return {}; }
  }
  function isEnabled(name) { return getEnabledMap()[name] === true; }
  function setEnabled(name, on) {
    var m = getEnabledMap();
    if (on) m[name] = true; else delete m[name];
    try { window.localStorage.setItem(MODS_KEY, JSON.stringify(m)); }
    catch (e) { warn('could not save mod state:', e && e.message); }
  }
  function modLabel(fileName) { return fileName.replace(/\.js$/i, ''); }

  /* ---------- cache ---------- */
  function loadCache() {
    try {
      var c = GM_getValue(CACHE_KEY, null);
      if (c && typeof c === 'string') c = JSON.parse(c);
      if (c && typeof c === 'object') return c;
    } catch (e) {}
    return { listing: null, etag: null, files: {} };
  }
  function saveCache(c) {
    try { GM_setValue(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Somtoday Loader: clear cache', function () {
      GM_deleteValue(CACHE_KEY);
      log('cache cleared, reload the page');
    });
  }

  /* ---------- network ---------- */
  function request(url, headers) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: headers || {},
        onload: function (r) {
          if ((r.status >= 200 && r.status < 300) || r.status === 304) {
            var m = /^etag:\s*(.+)$/im.exec(r.responseHeaders || '');
            resolve({ status: r.status, text: r.responseText, etag: m ? m[1].trim() : null });
          } else {
            reject(new Error('HTTP ' + r.status + ' for ' + url));
          }
        },
        onerror: function () { reject(new Error('Network error for ' + url)); },
        ontimeout: function () { reject(new Error('Timeout for ' + url)); }
      });
    });
  }

  /* ---------- folder listing (checked every load, 304 if unchanged) ---------- */
  function getListing(cache) {
    var headers = { Accept: 'application/vnd.github+json' };
    if (cache.etag && cache.listing) headers['If-None-Match'] = cache.etag;

    return request(LIST_URL, headers).then(function (r) {
      if (r.status === 304 && cache.listing) return cache.listing;
      var items = JSON.parse(r.text);
      if (!Array.isArray(items)) throw new Error('Unexpected API response');
      cache.listing = items
        .filter(function (i) { return i.type === 'file' && /\.js$/i.test(i.name); })
        .map(function (i) { return { name: i.name, sha: i.sha }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      cache.etag = r.etag;
      saveCache(cache);
      return cache.listing;
    }).catch(function (err) {
      if (cache.listing) {
        warn('could not check for updates, using cached scripts:', err.message);
        toast('Somtoday Loader: could not check for updates (' + err.message + '), using cached scripts');
        return cache.listing;
      }
      throw err;
    });
  }

  /* ---------- file contents (only for enabled mods) ---------- */
  /* Entries without fmt:2 came from older loaders and may hold stale code. */
  function getCode(file, cache) {
    var hit = cache.files[file.name];
    if (hit && hit.fmt === CACHE_FMT && hit.sha === file.sha) {
      log(file.name + ': using cached copy (' + hit.code.length + ' chars)');
      return Promise.resolve(hit.code);
    }

    var url = BASE + FOLDER + '/' + encodeURIComponent(file.name) +
      '?ref=' + encodeURIComponent(BRANCH);
    return request(url, { Accept: 'application/vnd.github.raw+json' }).then(function (r) {
      cache.files[file.name] = { sha: file.sha, fmt: CACHE_FMT, code: r.text };
      saveCache(cache);
      log(file.name + ': downloaded fresh copy (' + r.text.length + ' chars)');
      return r.text;
    }).catch(function (err) {
      if (hit) {
        warn('could not refresh ' + file.name + ', using cached copy:', err.message);
        return hit.code;
      }
      throw err;
    });
  }

  /* ---------- toast ---------- */
  function toast(msg) {
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;' +
        'background:#b3261e;color:#fff;padding:8px 12px;border-radius:8px;' +
        'font:13px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)';
      (document.body || document.documentElement).appendChild(t);
      setTimeout(function () { t.remove(); }, 8000);
    } catch (e) {}
  }

  /* ---------- execution ---------- */
  var runCounter = 0;

  function run(name, code) {
    var id = 'sl' + (++runCounter);
    var root = document.documentElement;
    var tail = '\n//# sourceURL=somtoday-scripts/' + name;
    var src = 'document.documentElement.setAttribute("data-sl-ran", "' + id + '");\n' +
      code + tail;
    function ran() { return root.getAttribute('data-sl-ran') === id; }

    if (typeof GM_addElement === 'function') {
      try {
        var s1 = GM_addElement('script', { textContent: src });
        if (s1 && s1.remove) s1.remove();
        if (ran()) { log('ran ' + name + ' (GM_addElement)'); return; }
      } catch (e) {
        warn('GM_addElement failed for ' + name + ':', e && e.message);
      }
    }

    try {
      var el = document.createElement('script');
      el.textContent = src;
      (document.head || root).appendChild(el);
      el.remove();
      if (ran()) { log('ran ' + name + ' (inline script)'); return; }
    } catch (e) {
      warn('inline script failed for ' + name + ':', e && e.message);
    }

    try {
      (new Function(code + tail))();
      log('ran ' + name + ' (sandbox)');
    } catch (e) {
      console.error('[Somtoday Loader] ' + name + ' could not run:', e);
      toast('Somtoday Loader: ' + name + ' was blocked or crashed, see the console');
    }
  }

  /* ---------- MOD 2.0 tab ---------- */
  var availableMods = null;   // [{name, sha}] once the folder listing is known
  var modOpen = false;
  var originalTitle = null;

  /*
   * Native Somtoday elements, captured as detached copies so they survive
   * Angular re-renders. Cloning keeps the _ngcontent-* attributes, which is
   * what makes Somtoday's own scoped styles apply to our panel.
   */
  var tpl = { shell: null, subtitle: null, row: null, label: null, divider: null };

  function captureTemplates() {
    var rows = document.querySelectorAll('.settings');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.closest('#' + PANEL_ID)) continue;          // skip our own rows
      if (r.querySelector('.setting-preview')) continue;  // plain rows only
      if (!r.querySelector('hmy-toggle')) continue;
      var label = r.querySelector('.settings-span');
      if (!label) continue;

      var wrapper = r.closest('.weergave-wrapper') || r.parentElement;
      var sub = wrapper.querySelector(':scope > .subtitle');
      var div = wrapper.querySelector(':scope > .setting-divider');

      tpl.row = r.cloneNode(true);
      tpl.label = label.cloneNode(false);
      tpl.shell = wrapper.cloneNode(false);
      tpl.subtitle = sub ? sub.cloneNode(false) : null;
      tpl.divider = div ? div.cloneNode(false) : null;
      return true;
    }
    return false;
  }

  // New element that copies the native class and scope attributes of a source node.
  function makeLike(tag, source, text) {
    var n = document.createElement(tag);
    if (source) {
      n.className = source.className;
      for (var i = 0; i < source.attributes.length; i++) {
        var a = source.attributes[i];
        if (a.name.indexOf('_ngcontent') === 0) n.setAttribute(a.name, a.value);
      }
    }
    n.textContent = text;
    return n;
  }

  function applyState(row, on) {
    var toggle = row.querySelector('hmy-toggle');
    var input = toggle && toggle.querySelector('input');
    if (input) input.checked = on;
    if (toggle) toggle.setAttribute('aria-checked', String(on));
    row.setAttribute('aria-checked', String(on));
  }

  function buildNote() {
    var note = makeLike('div', tpl.label, 'Herlaad de pagina om de wijziging toe te passen.');
    note.style.display = 'none';
    note.style.padding = '12px 24px 0';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Nu opnieuw laden';
    btn.style.cssText = 'margin-left:12px;cursor:pointer;background:transparent;color:inherit;' +
      'border:1px solid rgba(128,128,128,.6);border-radius:6px;padding:4px 10px;' +
      'font:inherit;font-size:13px';
    btn.addEventListener('click', function () { location.reload(); });

    note.appendChild(btn);
    return note;
  }

  function buildRow(f, note) {
    var on = isEnabled(f.name);
    var row = tpl.row.cloneNode(true);

    // Plain row: drop the preview chip and the profile-photo variant.
    row.classList.remove('with-preview', 'profielfoto-optie');
    row.querySelectorAll('.setting-preview').forEach(function (n) { n.remove(); });
    row.removeAttribute('data-gtm');

    var label = row.querySelector('.settings-span');
    if (label) {
      label.textContent = modLabel(f.name);
    }

    var toggle = row.querySelector('hmy-toggle');
    if (toggle) {
      toggle.removeAttribute('data-gtm');
      toggle.removeAttribute('tabindex');
      toggle.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-label', modLabel(f.name));
    }

    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'checkbox');
    row.setAttribute('aria-label', modLabel(f.name));
    row.style.cursor = 'pointer';
    applyState(row, on);

    function flip() {
      var next = !isEnabled(f.name);
      setEnabled(f.name, next);
      applyState(row, next);
      note.style.display = 'block';
    }

    row.addEventListener('click', function (e) {
      e.preventDefault();
      flip();
    });
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        flip();
      }
    });

    return row;
  }

  function renderPanel() {
    if (!modOpen) return;
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.textContent = '';

    if (!tpl.row) {
      panel.appendChild(makeLike('span', tpl.label,
        'Open eerst de tab Weergave in Instellingen en open daarna SomToday MOD 2.0 opnieuw.'));
      return;
    }

    if (tpl.subtitle) {
      panel.appendChild(makeLike('div', tpl.subtitle, 'Mods'));
    }

    if (availableMods === null) {
      panel.appendChild(makeLike('span', tpl.label, 'Mods laden…'));
      return;
    }
    if (!availableMods.length) {
      panel.appendChild(makeLike('span', tpl.label, 'Geen mods gevonden in scripts/.'));
      return;
    }

    var note = buildNote();

    availableMods.forEach(function (f, i) {
      if (tpl.divider && i > 0) panel.appendChild(tpl.divider.cloneNode(true));
      panel.appendChild(buildRow(f, note));
    });

    panel.appendChild(note);
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const getNav = () => $('sl-account-modal nav');
  const getDetails = () => $('sl-account-modal-details');
  const getContent = () => $('sl-account-modal-details > .content');
  const getModTab = () => $(`${TAB}[${MARK}]`);

  function setSelected(tab, selected) {
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
  }

  function injectTab() {
    const nav = getNav();
    if (!nav || getModTab()) return;

    const tabs = [...nav.querySelectorAll(`${TAB}:not([${MARK}])`)];
    if (!tabs.length) return;

    const template = tabs.find(t => !t.classList.contains('active')) || tabs[0];
    const clone = template.cloneNode(true);
    clone.setAttribute(MARK, '1');
    setSelected(clone, false);

    const span = clone.querySelector('span');
    if (span) span.textContent = LABEL;

    tabs[tabs.length - 1].after(clone);
  }

  function openMod() {
    const content = getContent();
    const details = getDetails();
    const nav = getNav();
    if (!content || !details || !nav) return;

    captureTemplates();

    modOpen = true;
    const modTab = getModTab();
    nav.querySelectorAll(TAB).forEach(t => setSelected(t, t === modTab));

    const title = details.querySelector('.title');
    if (title) {
      if (originalTitle === null) originalTitle = title.textContent;
      title.textContent = LABEL;
    }

    content.style.display = 'none';

    // Rebuild the panel each time so it always matches the current native look.
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    const panel = tpl.shell ? tpl.shell.cloneNode(false) : document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.display = '';
    content.after(panel);

    renderPanel();
  }

  function closeMod(newTitle) {
    const modTab = getModTab();
    if (modTab) setSelected(modTab, false);

    if (!modOpen) return;
    modOpen = false;

    const content = getContent();
    if (content) content.style.display = '';

    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.display = 'none';

    const title = $('sl-account-modal-details .title');
    if (title) title.textContent = newTitle || originalTitle || title.textContent;
    originalTitle = null;
  }

  // Capture phase, never stops events, so Angular's tabs keep working.
  document.addEventListener('click', (e) => {
    const tab = e.target.closest?.(TAB);
    if (!tab) return;
    if (tab.hasAttribute(MARK)) openMod();
    else closeMod(tab.querySelector('span')?.textContent.trim());
  }, true);

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.(`${TAB}[${MARK}]`)) {
      e.preventDefault();
      openMod();
    }
  }, true);

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      injectTab();
      if (!modOpen) captureTemplates();   // keep templates fresh while browsing Instellingen
      if (modOpen && !getModTab()) closeMod();
    });
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  injectTab();
  captureTemplates();

  /* ---------- main: load only enabled mods ---------- */
  var cache = loadCache();

  getListing(cache).then(function (files) {
    availableMods = files;
    renderPanel();

    if (!files.length) { warn('no .js files found in ' + FOLDER + '/'); return; }

    // forget cached code of deleted files
    var names = {};
    files.forEach(function (f) { names[f.name] = true; });
    Object.keys(cache.files).forEach(function (n) { if (!names[n]) delete cache.files[n]; });

    var enabled = files.filter(function (f) { return isEnabled(f.name); });
    if (!enabled.length) { log('no mods enabled'); return; }

    return Promise.all(enabled.map(function (f) {
      return getCode(f, cache).then(
        function (code) { return { name: f.name, code: code }; },
        function (err) { warn('skipping ' + f.name + ':', err.message); return null; }
      );
    })).then(function (loaded) {
      loaded.forEach(function (s) {
        if (!s) return;
        try { run(s.name, s.code); }
        catch (e) { console.error('[Somtoday Loader] ' + s.name + ' failed:', e); }
      });
      log('done, ' + loaded.filter(Boolean).length + ' of ' + files.length + ' mod(s) loaded');
    });
  }).catch(function (err) {
    availableMods = availableMods || [];
    renderPanel();
    console.error('[Somtoday Loader] could not load scripts:', err);
  });
})();
