/* Settings screen: tvOS lists. Centred title, artwork column at inline-start, grouped rows at inline-end; list rows push a check-list. */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui;

  /* ================= Settings ================= */
  var UT_DOT = { golden: '#F7AB1B', blue: '#4A71B7', red: '#D34040', free: '#fff', staff: '#6DBE45', admin: '#68CCE3', robot: '#6FC281' };
  function fmtExpire(v) {
    if (v === undefined || v === null || v === '') return N.t('unknown');
    if (typeof v === 'object') return v.j || v.g ? (N.lang === 'fa' && v.j ? N.fmt.jdate(v.j) : (v.g ? N.fmt.gdate(v.g) : N.fmt.jdate(v.j))) : N.t('unknown');
    if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) { var n = Number(v); if (n < 1e11) n *= 1000; return new Date(n).toISOString().slice(0, 10); }
    return String(v);
  }
  N.addStrings({
    en: { diagShow: 'Error log', diagNone: 'No errors recorded since the app started.', resumeClear: 'Clear saved positions on this TV',
      resumeClearB: 'Continue watching then only uses what 30nama knows.', resumeClearOk: 'Clear' },
    fa: { diagShow: 'گزارش خطاها', diagNone: 'از شروع برنامه خطایی ثبت نشده است.', resumeClear: 'پاک کردن موقعیت‌های ذخیره‌شده روی این تلویزیون',
      resumeClearB: 'بعد از آن «ادامه تماشا» فقط از اطلاعات سی‌نما استفاده می‌کند.', resumeClearOk: 'پاک کردن' }
  });
  S.settings = function (root, params, restore) {
    var rows = [], stack = [], page = null, SS = N.subStyle, pv = null, PV_K = 0.5;
    root.classList.add('set'); N.stage.neutral(true);
    root.appendChild(el('div', 'st-t', N.t('settings')));
    var art = el('div', 'st-art'), mark = el('img', 'mk'); mark.alt = ''; mark.src = 'img/logo-mark.png';
    art.appendChild(mark); art.appendChild(el('div', 'an', N.t('aboutName')));
    art.appendChild(el('div', 'ver', N.t('version') + ' ' + N.config.appVersion)); art.appendChild(el('div', 'un', N.t('unofficial')));
    root.appendChild(art);
    // subtitle appearance preview: replaces the artwork while the appearance pages are open (sample fa + en line over a dark scene)
    function preview(over) {
      if (!pv) {
        pv = el('div', 'st-pv'); var cs = el('div', 'pv-cues');
        [['fa', 'rtl'], ['en', 'ltr']].forEach(function (l) {
          var ln = el('div', 'subs' + (l[0] === 'fa' ? ' sub-fa' : '')); ln.dir = l[1]; ln.appendChild(el('span', 'cue', SS.sample[l[0]])); cs.appendChild(ln);
        });
        pv.appendChild(cs); pv._cs = cs; art.appendChild(pv);
      }
      var o = SS.values(over), cs = pv._cs;
      for (var i = 0; i < cs.children.length; i++) SS.apply(o, cs.children[i]);
      // .pv-cues is a 1620px-wide player-proportioned canvas at scale(.5) (bottom-left origin): the player's px sizes/gutters apply as-is,
      // the position maps 1080 -> 456 frame px, clamped so xl + high + a box still fits under the frame top
      cs.style.bottom = Math.max(0, Math.min(Math.round(SS.opt('subPos', o.subPos).px * 456 / 1080), 456 - 20 - Math.ceil(cs.offsetHeight * PV_K))) + 'px';
      art.classList.add('pv');
    }
    function noPreview() { art.classList.remove('pv'); }
    var wrap = el('div', 'slist-w'), slist = el('div', 'slist'); wrap.appendChild(slist); root.appendChild(wrap);

    // ---- row kinds ----
    function row(label, cls) {
      var r = el('div', 'orow f fl' + (cls ? ' ' + cls : '')), v = el('span', 'v');
      r.appendChild(el('span', 'lb', label)); r.appendChild(v); r._v = v;
      r.onfocus2 = function () {
        // anchor-scroll, but never past the list end: a short page (option lists) stays put and keeps its header out of the top fade
        var ty = ui.vscroll(slist, r, 300), lo = Math.min(0, wrap.clientHeight - slist.offsetHeight);
        if (ty < lo) { ty = lo; slist._ty = ty; slist.style.transform = ty ? 'translateY(' + ty + 'px)' : ''; }
        wrap.classList.toggle('scr', ty < 0);
      };
      slist.appendChild(r); rows.push(r); return r;
    }
    function val(r, s) { r._v.innerHTML = ''; if (s && s.nodeType) r._v.appendChild(s); else ui.txt(r._v, s); }
    function group(label) { slist.appendChild(el('div', 'sg', label)); }
    function info(label, value) { var r = row(label, 'info'); val(r, value); return r; }
    function toggle(label, get, set) {
      var r = row(label, 'tg');
      function paint() { val(r, N.t(get() ? 'on' : 'off')); }
      paint(); r.onclick = function () { set(!get()); paint(); };
      return r;
    }
    function labelOf(options, v) { for (var i = 0; i < options.length; i++) if (options[i].v === v) return options[i].label; return options[0].label; }
    function list(label, options, get, set, prev) {
      var r = row(label, 'ls');
      val(r, labelOf(options, get())); r.appendChild(ui.icon('chev', 'mirror chev'));
      r.onclick = function () { open(r, function () { return listPage(label, options, get, set, prev); }); };
      return r;
    }
    function link(label, render) { var r = row(label, 'ls'); r.appendChild(ui.icon('chev', 'mirror chev')); r.onclick = function () { open(r, render); }; return r; }
    function action(label, fn, danger) { var r = row(label, 'act' + (danger ? ' danger' : '')); r.onclick = fn; return r; }

    // ---- root list ----
    function renderRoot() {
      noPreview();
      var u = N.isLoggedIn() && N.session && N.session.user;
      group(N.t('account'));
      if (u) {
        info(N.t('userName'), u.user_name || u.user_email || N.t('userFallback'));
        var ty = u.user_type, ut = ty ? N.t('ut_' + ty) : '', tv = el('span', 'ut');
        if (ty) {
          var dot = el('i', 'udot'); dot.style.background = UT_DOT[ty] || 'var(--label-3)'; tv.appendChild(dot);
          if (ut === 'ut_' + ty) tv.appendChild(ui.txt(el('span'), String(ty))); else tv.appendChild(el('span', '', ut));
        } else tv.textContent = '-';
        info(N.t('userType'), tv);
        info(N.t('expires'), fmtExpire(u.user_expire));
        var days = u.user_expire && u.user_expire.days;
        if (typeof days === 'number') info(N.t('remaining'), N.tf('daysN', { n: N.fmt.num(days) }));
        action(N.t('logout'), function () {
          N.confirm({ title: N.t('logoutTitle'), body: N.t('logoutBody'), ok: N.t('logout'), danger: true, onOk: function () { N.logout(); } });
        }, true);
      } else {
        info(N.t('account'), N.t('guestName'));
        action(N.t('login'), function () { N.go('login', {}, { reset: true }); });
      }
      group(N.t('playback'));
      list(N.t('defSubs'), [{ v: 'off', label: N.t('subOff') }, { v: 'fa', label: N.t('persian') }, { v: 'en', label: N.t('english') }],
        function () { return N.store.get('sub', 'off'); }, function (v) { N.store.set('sub', v); });
      link(N.t('subLook'), lookPage);
      toggle(N.t('autoplay'), function () { return N.store.get('autoplay', true); }, function (v) { N.store.set('autoplay', v); });
      list(N.t('defQuality'), [{ v: 'max', label: N.t('qMax') }, { v: 'auto', label: N.t('qAuto') }],
        function () { return N.store.get('quality', 'max'); }, function (v) { N.store.set('quality', v); });
      list(N.t('audioCh'), [{ v: 'default', label: N.t('chAuto') }, { v: '6ch', label: N.t('ch6') }, { v: '2ch', label: N.t('ch2') }],
        function () { return N.store.get('audioCh', 'default'); }, function (v) { N.store.set('audioCh', v); });
      if (N.live) {
        group(N.t('live'));
        list(N.t('liveStart'), [{ v: 'home', label: N.t('liveStartHome') }, { v: 'live', label: N.t('liveStartLive') }, { v: 'last', label: N.t('liveStartLast') }],
          function () { return N.store.get('startScreen', 'home'); }, function (v) { N.store.set('startScreen', v); });
        toggle(N.t('liveHomeRow'), function () { return N.store.get('liveHome', true); }, function (v) { N.store.set('liveHome', v); });
        action(N.t('liveRefresh'), function () { N.live.load(true).then(function () { N.toast(N.t('liveRefreshed')); }, function (e) { N.toast(N.t('error')); }); });
      }
      group(N.t('display'));
      list(N.t('language'), [{ v: 'fa', label: 'فارسی' }, { v: 'en', label: 'English' }], function () { return N.lang; }, function (v) {
        if (v === N.lang) return;
        N.store.set('lang', v); location.replace(location.pathname + location.hash);
      });
      toggle(N.t('reduce'), function () { return N.store.get('calm', false); }, function (v) { N.store.set('calm', v); document.body.classList.toggle('calm', v); });
      group(N.t('about'));
      info(N.t('version'), N.config.appVersion);
      info(N.t('apiHost'), (N.api.host || '').replace(/^https?:\/\//, '').replace(/\/api.*$/, ''));
      info(N.t('tmdb'), N.tmdb.mock() ? N.t('tmdbMock') : (N.tmdb.token() ? N.t('tmdbOn') : N.t('tmdbOff')));
      if (N.tmdb.enabled()) {
        action(N.t('clearCache'), function () { N.tmdb.clearCache(); N.toast(N.t('cleared')); });
        slist.appendChild(el('div', 'note', N.t('tmdbCredit')));
      }
      // help when something misbehaves: the last errors (to read out / photograph), and a reset of the saved positions
      action(N.t('diagShow'), function () {
        var ls = N.diagLines ? N.diagLines() : [];
        N.confirm({ title: N.t('diagShow'), body: ls.length ? ls.slice(-12).map(function (l) { return '\u2066' + l + '\u2069'; }).join('\n') : N.t('diagNone'), ok: N.t('close'), onOk: function () {} });
      });
      action(N.t('resumeClear'), function () {
        N.confirm({ title: N.t('resumeClear'), body: N.t('resumeClearB'), ok: N.t('resumeClearOk'), danger: true, onOk: function () {
          N.store.del('resume'); N.store.del('resumePosts'); N.store.del('cwHidden'); N.dropHome(); N.toast(N.t('cleared'));
        } });
      });
    }
    // the list column slides in from the inline-end (enter) or the inline-start (back)
    function slide(cls) {
      wrap.classList.remove('in', 'back'); void wrap.offsetWidth; wrap.classList.add(cls);
    }
    function scrollTo(ty) { wrap.classList.toggle('scr', ty < 0); slist.style.transition = 'none'; slist._ty = ty; slist.style.transform = ty ? 'translateY(' + ty + 'px)' : ''; void slist.offsetWidth; slist.style.transition = ''; }

    // ---- pages: root -> list, root -> Subtitle appearance -> list. page() fills slist and returns the row to focus ----
    function head(label) { var h = el('div', 'sl-h'); h.appendChild(ui.icon('chev', 'mirror back')); h.appendChild(el('span', '', label)); slist.appendChild(h); }
    function show(fn) { slist.innerHTML = ''; rows = []; page = fn; return fn(); }
    function open(r, fn) {
      stack.push({ page: page, idx: rows.indexOf(r), ty: slist._ty || 0 });
      scrollTo(0); var f = show(fn); slide('in');
      N.nav.focus(f || rows[0], true);
    }
    function close() {
      var s = stack.pop(); if (!s) return;
      show(s.page); scrollTo(s.ty); slide('back');
      N.nav.focus(rows[s.idx] || rows[0], true);
    }
    // check-list; prev (subtitle style key): focus previews the option, OK stores it
    function listPage(label, options, get, set, prev) {
      head(label);
      var cur = get(), first = null;
      options.forEach(function (o) {
        var x = row('', 'chk' + (o.v === cur ? ' sel' : ''));
        x.insertBefore(ui.icon('check', 'ck'), x.firstChild); ui.txt(x.querySelector('.lb'), o.label); x.removeChild(x._v);
        if (o.c) { var sw = el('i', 'sw'); sw.style.background = o.c; x.appendChild(sw); }
        x.onclick = function () { set(o.v); close(); };
        if (prev) { var f0 = x.onfocus2; x.onfocus2 = function () { f0(); var ov = {}; ov[prev] = o.v; preview(ov); }; }
        if (o.v === cur || !first) first = x;
      });
      if (prev) preview();
      return first;
    }
    function lookPage() {
      head(N.t('subLook'));
      SS.keys.forEach(function (k) {
        var opts = SS.opts[k].map(function (o) { return { v: o.v, label: N.t(o.k), c: o.c }; }), r = list(N.t(SS.label[k]), opts,
          function () { return SS.get(k); }, function (v) { N.store.set(k, v); }, k), c = SS.opt(k, SS.get(k)).c;
        if (c) { var vv = el('span', 'swv'), sw = el('i', 'sw'); sw.style.background = c; vv.appendChild(sw); vv.appendChild(el('span', '', N.t(SS.opt(k, SS.get(k)).k))); val(r, vv); }
        r.onfocus2 = (function (f0) { return function () { f0(); preview(); }; })(r.onfocus2);
      });
      preview();
      return rows[0];
    }

    show(renderRoot);
    var ri = restore && restore.idx, start = (ri !== undefined && ri !== null && rows[ri]) ? rows[ri] : rows[0];
    N.nav.focus(start, true);
    if (start !== rows[0]) scrollTo(slist._ty || 0);
    return {
      destroy: function () { stack = []; },
      back: function () { if (stack.length) { close(); return true; } return false; },
      focusState: function () { if (stack.length) return { idx: stack[0].idx }; var i = rows.indexOf(N.nav.cur); return { idx: i >= 0 ? i : null }; }
    };
  };
})();
