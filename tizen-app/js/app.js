/* Boot, router, rail, modals, splash, back handling. */
(function () {
  var stack = [], current = null, rootEl = null, swapT = null, $ = N.$, el = N.el;
  var content = null;
  // [key, icon, go, y (panel-relative)]; 'watchlist' only when logged in
  var RAIL = [
    ['search', 'search', function () { N.go('search', {}, { reset: true }); }, 240],
    ['home', 'home', function () { N.go('home', {}, { reset: true }); }, 320],
    ['progress', 'progress', function () { N.go('progress', {}, { reset: true }); }, 400], // In progress (screens/progress.js)
    ['movies', 'movies', function () { N.go('archive', { slug: 'movies', nameKey: 'movies' }, { reset: true }); }, 480],
    ['series', 'series', function () { N.go('archive', { slug: 'series', nameKey: 'series' }, { reset: true }); }, 560],
    ['anime', 'anime', function () { N.go('archive', { slug: 'anime', nameKey: 'anime' }, { reset: true }); }, 640],
    ['archive', 'archive', function () { N.go('archive', {}, { reset: true }); }, 720],
    ['watchlist', 'list', function () { N.go('archive', { list: 'watchlist', nameKey: 'watchlist' }, { reset: true }); }, 800],
    ['settings', 'settings', function () { N.go('settings', {}, { reset: true }); }, 912]
  ];
  var PROF = ['prof', '', function () { N.go('settings', { section: 'account' }, { reset: true }); }, 120];

  /* ---------------- home cache ---------------- */
  var hc = { t: 0, p: null };
  N.getHome = function () {
    if (hc.p && Date.now() - hc.t < 90000) return hc.p;
    hc.t = Date.now();
    hc.p = N.api.get('home_stream').catch(function (e) { hc.p = null; throw e; });
    return hc.p;
  };
  N.dropHome = function () { hc.p = null; };

  /* ---------------- splash ---------------- */
  var splash = { t0: Date.now(), done: false, dotsT: null, failT: null };
  function splashExit() {
    if (splash.done) return; splash.done = true; clearTimeout(splash.dotsT); clearTimeout(splash.failT);
    var s = $('splash'); s.classList.add('out');
    setTimeout(function () { s.style.display = 'none'; }, 350);
  }
  N.splashReady = function () {
    if (splash.done) return;
    var wait = Math.max(0, 1200 - (Date.now() - splash.t0));
    setTimeout(splashExit, wait);
  };

  /* ---------------- rail ---------------- */
  var rail = N.rail = { items: [], open: false, mem: null, pill: null, root: null };
  function profRow(b) {
    var u = (N.isLoggedIn() && N.session && N.session.user) || null, av = el('div', 'av'), nm = el('div', 'nm'), cp = el('div', 'cp');
    var name = u ? String(u.user_name || '') : N.t('guestName');
    function initials() { av.innerHTML = ''; av.appendChild(N.ui.txt(el('span'), (name.charAt(0) || '?').toUpperCase())); }
    if (u && u.user_avatar) {
      var im = el('img'); im.alt = ''; im.onerror = function () { im.onerror = null; initials(); }; im.src = u.user_avatar; av.appendChild(im);
    } else initials();
    // dir=ltr/.latin go on inner spans: logical insets on .av/.nm resolve against the element's own dir
    nm.appendChild(N.ui.txt(el('span'), name));
    if (u) { var ok = el('i', 'ok'); ok.appendChild(N.ui.icon('check')); b.appendChild(ok); } // signed-in badge
    if (u) {
      var ut = u.user_type ? N.t('ut_' + u.user_type) : '', days = u.user_expire && u.user_expire.days;
      if (ut === 'ut_' + u.user_type) ut = String(u.user_type);
      N.ui.dots(cp, [ut, days !== undefined && days !== null && days !== '' ? N.tf('daysN', { n: N.fmt.num(+days) }) : '']);
    } else cp.textContent = N.t('signInShort');
    b.appendChild(av); b.appendChild(nm); b.appendChild(cp);
  }
  rail.build = function () {
    var r = rail.root = $('rail'); r.innerHTML = ''; rail.items = [];
    r.appendChild(el('div', 'rail-scrim'));
    var panel = el('div', 'rail-panel'); r.appendChild(panel);
    var logo = el('img', 'rail-logo'); logo.alt = ''; logo.src = 'img/logo.png'; panel.appendChild(logo);
    rail.pill = el('div', 'rail-pill'); panel.appendChild(rail.pill); // below the items in z-order
    panel.appendChild(el('div', 'rail-sep'));
    var list = [PROF].concat(RAIL.filter(function (m) { return m[0] !== 'watchlist' || N.isLoggedIn(); }));
    list.forEach(function (m, i) {
      var b = el('button', 'ri ' + m[0]); b._key = m[0]; b._y = m[3]; b.style.top = b._y + 'px';
      if (m[0] === 'prof') profRow(b);
      else { b.appendChild(N.ui.icon(m[1])); b.appendChild(el('span', 'lb', N.t(m[0]))); }
      b.onenter = function () { rail.go(m); };
      b.onclick = function () { rail.go(m); };
      b.onfocus2 = function () { rail.root.classList.remove('blur'); rail.pill.classList.toggle('tall', m[0] === 'prof'); rail.pill.style.transform = 'translateY(' + b._y + 'px)'; };
      b.onnav = function (dir) {
        if (dir === 'up') return rail.items[i - 1] || true;
        if (dir === 'down') return rail.items[i + 1] || true;
        if (N.ui.step(dir) > 0) { rail.close(true); return true; } // towards content
        return true;
      };
      panel.appendChild(b); rail.items.push(b);
    });
    rail.mark();
  };
  rail.curKey = function () {
    var i = stack.length - 1, e = stack[i];
    while (e && e.name === 'details' && i > 0) { i--; e = stack[i]; }
    if (!e) return '';
    if (e.name === 'archive' && e.params && (e.params.slug === 'movies' || e.params.slug === 'series' || e.params.slug === 'anime')) return e.params.slug;
    if (e.name === 'archive' && e.params && e.params.list) return 'watchlist';
    if (e.name === 'settings' && e.params && e.params.section === 'account') return 'prof';
    return e.name;
  };
  rail.mark = function () {
    var k = rail.curKey();
    rail.items.forEach(function (b) { b.classList.toggle('cur', b._key === k); });
  };
  rail.visible = function () { return !!rail.root && !rail.root.classList.contains('gone'); };
  rail.enter = function () {
    if (!rail.visible() || rail.open) return;
    if (N.nav.cur && !rail.isRail(N.nav.cur)) rail.mem = N.nav.cur;
    rail.open = true; rail.root.classList.add('open');
    var k = rail.curKey(), t = null, h = null;
    rail.items.forEach(function (b) { if (b._key === k) t = b; if (b._key === 'home') h = b; });
    t = t || h || rail.items[0];
    rail.pill.style.transition = 'none'; rail.pill.style.transform = 'translateY(' + t._y + 'px)';
    void rail.pill.offsetWidth; rail.pill.style.transition = '';
    N.nav.focus(t, true); t.onfocus2();
  };
  rail.isRail = function (e) { return !!e && e.classList && e.classList.contains('ri'); };
  // hide the focus pill while focus sits outside the rail (e.g. a modal over the open panel)
  rail.sync = function () { if (rail.root) rail.root.classList.toggle('blur', !rail.isRail(N.nav.cur)); };
  rail.close = function (restore) {
    if (!rail.open) return;
    rail.open = false; rail.root.classList.remove('open');
    var m = rail.mem; rail.mem = null;
    if (restore) {
      if (m && m.offsetWidth > 0 && rootEl && rootEl.contains(m)) N.nav.focus(m, true);
      else N.nav.focusFirst(rootEl || content);
    }
  };
  rail.go = function (m) {
    var same = rail.curKey() === m[0];
    rail.close(false);
    if (same && current && stack.length === 1) { rail.mem = null; if (N.nav.cur && rail.isRail(N.nav.cur)) N.nav.clear(); N.nav.focusFirst(rootEl); return; }
    m[2]();
  };
  // start-edge press with nothing to the start side opens the rail
  N.nav.onEdge = function (dir) {
    if (rail.open || !rail.visible() || (dir !== 'left' && dir !== 'right')) return;
    if (N.ui.step(dir) < 0) rail.enter();
  };

  /* ---------------- modal (confirm sheet) ---------------- */
  var modal = null;
  N.confirm = function (o) {
    if (modal) return;
    var m = el('div', 'modal'), box = el('div', 'box');
    box.appendChild(el('div', 'mt', o.title)); box.appendChild(el('div', 'mb', o.body || ''));
    var row = el('div', 'acts'), cancel = N.ui.btn(o.cancel || N.t('cancel'), function () { N.closeModal(); }, '');
    var ok = N.ui.btn(o.ok, function () { N.closeModal(); o.onOk(); }, o.danger ? 'danger' : 'primary');
    row.appendChild(cancel); row.appendChild(ok); box.appendChild(row); m.appendChild(box); document.body.appendChild(m);
    modal = { el: m, prev: N.nav.cur };
    N.nav.pushScope(m); void m.offsetWidth; m.classList.add('show'); N.nav.focus(cancel, true); rail.sync();
  };
  // context menu: {title, items:[{label, icon, fn}]}; shares `modal`, so Back closes it
  N.menu = function (o) {
    if (modal) return;
    var m = el('div', 'modal cmenu'), box = el('div', 'box'), t = el('div', 'mt'), list = el('div', 'mlist'), first = null;
    N.ui.txt(t, o.title); box.appendChild(t);
    (o.items || []).forEach(function (it) {
      var b = N.ui.btn(it.label, function () { N.closeModal(); it.fn(); }, 'wide', it.icon);
      list.appendChild(b); if (!first) first = b;
    });
    box.appendChild(list); m.appendChild(box); document.body.appendChild(m);
    modal = { el: m, prev: N.nav.cur };
    N.nav.pushScope(m); void m.offsetWidth; m.classList.add('show'); if (first) N.nav.focus(first, true); rail.sync();
  };
  N.closeModal = function () {
    if (!modal) return; var m = modal; modal = null;
    N.nav.popScope(); m.el.classList.remove('show');
    setTimeout(function () { if (m.el.parentNode) m.el.parentNode.removeChild(m.el); }, 260);
    if (m.prev && m.prev.offsetWidth > 0) N.nav.focus(m.prev, true); else N.nav.clear(); rail.sync();
  };
  function exitApp() { N.exitApp(); }
  N.confirmExit = function () {
    N.confirm({ title: N.t('exitTitle'), body: N.t('exitBody'), ok: N.t('exit'), danger: false, onOk: exitApp });
  };

  /* ---------------- router ---------------- */
  function setChrome(name) {
    rail.root.classList.toggle('gone', name === 'login');
    N.stage.dim(0); N.stage.details(false); N.stage.neutral(false); N.stage.offset(0);
  }
  function build(entry) {
    var oldCur = current, old = rootEl;
    if (oldCur && oldCur.destroy) { try { oldCur.destroy(); } catch (e) {} }
    if (old && old.parentNode) old.parentNode.removeChild(old);
    N.nav.clear(); N.nav.locked = false;
    var r = el('div', 'screen enter ' + entry.name); content.appendChild(r); rootEl = r;
    setChrome(entry.name);
    rail.mark();
    current = N.screens[entry.name](r, entry.params || {}, entry.focus) || {};
  }
  function render(entry) {
    clearTimeout(swapT);
    if (rail.open) { rail.open = false; rail.root.classList.remove('open'); rail.mem = null; }
    if (rootEl && current) {
      rootEl.classList.add('leave'); N.nav.clear(); N.nav.locked = true;
      swapT = setTimeout(function () { build(entry); }, 150);
    } else build(entry);
  }
  // opts: reset (clear history), replace (swap top entry)
  N.go = function (name, params, opts) {
    opts = opts || {};
    var entry = { name: name, params: params || {} };
    if (opts.reset) stack = [entry];
    else if (opts.replace && stack.length) stack[stack.length - 1] = entry;
    else {
      if (stack.length && current && current.focusState) stack[stack.length - 1].focus = current.focusState();
      stack.push(entry);
    }
    render(entry);
  };
  N.onBack = function () {
    if (N.player.open) { N.player.close(); return; }
    if (modal) { N.closeModal(); return; }
    if (rail.open) { N.confirmExit(); return; }
    if (current && current.back && current.back()) return;
    if (stack.length > 1) { stack.pop(); render(stack[stack.length - 1]); return; }
    if (rail.visible()) { rail.enter(); return; }
    N.confirmExit();
  };
  N.onSessionChange = function () { if (rail.root) { rail.close(false); rail.build(); } }; // profile row + watchlist item follow the session
  function resetLists() { if (N.lists && N.lists.reset) N.lists.reset(); }
  N.onLogout = function () { N.dropHome(); resetLists(); N.go('login', {}, { reset: true }); };
  N.onSessionExpired = function () {
    if (!current) return; // during boot: boot() routes to login itself
    if (N.player.open) N.player.close();
    N.closeModal();
    N.toast(N.t('sessionExpired'), 5000);
    resetLists();
    N.onLogout();
  };
  N.onPlayerClosed = function () {
    N.stage.restore();
    if (current && current.onPlayerClosed) current.onPlayerClosed();
    else if (N.nav.cur === null && rootEl) N.nav.focusFirst(rootEl);
  };
  N.rerender = function () { // re-render the current screen (language change etc.)
    var e = stack[stack.length - 1]; if (e) { if (current && current.focusState) e.focus = current.focusState(); build(e); }
  };

  function bootError(e) {
    N.splashReady(); if (rail.root) rail.root.classList.add('gone'); rootEl && (rootEl.innerHTML = ''); // no rail yet when api.init fails
    var r = el('div', 'screen enter'); content.innerHTML = ''; content.appendChild(r); rootEl = r; current = null;
    var w = el('div', 'center-msg'); w.appendChild(N.ui.icon('warn'));
    w.appendChild(el('div', 'm', N.t('error')));
    if (e && e.message) w.appendChild(N.ui.txt(el('div', 'md'), e.message)); // raw detail: small, isolated Latin line
    var b = N.ui.btn(N.t('retry'), boot, ''); w.appendChild(b); r.appendChild(w); N.nav.focus(b, true);
  }
  function boot() {
    N.api.init().then(function () {
      rail.build();
      var p = Promise.resolve();
      if (N.isLoggedIn()) {
        p = N.api.call('user', {}).then(function (j) {
          if (j && j.success && j.result) {
            var u = j.result.user_session ? j.result : (j.result.user || null);
            if (u && u.user_session) N.setSession(u); else { N.session.user = Object.assign({}, N.session.user, j.result); N.store.set('session', N.session); }
          }
        }).catch(function () {});
      }
      return p;
    }).then(function () {
      N.go(N.isLoggedIn() ? 'home' : 'login', {}, { reset: true }); // login is mandatory (single-owner app)
    }).catch(bootError);
  }

  // Scale the 1920x1080 stage on smaller windows (desktop testing). No-op on a 1080p TV.
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080), r = document.documentElement;
    if (Math.abs(s - 1) < 0.01) { r.style.transform = ''; return; }
    r.style.transform = 'scale(' + s + ')'; r.style.transformOrigin = '0 0';
  }
  window.addEventListener('resize', fit);

  document.addEventListener('DOMContentLoaded', function () {
    content = $('content');
    if (N.store.get('calm', false)) document.body.classList.add('calm');
    fit();
    N.nav.registerKeys();
    N.nav.pushHandler(function (e) { // colour-key shortcuts: Red = Search, Green = Home; a focused element with onred consumes Red first
      var k = e.keyCode, c = N.nav.cur;
      if (k === N.keys.RED && c && c.onred && !modal && !N.player.open && !rail.open) { c.onred(); return true; }
      if ((k !== N.keys.RED && k !== N.keys.GREEN) || modal || !rail.visible()) return false;
      N.go(k === N.keys.RED ? 'search' : 'home', {}, { reset: true });
      return true;
    });
    // long-press OK: any focusable with c._lp gets press-and-hold (600ms); the click happens on keyup only if the hold did not fire
    var lp = null;
    function lpCancel() { if (lp) { clearTimeout(lp.t); clearInterval(lp.w); lp = null; } }
    function pressFx(c) { if (!c) return; c.classList.add('press'); setTimeout(function () { c.classList.remove('press'); }, 140); }
    function lpKey(e) {
      var K = N.keys;
      if (e.keyCode === K.ENTER && lp) { lp.last = Date.now(); return true; } // swallow every ENTER keydown until keyup
      if (lp) { lpCancel(); return false; } // any other key cancels; no click
      if (e.keyCode !== K.ENTER || e.repeat) return false;
      var c = N.nav.cur; pressFx(c);
      if (!c || !c._lp || N.player.open || N.rail.open || document.querySelector('.modal')) return false;
      lp = { c: c, fired: false, last: Date.now() };
      lp.t = setTimeout(function () { if (!lp) return; lp.fired = true; c._lp(); }, 600);
      lp.w = setInterval(function () { if (lp && lp.fired && Date.now() - lp.last > 1500) lpCancel(); }, 500); // lost-keyup safety, only after repeats stop
      return true;
    }
    N.nav.pushHandler(lpKey);
    document.addEventListener('keyup', function (e) {
      if (e.keyCode !== N.keys.ENTER || !lp) return;
      var l = lp; lpCancel();
      if (!l.fired && N.nav.cur === l.c) { if (l.c.onenter) l.c.onenter(); else l.c.click(); }
    });
    splash.dotsT = setTimeout(function () { var d = document.querySelector('#splash .dots3'); if (d) d.classList.add('on'); }, 1800);
    splash.failT = setTimeout(splashExit, 10000);
    boot();
  });
})();
