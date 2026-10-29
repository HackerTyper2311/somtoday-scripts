/*
 * tampermonkey.js - Somtoday loader + MOD 2.0 tab.
 * Put this file in the ROOT of the somtoday-scripts repo. Mods live in scripts/.
 * Mods are OFF by default. Enable them from the "SomToday MOD 2.0" tab.
 */
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

  /* ---------- DOM helper ---------- */
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* ---------- MOD 2.0 tab ---------- */
  var availableMods = null;   // [{name, sha}] once the folder listing is known
  var modOpen = false;
  var originalTitle = null;

  /*
   * Fallback styles, used only when no native Somtoday settings row is on the
   * page to clone. !important forces the look, because Somtoday's own scoped
   * styles don't reach elements we create.
   */
  var MOD_CSS = [
    '#' + PANEL_ID + ' { display: block !important; padding: 8px 0 !important; font-family: inherit !important; color: var(--fg-neutral-strong, #222) !important; box-sizing: border-box !important; }',
    '#' + PANEL_ID + ' .sl-mod-item { display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 16px !important; padding: 16px 24px !important; min-height: 56px !important; box-sizing: border-box !important; cursor: pointer !important; background: transparent !important; }',
    '#' + PANEL_ID + ' .sl-mod-item:hover { background: var(--bg-neutral-weakest, rgba(0,0,0,.03)) !important; }',
    '#' + PANEL_ID + ' .sl-mod-item:focus-visible { outline: 2px solid var(--action-primary-normal, #3565d4) !important; outline-offset: -2px !important; }',
    '#' + PANEL_ID + ' .sl-mod-text { display: block !important; flex: 1 1 auto !important; min-width: 0 !important; }',
    '#' + PANEL_ID + ' .settings-label { display: block !important; font-size: 16px !important; line-height: 22px !important; font-weight: 400 !important; color: var(--fg-neutral-strong, #222) !important; }',
    '#' + PANEL_ID + ' .settings-subtext { display: block !important; font-size: 13px !important; line-height: 18px !important; color: var(--fg-neutral-moderate, #666) !important; margin-top: 2px !important; }',
    '#' + PANEL_ID + ' .setting-divider { display: block !important; height: 1px !important; margin: 0 24px !important; background: var(--border-neutral-weak, #e5e5e5) !important; }',
    '#' + PANEL_ID + ' hmy-toggle { display: inline-block !important; flex: 0 0 auto !important; position: relative !important; width: 44px !important; height: 24px !important; cursor: pointer !important; }',
    '#' + PANEL_ID + ' hmy-toggle .toggle { position: relative !important; width: 44px !important; height: 24px !important; }',
    '#' + PANEL_ID + ' hmy-toggle input { position: absolute !important; opacity: 0 !important; width: 0 !important; height: 0 !important; margin: 0 !important; pointer-events: none !important; }',
    '#' + PANEL_ID + ' hmy-toggle .slider { position: absolute !important; inset: 0 !important; border-radius: 999px !important; background: var(--bg-neutral-strong, #bdbdbd) !important; transition: background 150ms ease !important; }',
    '#' + PANEL_ID + ' hmy-toggle .slider::before { content: "" !important; position: absolute !important; left: 3px !important; top: 3px !important; width: 18px !important; height: 18px !important; border-radius: 50% !important; background: #fff !important; box-shadow: 0 1px 3px rgba(0,0,0,.3) !important; transition: transform 150ms ease !important; }',
    '#' + PANEL_ID + ' hmy-toggle input:checked + .slider { background: var(--action-primary-normal, #3565d4) !important; }',
    '#' + PANEL_ID + ' hmy-toggle input:checked + .slider::before { transform: translateX(20px) !important; }',
    '#' + PANEL_ID + ' .mod-intro { padding: 8px 24px 16px !important; font-size: 13px !important; line-height: 18px !important; color: var(--fg-neutral-moderate, #666) !important; }',
    '#' + PANEL_ID + ' .mod-note { display: none; margin: 12px 24px 0 !important; padding: 10px 12px !important; border-radius: 8px !important; font-size: 13px !important; background: var(--bg-neutral-weakest, #f5f5f5) !important; color: var(--fg-neutral-strong, #222) !important; }',
    '#' + PANEL_ID + ' .mod-note button { margin-left: 8px !important; padding: 4px 12px !important; border-radius: 6px !important; cursor: pointer !important; border: 1px solid currentColor !important; background: transparent !important; color: inherit !important; font: inherit !important; }',
    '#' + PANEL_ID + ' .mod-empty { padding: 16px 24px !important; font-size: 14px !important; color: var(--fg-neutral-moderate, #666) !important; }'
  ].join('\n');

  function injectModStyles() {
    if (document.getElementById('somtoday-mod-style')) return;
    var s = document.createElement('style');
    s.id = 'somtoday-mod-style';
    s.textContent = MOD_CSS;
    (document.head || document.documentElement).appendChild(s);
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

  /* ---------- rows ---------- */

  // A native sl-setting-item that is on the page, not one of ours.
  function findNativeItem() {
    var items = document.querySelectorAll('sl-setting-item');
    for (var i = 0; i < items.length; i++) {
      var n = items[i];
      if (n.closest('#' + PANEL_ID)) continue;
      if (n.querySelector('hmy-toggle .slider')) return n;
    }
    return null;
  }

  function setRowState(row, on) {
    var tog = row.querySelector('hmy-toggle');
    var box = row.querySelector('hmy-toggle input');
    if (tog) tog.setAttribute('aria-checked', String(on));
    if (box) box.checked = on;
  }

  // Preferred: clone a real Somtoday row so Angular-scoped styles still apply.
  function buildNativeRow(f, on) {
    var native = findNativeItem();
    if (!native) return null;

    var row = native.cloneNode(true);
    row.classList.add('sl-mod-item');
    row.removeAttribute('label');
    row.removeAttribute('subtext');
    row.removeAttribute('arialabel');

    var lbl = row.querySelector('.settings-label');
    if (lbl) lbl.textContent = modLabel(f.name);

    var sub = row.querySelector('.settings-subtext');
    if (sub) sub.textContent = 'Mod. Staat standaard uit.';

    var tog = row.querySelector('hmy-toggle');
    if (tog) tog.setAttribute('aria-label', modLabel(f.name));

    setRowState(row, on);
    return row;
  }

  // Fallback: same class names and structure, styled by MOD_CSS.
  function buildFallbackRow(f, on) {
    var input = el('input', { type: 'checkbox', tabindex: '-1' });
    input.checked = on;

    var toggle = el('hmy-toggle', {
      tabindex: '0',
      role: 'checkbox',
      'aria-label': modLabel(f.name),
      'aria-checked': String(on)
    }, [
      el('div', { class: 'toggle' }, [input, el('div', { class: 'slider' })])
    ]);

    var text = el('div', { class: 'sl-mod-text' }, [
      el('span', { class: 'settings-label', text: modLabel(f.name) }),
      el('span', { class: 'settings-subtext', text: 'Mod. Staat standaard uit.' })
    ]);

    return el('div', { class: 'sl-mod-item' }, [text, toggle]);
  }

  function buildRow(f) {
    var on = isEnabled(f.name);
    var row = buildNativeRow(f, on) || buildFallbackRow(f, on);

    var noteRef = null;
    row.addEventListener('click', function (e) {
      // Let the toggle itself pass through; the row handles the click either way.
      e.preventDefault();
      var next = !isEnabled(f.name);
      setEnabled(f.name, next);
      setRowState(row, next);
      if (noteRef) noteRef.style.display = '';
    });

    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'checkbox');
    row.setAttribute('aria-checked', String(on));
    row.setAttribute('aria-label', modLabel(f.name));
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        row.click();
      }
    });

    row._setNoteRef = function (n) { noteRef = n; };
    return row;
  }

  function renderPanel() {
    if (!modOpen) return;
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.textContent = '';

    if (availableMods === null) {
      panel.appendChild(el('div', { class: 'mod-empty', text: 'Mods laden…' }));
      return;
    }
    if (!availableMods.length) {
      panel.appendChild(el('div', { class: 'mod-empty', text: 'Geen mods gevonden in scripts/.' }));
      return;
    }

    var reloadBtn = el('button', { type: 'button', text: 'Nu opnieuw laden' });
    reloadBtn.addEventListener('click', function () { location.reload(); });

    var note = el('div', { class: 'mod-note' }, [
      el('span', { text: 'Herlaad de pagina om de wijziging toe te passen.' }),
      reloadBtn
    ]);

    availableMods.forEach(function (f, i) {
      if (i > 0) panel.appendChild(el('div', { class: 'setting-divider' }));
      var row = buildRow(f);
      if (row._setNoteRef) row._setNoteRef(note);
      panel.appendChild(row);
    });

    panel.appendChild(note);
  }

  function openMod() {
    const content = getContent();
    const details = getDetails();
    const nav = getNav();
    if (!content || !details || !nav) return;

    injectModStyles();

    modOpen = true;
    const modTab = getModTab();
    nav.querySelectorAll(TAB).forEach(t => setSelected(t, t === modTab));

    const title = details.querySelector('.title');
    if (title) {
      if (originalTitle === null) originalTitle = title.textContent;
      title.textContent = LABEL;
    }

    content.style.display = 'none';

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = el('div', { id: PANEL_ID });
      content.after(panel);
    }
    panel.style.display = '';
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
      if (modOpen && !getModTab()) closeMod();
    });
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  injectTab();

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
