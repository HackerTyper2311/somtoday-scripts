/*
 * tampermonkey.js - the Somtoday script loader.
 * Put this file in the ROOT of the somtoday-scripts repo (NOT in scripts/,
 * otherwise it would try to load itself). The tiny userscript pulls it in
 * with @require, so the GM_* functions come from that userscript's @grant.
 */
(function () {
  'use strict';

  /* ---------- config ---------- */
  var OWNER = 'HackerTyper2311';
  var REPO = 'somtoday-scripts';
  var BRANCH = 'main';
  var FOLDER = 'scripts';
  var CACHE_KEY = 'somtoday-loader-cache';

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

  /* ---------- network ----------
     GM_xmlhttpRequest ignores the page's CSP/CORS. Resolves with
     { status, text, etag }; 304 (Not Modified) counts as success. */
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

  /* ---------- folder listing ----------
     Checked on EVERY page load with If-None-Match: when nothing changed
     GitHub answers 304, which is instant and does not count against the
     anonymous API rate limit. */
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

  /* ---------- file contents ----------
     Fetched through the API (raw media type), NOT raw.githubusercontent.com,
     so there is no CDN delay. Only downloaded again when the SHA changed. */
  /* Cache entries carry fmt:2. Entries from older loader versions (no fmt)
     could hold OLD code saved under the NEW sha (stale CDN copy), so they
     are never trusted and get downloaded again. */
  var CACHE_FMT = 2;

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

  /* ---------- execution ----------
     Tries, in order:
       1) GM_addElement: Tampermonkey injects the <script> in a way that also
          works when the page has a strict Content-Security-Policy;
       2) a plain inline <script> element (page context);
       3) new Function in the userscript sandbox.
     A marker attribute set by the injected code tells us whether it ran. */
  var runCounter = 0;

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

  /* ---------- main ---------- */
  var cache = loadCache();
  /* drop cache entries of files that no longer exist is handled below */
  getListing(cache).then(function (files) {
    if (!files.length) { warn('no .js files found in ' + FOLDER + '/'); return; }

    /* forget cached code of deleted files */
    var names = {};
    files.forEach(function (f) { names[f.name] = true; });
    Object.keys(cache.files).forEach(function (n) { if (!names[n]) delete cache.files[n]; });

    return Promise.all(files.map(function (f) {
      return getCode(f, cache).then(
        function (code) { return { name: f.name, code: code }; },
        function (err) { warn('skipping ' + f.name + ':', err.message); return null; }
      );
    })).then(function (loaded) {
      /* alphabetical order; one failing script never stops the rest */
      loaded.forEach(function (s) {
        if (!s) return;
        try { run(s.name, s.code); }
        catch (e) { console.error('[Somtoday Loader] ' + s.name + ' failed:', e); }
      });
      log('done, ' + loaded.filter(Boolean).length + ' script(s) loaded');
    });
  }).catch(function (err) {
    console.error('[Somtoday Loader] could not load scripts:', err);
  });
})();
