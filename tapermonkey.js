
(function () {
  'use strict';

  /* ---------- config ---------- */
  var OWNER = 'HackerTyper2311';
  var REPO = 'somtoday-scripts';
  var BRANCH = 'main';
  var FOLDER = 'scripts';
  var CACHE_KEY = 'somtoday-loader-cache';
  var MODS_KEY = 'somtoday-mods-enabled';
  var CACHE_FMT = 2;

  var TAB = 'sl-account-modal-tab';
  var MARK = 'data-mod-tab';
  var API_TAB_MARK = 'data-sl-api-tab';
  var LABEL = 'SomToday MOD 2.0';
  var PANEL_ID = 'somtoday-mod-panel';

  var BASE = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/';
  var LIST_URL = BASE + FOLDER + '?ref=' + encodeURIComponent(BRANCH);

  if (window.__somtodayLoaderRan) return;
  window.__somtodayLoaderRan = true;

  function log() {
    console.log.apply(console, ['[Somtoday Loader]'].concat([].slice.call(arguments)));
  }

  function warn() {
    console.warn.apply(console, ['[Somtoday Loader]'].concat([].slice.call(arguments)));
  }

  /* ---------- enabled mods ---------- */
  function getEnabledMap() {
    try {
      var m = JSON.parse(window.localStorage.getItem(MODS_KEY) || '{}');
      return m && typeof m === 'object' ? m : {};
    } catch (e) {
      return {};
    }
  }

  function isEnabled(name) {
    return getEnabledMap()[name] === true;
  }

  function setEnabled(name, on) {
    var m = getEnabledMap();

    if (on) m[name] = true;
    else delete m[name];

    try {
      window.localStorage.setItem(MODS_KEY, JSON.stringify(m));
    } catch (e) {
      warn('Could not save mod state:', e && e.message);
    }
  }

  function modLabel(fileName) {
    return fileName.replace(/\.js$/i, '');
  }

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
    try {
      GM_setValue(CACHE_KEY, JSON.stringify(c));
    } catch (e) {}
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Somtoday Loader: clear cache', function () {
      GM_deleteValue(CACHE_KEY);
      log('Cache cleared. Reload the page.');
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

            resolve({
              status: r.status,
              text: r.responseText,
              etag: m ? m[1].trim() : null
            });
          } else {
            reject(new Error('HTTP ' + r.status + ' for ' + url));
          }
        },

        onerror: function () {
          reject(new Error('Network error for ' + url));
        },

        ontimeout: function () {
          reject(new Error('Timeout for ' + url));
        }
      });
    });
  }

  /* ---------- folder listing ---------- */
  function getListing(cache) {
    var headers = {
      Accept: 'application/vnd.github+json'
    };

    if (cache.etag && cache.listing) {
      headers['If-None-Match'] = cache.etag;
    }

    return request(LIST_URL, headers).then(function (r) {
      if (r.status === 304 && cache.listing) {
        return cache.listing;
      }

      var items = JSON.parse(r.text);

      if (!Array.isArray(items)) {
        throw new Error('Unexpected API response');
      }

      cache.listing = items
        .filter(function (i) {
          return i.type === 'file' && /\.js$/i.test(i.name);
        })
        .map(function (i) {
          return { name: i.name, sha: i.sha };
        })
        .sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });

      cache.etag = r.etag;
      saveCache(cache);

      return cache.listing;
    }).catch(function (err) {
      if (cache.listing) {
        warn('Could not check for updates; using cached scripts:', err.message);

        toast(
          'Somtoday Loader: update check failed (' +
          err.message +
          '). Using cached scripts.'
        );

        return cache.listing;
      }

      throw err;
    });
  }

  /* ---------- file contents ---------- */
  function getCode(file, cache) {
    var hit = cache.files[file.name];

    if (hit && hit.fmt === CACHE_FMT && hit.sha === file.sha) {
      log(file.name + ': using cached copy (' + hit.code.length + ' chars)');
      return Promise.resolve(hit.code);
    }

    var url = BASE + FOLDER + '/' +
      encodeURIComponent(file.name) +
      '?ref=' + encodeURIComponent(BRANCH);

    return request(url, {
      Accept: 'application/vnd.github.raw+json'
    }).then(function (r) {
      cache.files[file.name] = {
        sha: file.sha,
        fmt: CACHE_FMT,
        code: r.text
      };

      saveCache(cache);
      log(file.name + ': downloaded fresh copy (' + r.text.length + ' chars)');

      return r.text;
    }).catch(function (err) {
      if (hit && typeof hit.code === 'string') {
        warn('Could not refresh ' + file.name + '; using cached copy:', err.message);
        return hit.code;
      }

      throw err;
    });
  }

  /* ---------- toast ---------- */
  function toast(msg) {
    try {
      var t = document.createElement('div');
      t.textContent = String(msg);

      t.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:2147483647;' +
        'background:#b3261e;color:#fff;padding:8px 12px;border-radius:8px;' +
        'font:13px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4)';

      (document.body || document.documentElement).appendChild(t);

      setTimeout(function () {
        t.remove();
      }, 8000);
    } catch (e) {}
  }

  /* ---------- execution ---------- */
  var runCounter = 0;

  function run(name, code) {
    var id = 'sl' + (++runCounter);
    var root = document.documentElement;
    var tail = '\n//# sourceURL=somtoday-scripts/' + name;

    var src =
      'document.documentElement.setAttribute("data-sl-ran", "' + id + '");\n' +
      code + tail;

    function ran() {
      return root.getAttribute('data-sl-ran') === id;
    }

    if (typeof GM_addElement === 'function') {
      try {
        var s1 = GM_addElement('script', { textContent: src });
        if (s1 && s1.remove) s1.remove();

        if (ran()) {
          log('Ran ' + name + ' (GM_addElement)');
          return;
        }
      } catch (e) {
        warn('GM_addElement failed for ' + name + ':', e && e.message);
      }
    }

    try {
      var script = document.createElement('script');
      script.textContent = src;

      (document.head || root).appendChild(script);
      script.remove();

      if (ran()) {
        log('Ran ' + name + ' (inline script)');
        return;
      }
    } catch (e) {
      warn('Inline script failed for ' + name + ':', e && e.message);
    }

    try {
      (new Function(code + tail))();
      log('Ran ' + name + ' (sandbox)');
    } catch (e) {
      console.error('[Somtoday Loader] ' + name + ' could not run:', e);
      toast('Somtoday Loader: ' + name + ' was blocked or crashed. See console.');
    }
  }

  /* ---------- DOM helper ---------- */
  function el(tag, attrs, children) {
    var n = document.createElement(tag);

    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') n.textContent = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
    }

    (children || []).forEach(function (c) {
      if (c) n.appendChild(c);
    });

    return n;
  }

  /* ---------- Somtoday tab helpers ---------- */
  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };

  var getNav = function () {
    return $('sl-account-modal nav');
  };

  var getDetails = function () {
    return $('sl-account-modal-details');
  };

  var getContent = function () {
    return $('sl-account-modal-details > .content');
  };

  var getModTab = function () {
    return $('sl-account-modal-tab[' + MARK + ']');
  };

  var getApiTab = function (id) {
    var tabs = document.querySelectorAll(
      'sl-account-modal-tab[' + API_TAB_MARK + ']'
    );

    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute(API_TAB_MARK) === id) return tabs[i];
    }

    return null;
  };

  function setSelected(tab, selected) {
    if (!tab) return;

    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
  }

  function selectOnlyTab(selectedTab) {
    var nav = getNav();
    if (!nav) return;

    nav.querySelectorAll(TAB).forEach(function (tab) {
      setSelected(tab, tab === selectedTab);
    });
  }

  /* ---------- MOD 2.0 state ---------- */
  var availableMods = null;
  var modOpen = false;
  var originalTitle = null;

  /* ---------- registered API tabs ---------- */
  var apiTabs = Object.create(null);
  var apiTabCounter = 0;
  var activeApiTab = null;

  function apiPanelId(id) {
    return apiTabs[id] ? apiTabs[id].panelId : null;
  }

  function getApiPanel(id) {
    var panelId = apiPanelId(id);
    return panelId ? document.getElementById(panelId) : null;
  }

  function getBaseTabs() {
    var nav = getNav();
    if (!nav) return [];

    return Array.from(nav.querySelectorAll(TAB)).filter(function (tab) {
      return !tab.hasAttribute(MARK) &&
        !tab.hasAttribute(API_TAB_MARK);
    });
  }

  /* ---------- styles ---------- */
  var MOD_CSS = [
    '#' + PANEL_ID + ' { padding: 8px 0; font-family: inherit; color: var(--fg-neutral-strong, #222); }',

    '.sl-mod-intro { padding: 8px 24px 12px; font-size: 13px; line-height: 18px; color: var(--fg-neutral-moderate, #666); }',

    '.sl-mod-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 24px; min-height: 56px; box-sizing: border-box; cursor: pointer; border-bottom: 1px solid var(--border-neutral-weak, #e5e5e5); transition: background .2s ease; }',

    '.sl-mod-row:hover { background: var(--bg-neutral-weakest, rgba(0,0,0,.03)); }',

    '.sl-mod-row:focus-visible { outline: 2px solid #60a5fa; outline-offset: -2px; }',

    '.sl-mod-label { flex: 1 1 auto; min-width: 0; font-size: 15px; line-height: 20px; color: var(--fg-neutral-strong, #222); overflow-wrap: anywhere; }',

    '.sl-mod-switch { display: inline-block; position: relative; flex: 0 0 auto; width: 44px; height: 24px; cursor: pointer; -webkit-tap-highlight-color: transparent; }',

    '.sl-mod-switch-track { position: absolute; inset: 0; box-sizing: border-box; background: #343a46; border: 1px solid #687386; border-radius: 50px; transition: background .25s ease, border-color .25s ease, box-shadow .25s ease; }',

    '.sl-mod-switch[aria-checked="true"] .sl-mod-switch-track { background: linear-gradient(135deg, #60a5fa, #2563eb); border-color: #60a5fa; box-shadow: 0 0 10px rgba(37,99,235,.25); }',

    '.sl-mod-row:hover .sl-mod-switch-track { border-color: #60a5fa; }',

    '.sl-mod-switch-knob { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #aab4c3; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .25s cubic-bezier(.2,.8,.2,1), background-color .25s ease, box-shadow .25s ease; }',

    '.sl-mod-switch[aria-checked="true"] .sl-mod-switch-knob { transform: translateX(20px); background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); }',

    '@media (prefers-reduced-motion: reduce) { .sl-mod-switch-track, .sl-mod-switch-knob, .sl-mod-row { transition: none !important; } }',

    '.sl-mod-note { display: none; padding: 12px 24px 0; font-size: 13px; color: var(--fg-neutral-moderate, #666); }',

    '.sl-mod-note button { margin-left: 12px; cursor: pointer; background: transparent; color: inherit; border: 1px solid rgba(128,128,128,.6); border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 13px; transition: background .2s ease, border-color .2s ease; }',

    '.sl-mod-note button:hover { border-color: #60a5fa; background: rgba(59,130,246,.08); }',

    '.sl-mod-empty { padding: 16px 24px; font-size: 14px; color: var(--fg-neutral-moderate, #666); }'
  ].join('\n');

  function injectModStyles() {
    var s = document.getElementById('somtoday-mod-style');

    if (!s) {
      s = document.createElement('style');
      s.id = 'somtoday-mod-style';
      (document.head || document.documentElement).appendChild(s);
    }

    s.textContent = MOD_CSS;
  }

  /* ---------- public API ---------- */
  function registerTab(options) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('registerTab expects an options object');
    }

    var id = String(options.id || '').trim();
    var label = String(options.label || '').trim();
    var render = options.render;

    if (!id) {
      throw new TypeError('A tab id is required');
    }

    if (!label) {
      throw new TypeError('A tab label is required');
    }

    if (typeof render !== 'function') {
      throw new TypeError('Tab render must be a function');
    }

    var existing = apiTabs[id];

    if (existing) {
      existing.label = label;
      existing.render = render;
    } else {
      apiTabs[id] = {
        id: id,
        label: label,
        render: render,
        panelId: 'somtoday-api-tab-panel-' + (++apiTabCounter)
      };
    }

    injectApiTab(id);

    if (activeApiTab === id) {
      renderApiTab(id);
    }

    return function () {
      unregisterTab(id);
    };
  }

  function unregisterTab(id) {
    id = String(id);

    var definition = apiTabs[id];
    if (!definition) return false;

    if (activeApiTab === id) {
      closeMod();
    }

    var tab = getApiTab(id);
    if (tab) tab.remove();

    var panel = document.getElementById(definition.panelId);
    if (panel) panel.remove();

    delete apiTabs[id];

    return true;
  }

  function getEnabledMods() {
    return Object.keys(getEnabledMap()).filter(function (name) {
      return isEnabled(name);
    });
  }

  function isModEnabled(name) {
    return isEnabled(String(name));
  }

  var publicAPI = {
    registerTab: registerTab,
    unregisterTab: unregisterTab,
    getEnabledMods: getEnabledMods,
    isModEnabled: isModEnabled,
    toast: toast
  };

var apiWindow =
  typeof unsafeWindow !== 'undefined'
    ? unsafeWindow
    : window;

apiWindow.SomtodayMods = publicAPI;
  /* ---------- MOD 2.0 switch ---------- */
  function buildToggle(on) {
    var host = document.createElement('span');
    host.className = 'sl-mod-switch';
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('aria-checked', String(!!on));

    var track = document.createElement('span');
    track.className = 'sl-mod-switch-track';

    var knob = document.createElement('span');
    knob.className = 'sl-mod-switch-knob';

    track.appendChild(knob);
    host.appendChild(track);

    function paint(next) {
      host.setAttribute('aria-checked', String(!!next));
    }

    paint(on);

    return {
      host: host,
      paint: paint
    };
  }

  function buildRow(f, note) {
    var on = isEnabled(f.name);
    var name = modLabel(f.name);
    var sw = buildToggle(on);

    var row = el('div', {
      class: 'sl-mod-row',
      role: 'checkbox',
      tabindex: '0',
      'aria-checked': String(on),
      'aria-label': name
    }, [
      el('span', { class: 'sl-mod-label', text: name }),
      sw.host
    ]);

    function flip() {
      var next = !isEnabled(f.name);

      setEnabled(f.name, next);
      sw.paint(next);
      row.setAttribute('aria-checked', String(next));
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

    panel.appendChild(el('div', {
      class: 'sl-mod-intro',
      text: 'Mods staan standaard uit. Wijzigingen werken na het opnieuw laden van de pagina.'
    }));

    if (availableMods === null) {
      panel.appendChild(el('div', {
        class: 'sl-mod-empty',
        text: 'Mods laden…'
      }));
      return;
    }

    if (!availableMods.length) {
      panel.appendChild(el('div', {
        class: 'sl-mod-empty',
        text: 'Geen mods gevonden in scripts/.'
      }));
      return;
    }

    var reloadBtn = el('button', {
      type: 'button',
      text: 'Nu opnieuw laden'
    });

    reloadBtn.addEventListener('click', function () {
      location.reload();
    });

    var note = el('div', { class: 'sl-mod-note' }, [
      el('span', {
        text: 'Herlaad de pagina om de wijziging toe te passen.'
      }),
      reloadBtn
    ]);

    availableMods.forEach(function (f) {
      panel.appendChild(buildRow(f, note));
    });

    panel.appendChild(note);
  }

  /* ---------- inject MOD 2.0 tab ---------- */
  function injectTab() {
    var nav = getNav();
    if (!nav || getModTab()) return;

    var tabs = getBaseTabs();
    if (!tabs.length) return;

    var template = tabs.find(function (t) {
      return !t.classList.contains('active');
    }) || tabs[0];

    var clone = template.cloneNode(true);

    clone.removeAttribute('id');
    clone.setAttribute(MARK, '1');
    setSelected(clone, false);

    var span = clone.querySelector('span');
    if (span) span.textContent = LABEL;
    else clone.textContent = LABEL;

    tabs[tabs.length - 1].after(clone);
  }

  /* ---------- inject registered API tabs ---------- */
  function injectApiTab(id) {
    var definition = apiTabs[id];
    var nav = getNav();

    if (!definition || !nav) return;

    var existing = getApiTab(id);

    if (existing) {
      var existingSpan = existing.querySelector('span');
      if (existingSpan) existingSpan.textContent = definition.label;
      else existing.textContent = definition.label;
      return;
    }

    var tabs = getBaseTabs();
    if (!tabs.length) return;

    var template = tabs.find(function (t) {
      return !t.classList.contains('active');
    }) || tabs[0];

    var clone = template.cloneNode(true);

    clone.removeAttribute('id');
    clone.setAttribute(API_TAB_MARK, id);
    setSelected(clone, false);

    var span = clone.querySelector('span');
    if (span) span.textContent = definition.label;
    else clone.textContent = definition.label;

    var modTab = getModTab();

    if (modTab && modTab.parentNode === nav) {
      modTab.after(clone);
    } else {
      tabs[tabs.length - 1].after(clone);
    }
  }

  function injectApiTabs() {
    Object.keys(apiTabs).forEach(function (id) {
      injectApiTab(id);
    });
  }

  /* ---------- API tab rendering ---------- */
  function renderApiTab(id) {
    var definition = apiTabs[id];
    if (!definition || activeApiTab !== id) return;

    var content = getContent();
    var details = getDetails();
    if (!content || !details) return;

    var panel = getApiPanel(id);

    if (!panel) {
      panel = el('div', {
        id: definition.panelId,
        class: 'somtoday-api-tab-panel'
      });

      content.after(panel);
    }

    panel.textContent = '';

    try {
      definition.render(panel, publicAPI);
    } catch (e) {
      console.error('[Somtoday Loader] API tab "' + id + '" failed to render:', e);

      panel.textContent = '';
      panel.appendChild(el('div', {
        class: 'sl-mod-empty',
        text: 'Deze tab kon niet worden weergegeven. Zie de console voor details.'
      }));
    }
  }

  /* ---------- open API tab ---------- */
  function openApiTab(id) {
    var definition = apiTabs[id];
    var tab = getApiTab(id);
    var content = getContent();
    var details = getDetails();
    var nav = getNav();

    if (!definition || !tab || !content || !details || !nav) return;

    injectModStyles();

    modOpen = false;
    activeApiTab = id;

    selectOnlyTab(tab);

    var title = details.querySelector('.title');

    if (title) {
      if (originalTitle === null) originalTitle = title.textContent;
      title.textContent = definition.label;
    }

    content.style.display = 'none';

    var modPanel = document.getElementById(PANEL_ID);
    if (modPanel) modPanel.style.display = 'none';

    Object.keys(apiTabs).forEach(function (otherId) {
      var otherPanel = getApiPanel(otherId);
      if (otherPanel) otherPanel.style.display = 'none';
    });

    var panel = getApiPanel(id);

    if (!panel) {
      panel = el('div', {
        id: definition.panelId,
        class: 'somtoday-api-tab-panel'
      });

      content.after(panel);
    }

    panel.style.display = '';
    renderApiTab(id);
  }

  /* ---------- open MOD 2.0 ---------- */
  function openMod() {
    var content = getContent();
    var details = getDetails();
    var nav = getNav();

    if (!content || !details || !nav) return;

    injectModStyles();

    modOpen = true;
    activeApiTab = null;

    var modTab = getModTab();
    selectOnlyTab(modTab);

    var title = details.querySelector('.title');

    if (title) {
      if (originalTitle === null) originalTitle = title.textContent;
      title.textContent = LABEL;
    }

    content.style.display = 'none';

    var apiIds = Object.keys(apiTabs);

    apiIds.forEach(function (id) {
      var panel = getApiPanel(id);
      if (panel) panel.style.display = 'none';
    });

    var panel = document.getElementById(PANEL_ID);

    if (!panel) {
      panel = el('div', { id: PANEL_ID });
      content.after(panel);
    }

    panel.style.display = '';
    renderPanel();
  }

  /* ---------- close custom tabs ---------- */
  function closeMod(newTitle) {
    var wasOpen = modOpen || activeApiTab !== null;

    modOpen = false;
    activeApiTab = null;

    var modTab = getModTab();
    if (modTab) setSelected(modTab, false);

    Object.keys(apiTabs).forEach(function (id) {
      var tab = getApiTab(id);
      if (tab) setSelected(tab, false);

      var panel = getApiPanel(id);
      if (panel) panel.style.display = 'none';
    });

    var modPanel = document.getElementById(PANEL_ID);
    if (modPanel) modPanel.style.display = 'none';

    var content = getContent();
    if (content) content.style.display = '';

    var title = $('sl-account-modal-details .title');

    if (title && originalTitle !== null) {
      title.textContent = newTitle || originalTitle;
    }

    if (wasOpen || originalTitle !== null) {
      originalTitle = null;
    }
  }

  /* ---------- click handling ---------- */
  document.addEventListener('click', function (e) {
    var target = e.target;
    var tab = target && target.closest ? target.closest(TAB) : null;

    if (!tab) return;

    if (tab.hasAttribute(MARK)) {
      openMod();
      return;
    }

    if (tab.hasAttribute(API_TAB_MARK)) {
      openApiTab(tab.getAttribute(API_TAB_MARK));
      return;
    }

    closeMod(
      tab.querySelector('span')?.textContent.trim() ||
      tab.textContent.trim()
    );
  }, true);

  /* ---------- keyboard handling ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;

    var target = e.target;

    if (!target || !target.matches) return;

    if (
      target.matches(TAB + '[' + MARK + ']') ||
      target.matches(TAB + '[' + API_TAB_MARK + ']')
    ) {
      e.preventDefault();
      target.click();
    }
  }, true);

  /* ---------- DOM observer ---------- */
  var scheduled = false;

  function schedule() {
    if (scheduled) return;
    scheduled = true;

    requestAnimationFrame(function () {
      scheduled = false;

      injectTab();
      injectApiTabs();

      if (modOpen && !getModTab()) {
        closeMod();
      }

      if (activeApiTab !== null && !getApiTab(activeApiTab)) {
        closeMod();
      }
    });
  }

  function startObserver() {
    if (!document.body) {
      requestAnimationFrame(startObserver);
      return;
    }

    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true
    });

    injectTab();
    injectApiTabs();
  }

  startObserver();

  /* ---------- main: load only enabled mods ---------- */
  var cache = loadCache();

  getListing(cache).then(function (files) {
    availableMods = files;
    renderPanel();

    if (!files.length) {
      warn('No .js files found in ' + FOLDER + '/');
      return;
    }

    // Remove cached code for files that no longer exist.
    var names = {};

    files.forEach(function (f) {
      names[f.name] = true;
    });

    Object.keys(cache.files).forEach(function (n) {
      if (!names[n]) delete cache.files[n];
    });

    saveCache(cache);

    var enabled = files.filter(function (f) {
      return isEnabled(f.name);
    });

    if (!enabled.length) {
      log('No mods enabled');
      return;
    }

    return Promise.all(enabled.map(function (f) {
      return getCode(f, cache).then(
        function (code) {
          return { name: f.name, code: code };
        },
        function (err) {
          warn('Skipping ' + f.name + ':', err.message);
          return null;
        }
      );
    })).then(function (loaded) {
      loaded.forEach(function (s) {
        if (!s) return;

        try {
          run(s.name, s.code);
        } catch (e) {
          console.error('[Somtoday Loader] ' + s.name + ' failed:', e);
        }
      });

      log(
        'Done, ' + loaded.filter(Boolean).length +
        ' of ' + files.length + ' mod(s) loaded'
      );
    });
  }).catch(function (err) {
    availableMods = availableMods || [];
    renderPanel();

    console.error('[Somtoday Loader] Could not load scripts:', err);
  });
})();
