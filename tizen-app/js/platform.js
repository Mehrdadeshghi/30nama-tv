/* Platform layer: Samsung Tizen (default) or LG webOS.
   On webOS the Back key is 461, the app exits with window.close(), and requests the web engine blocks
   (CORS: a packaged webOS app runs from file://) are retried through the app's own Luna service
   (webos/service/), which fetches them server-side. Everything else behaves exactly as before. ES5 only. */
(function () {
  var N = window.N, ua = navigator.userAgent || '';
  var webos = !!(window.PalmSystem || /Web0S|webOS/i.test(ua));
  N.platform = webos ? 'webos' : (window.tizen ? 'tizen' : 'browser');
  if (webos) {
    N.keys.BACK = 461;            // LG remote: Back
    document.documentElement.classList.add('webos');
  }

  N.exitApp = function () {
    if (N.platform === 'webos') { try { window.close(); } catch (e) {} return; }
    try { tizen.application.getCurrentApplication().exit(); } catch (e) { N.toast('Exit (not on Tizen)'); }
  };

  /* ---------- Luna service bridge (webOS) ---------- */
  var appId = '';
  try { appId = String((window.PalmSystem && PalmSystem.identifier) || '').split(' ')[0]; } catch (e) {}
  var SVC = 'luna://' + (appId || 'com.mehrdad.nama30') + '.service/';
  var live = [];                  // keep bridges referenced until they answer (else they can be garbage-collected)
  function luna(method, params) {
    return new Promise(function (res, rej) {
      var b, done = false;
      try { b = new PalmServiceBridge(); } catch (e) { rej(new Error('no PalmServiceBridge')); return; }
      live.push(b);
      b.onservicecallback = function (msg) {
        if (done) return; done = true;
        var i = live.indexOf(b); if (i >= 0) live.splice(i, 1);
        var r; try { r = JSON.parse(msg); } catch (e) { rej(new Error('service: bad reply')); return; }
        if (r.returnValue === false) { rej(new Error('service: ' + (r.errorText || r.errorCode || 'error'))); return; }
        res(r);
      };
      b.call(SVC + method, JSON.stringify(params || {}));
    });
  }
  N.luna = luna;

  function plainHeaders(h) {
    var out = {};
    if (!h) return out;
    if (typeof h.forEach === 'function' && !(h instanceof Array)) { h.forEach(function (v, k) { out[k] = v; }); return out; }
    for (var k in h) if (h.hasOwnProperty(k)) out[k] = String(h[k]);
    return out;
  }
  function viaService(url, opts) {
    opts = opts || {};
    var body = opts.body === undefined || opts.body === null ? '' : String(opts.body);
    return luna('fetch', { url: url, method: opts.method || 'GET', headers: plainHeaders(opts.headers), body: body })
      .then(function (r) {
        var st = r.status || 0, nobody = st === 204 || st === 205 || st === 304;
        return new Response(nobody ? null : (r.body || ''), {
          status: st >= 200 && st <= 599 ? st : 502, statusText: r.statusText || '', headers: r.headers || {}
        });
      });
  }
  function hostOf(u) { var m = /^https?:\/\/([^\/?#]+)/i.exec(u); return m ? m[1].toLowerCase() : ''; }
  var useSvc = {};                // host -> true once the web engine refused it

  /* ---------- requests: XHR with a real timeout, cancellation and a small per-host queue ----------
     fetch() + a timeout promise (as before) only stopped *waiting*: the connection stayed open. A few slow answers
     filled the browser's ~6 connections per host and every later call queued behind them, so the whole app hung.
     Here a timed-out request is aborted, at most 4 run per host, and background work (opts.prio 2, e.g. TMDB)
     waits behind requests the user is waiting for (prio 0/1). Returns a fetch-like Response: status, ok, text(), json(). */
  var MAX_PER_HOST = 4, active = {}, queue = [];
  function xhrResponse(x) {
    var txt = x.responseText || '';
    return {
      status: x.status, ok: x.status >= 200 && x.status < 300, statusText: x.statusText || '',
      headers: { get: function (k) { try { return x.getResponseHeader(k); } catch (e) { return null; } } },
      text: function () { return Promise.resolve(txt); },
      json: function () { return new Promise(function (res, rej) { try { res(JSON.parse(txt)); } catch (e) { rej(new Error('bad json')); } }); }
    };
  }
  function pump() {
    queue.sort(function (a, b) { return a.prio - b.prio || a.seq - b.seq; });
    for (var i = 0; i < queue.length; i++) {
      var q = queue[i];
      if ((active[q.host] || 0) >= MAX_PER_HOST) continue;
      queue.splice(i, 1); i--;
      active[q.host] = (active[q.host] || 0) + 1;
      q.start();
    }
  }
  var seqN = 0;
  function xhr(url, opts) {
    opts = opts || {};
    var host = hostOf(url) || 'local', ms = opts.timeout || 15000;
    return new Promise(function (res, rej) {
      var job = { host: host, prio: opts.prio === undefined ? 1 : opts.prio, seq: seqN++ };
      job.start = function () {
        var x = new XMLHttpRequest(), done = false, t = null;
        function finish(ok, v) {
          if (done) return; done = true; clearTimeout(t);
          active[host] = Math.max(0, (active[host] || 1) - 1);
          setTimeout(pump, 0);
          if (ok) res(v); else rej(v);
        }
        try {
          x.open(opts.method || 'GET', N.proxied(url), true);
          var h = opts.headers || {};
          for (var k in h) if (h.hasOwnProperty(k)) x.setRequestHeader(k, h[k]);
        } catch (e) { finish(false, e); return; }
        x.onload = function () { finish(true, xhrResponse(x)); };
        x.onerror = function () { finish(false, new TypeError('network error')); };
        x.onabort = function () { finish(false, new Error('aborted')); };
        // own timer instead of xhr.timeout: it also covers time spent waiting in the queue's slot
        t = setTimeout(function () { try { x.abort(); } catch (e) {} finish(false, new Error('timeout')); }, ms);
        if (opts.signal) opts.signal.onabort = function () { try { x.abort(); } catch (e) {} };
        try { x.send(opts.body === undefined ? null : opts.body); } catch (e) { finish(false, e); }
      };
      queue.push(job); pump();
    });
  }
  N.http = xhr;

  /* Drop-in for fetch(N.proxied(url), opts). opts may also carry timeout (ms) and prio (0 urgent .. 2 background). */
  N.fetch = function (url, opts) {
    if (N.platform !== 'webos' || !window.PalmServiceBridge || !/^https?:/i.test(url)) return xhr(url, opts);
    var h = hostOf(url);
    if (useSvc[h]) return viaService(url, opts);
    return xhr(url, opts).catch(function (e) {
      if (/timeout|aborted/.test(String(e && e.message))) throw e;
      // network error = blocked by CORS (or offline). Try once through the service; remember the host if that works.
      return viaService(url, opts).then(function (r) { useSvc[h] = true; return r; }, function () { throw e; });
    });
  };
})();
