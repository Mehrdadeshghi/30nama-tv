/* API layer: endpoint discovery, RPC calls, session. */
(function () {
  var C = N.config;
  var api = N.api = { host: null, key: C.apiKeys[0] };
  N.session = N.store.get('session', null); // {token, user}

  function timeout(p, ms, label) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('timeout ' + (label || ''))); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function enc(params) {
    var out = [];
    for (var k in params) if (params.hasOwnProperty(k) && params[k] !== undefined && params[k] !== null)
      out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    return out.join('&');
  }
  api.raw = function (host, key, name, params, token) {
    var headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'c-api-key': key,
      'c-token': token || '',
      'c-version-number': C.apiVersion,
      'c-language': N.lang
    };
    return timeout(N.fetch(host + '/action/' + name, { method: 'POST', headers: headers, body: enc(params || {}) }), 20000, name)
      .then(function (r) { return r.status === 204 ? null : r.text(); })
      .then(function (txt) {
        // observer may answer 204 / an empty body: that is a success, not 'bad json' (only there, so a blank 200 never passes the host probe)
        if (txt === null || (name === 'observer' && !/\S/.test(txt))) return { success: true, status: 204, msg: '', result: null };
        try { return JSON.parse(txt); } catch (e) { throw new Error('bad json from ' + name); }
      });
  };

  // Try a discovery URL (CORS may block it in a browser; fall back to hardcoded hosts).
  function discover() {
    var tries = C.discoveryUrls.map(function (u) {
      return timeout(N.fetch(u + '?t=' + Date.now()).then(function (r) { return r.json(); }), 6000, 'discovery')
        .then(function (list) { if (!list || !list.length) throw new Error('empty'); return list; });
    });
    // first success wins
    return new Promise(function (res) {
      var left = tries.length, done = false;
      tries.forEach(function (p) {
        p.then(function (l) { if (!done) { done = true; res(l); } }, function () { if (--left === 0 && !done) res(C.fallbackHosts); });
      });
    });
  }

  // The WEBTV key is public in the official clients. If 30nama rotates it, read the current one from there.
  function fetchRemoteKey(i) {
    var src = C.keySources[i || 0];
    if (!src) return Promise.reject(new Error('no key source'));
    return timeout(N.fetch(src).then(function (r) { return r.text(); }), 20000, 'key')
      .then(function (txt) { var m = /WEBTV['"]?\s*:\s*['"]([A-Za-z0-9]{24,})['"]/.exec(txt); if (!m) throw new Error('no key'); return m[1]; })
      .catch(function () { return fetchRemoteKey((i || 0) + 1); });
  }

  // Probe `test` on all hosts with a key; resolves with the first host that recognises it.
  // `test` succeeds even for a rotated-out key, but then reports platform "unknown".
  function probe(hosts, key) {
    return new Promise(function (res, rej) {
      var left = hosts.length, done = false;
      hosts.forEach(function (h) {
        timeout(api.raw(h, key, 'test', {}), 8000, 'test').then(function (j) {
          if (done) return;
          if (j && j.success && !(j.result && j.result.platform === 'unknown')) { done = true; res({ host: h, key: key }); }
          else if (--left === 0) rej(new Error('rejected'));
        }, function () { if (--left === 0 && !done) rej(new Error('unreachable')); });
      });
    });
  }

  api.init = function () {
    return discover().then(function (list) {
      var seen = {}, hosts = [];
      list.concat(C.fallbackHosts).forEach(function (h) { if (!seen[h.host]) { seen[h.host] = 1; hosts.push(h.host); } });
      var cached = N.store.get('host', null);
      if (cached && !seen[cached]) hosts.unshift(cached);
      var saved = N.store.get('apiKey', null), keys = saved ? [saved] : [];
      C.apiKeys.forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      function tryKey(ki) {
        if (ki < keys.length) return probe(hosts, keys[ki]).catch(function () { return tryKey(ki + 1); });
        return fetchRemoteKey().then(function (k) {
          if (keys.indexOf(k) >= 0) throw new Error('no endpoint reachable');
          return probe(hosts, k).then(function (r) { N.store.set('apiKey', k); return r; });
        }, function () { throw new Error('no endpoint reachable'); });
      }
      return tryKey(0);
    }).then(function (r) {
      api.host = r.host; api.key = r.key; N.store.set('host', r.host);
      return r;
    });
  };

  // Generic action. Resolves with envelope; rejects on network errors.
  api.call = function (name, params) {
    var token = N.session ? N.session.token : '';
    return api.raw(api.host, api.key, name, params, token).then(function (j) {
      if (j && !j.success) guard(j);
      if (token && j && !j.success && isDenied(j)) checkSession(token, name);
      return j;
    });
  };
  // rate limit / captcha / maintenance: say so once (never retry-storm); callers see a normal failure envelope
  var guardT = 0;
  function guard(j) {
    var m = String(j.msg || ''), k = /REQUESTBLOCK|REQUESTCAPTCHA/.test(m) ? 'errBlock' : /APIMAINTENANCE/.test(m) ? 'errMaint' : '';
    if (!k || Date.now() - guardT < 30000) return;
    guardT = Date.now(); if (N.toast) N.toast(N.t(k), 6000);
  }
  // A dead token gets {status:403, msg:'Access Denied'}; 'Login Required' only comes back with no token at all.
  // 403 could also be a per-item refusal, so confirm with `user` before treating the session as expired.
  function isDenied(j) { return Number(j.status) === 403 || /access denied|login required/i.test(j.msg || ''); }
  var checking = null;
  function checkSession(token, name) {
    if (checking || !N.session || N.session.token !== token) return;
    var confirm = name === 'user' ? Promise.resolve(true)
      : api.raw(api.host, api.key, 'user', {}, token).then(function (u) { return !u || (!u.success && isDenied(u)); }, function () { return false; });
    checking = confirm.then(function (dead) {
      checking = null;
      if (!dead || !N.session || N.session.token !== token) return;
      // drop it locally (the token is dead, so no logout call) and send the user to sign in
      N.session = null; N.store.del('session');
      if (N.onSessionExpired) N.onSessionExpired();
    });
  }
  // Resolves with result or rejects with Error(msg)
  api.get = function (name, params) {
    return api.call(name, params).then(function (j) {
      if (!j || !j.success) { var e = new Error((j && j.msg) || 'error'); e.msg = j && j.msg; throw e; }
      return j.result;
    });
  };

  N.isLoggedIn = function () { return !!(N.session && N.session.token); };
  N.setSession = function (user) {
    N.session = { token: user.user_session, user: user };
    N.store.set('session', N.session);
    if (N.onSessionChange) N.onSessionChange();
  };
  N.logout = function (silent) {
    var p = N.isLoggedIn() ? api.call('logout', {}).catch(function () {}) : Promise.resolve();
    N.session = null; N.store.del('session');
    if (N.onSessionChange) N.onSessionChange();
    if (!silent && N.onLogout) N.onLogout();
    return p;
  };

  // helpers over post objects
  N.img = function (p, size) {
    var po = p && p.image && p.image.poster;
    if (!po) return '';
    return (po.jpg && (po.jpg[size || 'medium'] || po.jpg.large)) || (po.webp && po.webp.medium) || '';
  };
  N.cover = function (p) { var c = p && p.image && p.image.cover; return c ? (c.jpg || c.webp || '') : ''; };
  // English title without the year suffix the API appends ('Link Click 2021' -> 'Link Click').
  N.titleEn = function (p) {
    var t = (p && p.title) || {}, e = String(t.english || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''), y = +(p && p.info && p.info.year) || 0;
    var m = /^(.*\S)\s+((?:19|20)\d\d)$/.exec(e);
    if (m && (!y || Math.abs(+m[2] - y) <= 1)) e = m[1];
    return e || String(t.local || '');
  };
  // Persian local title, only when it really is Persian (title.local is sometimes English or null).
  N.titleFa = function (p) {
    var l = (p && p.title && p.title.local) || '';
    return N.FA.test(l) ? String(l).replace(/^\s+|\s+$/g, '') : '';
  };
  // titles are always English (the owner searches by them); the Persian title is the secondary line in the fa UI
  N.title = function (p) { return N.titleEn(p); };
  N.titleAlt = function (p) { var fa = N.lang === 'fa' ? N.titleFa(p) : ''; return fa && fa !== N.titleEn(p) ? fa : ''; };
  // the API plot carries raw HTML entities (&quot; &amp; &#39; ...): decode once, before textContent
  var ENT = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0', laquo: '\u00ab', raquo: '\u00bb', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014', zwnj: '\u200c' };
  N.unent = function (t) {
    return String(t || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e.charAt(0) === '#') { var n = e.charAt(1) === 'x' || e.charAt(1) === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1); return n > 0 && n < 65536 ? String.fromCharCode(n) : m; }
      var v = ENT[e.toLowerCase()]; return v === undefined ? m : v;
    });
  };
  N.plot = function (p) {
    var t = (p && p.plot) || {}, s;
    if (N.lang === 'fa') s = (t.local && N.FA.test(t.local)) ? t.local : ((p && p._faPlot) || t.english || t.local || '');
    else s = t.english || t.local || '';
    return N.unent(s);
  };
  N.extractPosts = function (r) {
    if (!r) return [];
    var a = r.posts || r.items || r.list || (r instanceof Array ? r : []);
    return a.map(function (x) { return x && x.post ? x.post : x; }).filter(function (x) { return x && x.id; });
  };

  // continue-watching `data` by post id (filled by Home; Details reads it for the resume line)
  N.cwData = {};
  // My lists (watchlist/favorite/notify): id maps for has(), original arrays (add order) for the empty-page fallback. 60s cache; toggle reloads from the server.
  var L = N.lists = { ids: null, arr: null, t: 0, p: null };
  L.load = function (force) {
    if (!N.isLoggedIn()) return Promise.resolve(L);
    if (!force && L.p && Date.now() - L.t < 60000) return L.p;
    L.t = Date.now();
    L.p = N.api.get('user_mylist').then(function (r) {
      L.arr = {}; L.ids = {};
      ['watchlist', 'favorite', 'notify'].forEach(function (g) {
        var a = ((r && r[g] && r[g].post) || []).map(String); L.arr[g] = a; L.ids[g] = {};
        a.forEach(function (id) { L.ids[g][id] = 1; });
      });
      return L;
    }).catch(function (e) { L.p = null; throw e; });
    return L.p;
  };
  L.has = function (g, id) { return !!(L.ids && L.ids[g] && L.ids[g][String(id)]); };
  // user_list 'add' is a server-side toggle: reload afterwards and resolve with the real state
  L.toggle = function (g, id) {
    var pre = (!L.p || Date.now() - L.t > 10000) ? L.load(true) : L.p;
    return pre.then(function () { return N.api.call('user_list', { action: 'add', group: g, post_id: id }); })
      .then(function (j) { if (!j || !j.success) throw new Error((j && j.msg) || 'error'); return L.load(true); })
      .then(function () { return L.has(g, id); });
  };
  L.reset = function () { L.ids = L.arr = L.p = null; L.t = 0; };
  L.listPosts = function (g, page) {
    page = page || 1;
    return N.api.get('user_list', { action: 'list', group: g, page: page, orderby: 'add_list', order: 'DESC' }).then(function (r) {
      var ps = N.extractPosts(r);
      if (ps.length || page > 1) return { posts: ps, total: r && r.total || ps.length, pages: r && r.pages || 1 };
      return L.load().then(function () {
        var ids = ((L.arr && L.arr[g]) || []).slice(0, 30);
        return Promise.all(ids.map(function (id) { return N.api.get('single', { post_id: id }).catch(function () { return null; }); })).then(function (a) {
          var out = a.filter(Boolean); return { posts: out, total: out.length, pages: 1 };
        });
      });
    });
  };
})();
