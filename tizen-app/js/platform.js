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

  /* Drop-in for fetch(N.proxied(url), opts). */
  N.fetch = function (url, opts) {
    if (N.platform !== 'webos' || !window.PalmServiceBridge || !/^https?:/i.test(url)) return fetch(N.proxied(url), opts);
    var h = hostOf(url);
    if (useSvc[h]) return viaService(url, opts);
    return fetch(url, opts).catch(function (e) {
      // TypeError = blocked by CORS (or offline). Try once through the service; remember the host if that works.
      return viaService(url, opts).then(function (r) { useSvc[h] = true; return r; }, function () { throw e; });
    });
  };
})();
