/* "از گوشی / From phone": play videos from a phone (e.g. saved from Telegram) as the ORIGINAL file with the TV's own player –
   full sound, unlike screen mirroring. The phone opens a page served by the app's TizenBrew service (service/src/server.js,
   port 8030), picks a video and uploads it; the TV starts playing as soon as enough has arrived.
   N.phone polls the service on 127.0.0.1 in the background: a play request from the phone starts the player from any screen,
   and the phone's remote buttons (pause, ±10 s, stop) act on that player. The screen shows the QR code and the received
   videos. Only where the service can run (Samsung + TizenBrew). ES5 only. */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui;

  N.addStrings({
    en: {
      phone: 'From phone', phTitle: 'Videos from your phone', phSub: 'Telegram or gallery videos play here as the original file – full picture and sound, no screen mirroring.',
      phStep1: 'Connect the phone to the same Wi-Fi as the TV.', phStep2: 'Scan the QR code with the phone camera.', phStep3: 'Tap “Select video” – playback starts after a few seconds.',
      phTip: 'Telegram: open the video → ⋮ → Save to Gallery (iPhone: Share → Save to Files).',
      phCode: 'Code {c}', phNewCode: 'New code', phOnTv: 'On this TV', phNone: 'Nothing sent yet.', phPlay: 'Play', phDel: 'Delete',
      phRecv: 'Receiving {p}%', phHalf: 'Incomplete ({p}%)', phNoSvc: 'The phone service is not running.',
      phNoSvcSub: 'Restart TizenBrew once (hold the remote’s power button until the TV restarts), then open 30nama again.',
      phNoNet: 'The TV has no network address.', phNoStore: 'No storage on the TV for videos was found.', phViaTb: 'Open via TizenBrew', phStarting: 'Asked TizenBrew to start the service – this takes a few seconds. If it stays like this, restart the TV (hold the power button) and send a photo of this screen.', phWait: 'Waiting for the video…', phDelQ: 'Delete this video from the TV?', phGone: 'This video is no longer on the TV.'
    },
    fa: {
      phone: 'از گوشی', phTitle: 'ویدیو از گوشی', phSub: 'ویدیوهای تلگرام یا گالری با فایل اصلی اینجا پخش می‌شوند – تصویر و صدای کامل، بدون آینه‌کردن صفحه.',
      phStep1: 'گوشی را به همان وای‌فای تلویزیون وصل کنید.', phStep2: 'کد QR را با دوربین گوشی اسکن کنید.', phStep3: '«انتخاب ویدیو» را بزنید – پخش چند ثانیه بعد شروع می‌شود.',
      phTip: 'تلگرام: ویدیو را باز کنید ← ⋮ ← ذخیره در گالری (آیفون: اشتراک‌گذاری ← Save to Files).',
      phCode: 'کد {c}', phNewCode: 'کد جدید', phOnTv: 'روی تلویزیون', phNone: 'هنوز ویدیویی ارسال نشده.', phPlay: 'پخش', phDel: 'حذف',
      phRecv: 'در حال دریافت {p}٪', phHalf: 'ناتمام ({p}٪)', phNoSvc: 'سرویس ارسال از گوشی فعال نیست.',
      phNoSvcSub: 'یک بار TizenBrew را از نو اجرا کنید (دکمه پاور ریموت را نگه دارید تا تلویزیون ری‌استارت شود) و دوباره سی‌نما را باز کنید.',
      phNoNet: 'تلویزیون آدرس شبکه ندارد.', phNoStore: 'جایی برای ذخیره ویدیو روی تلویزیون پیدا نشد.', phViaTb: 'باز کردن از طریق TizenBrew', phStarting: 'از TizenBrew خواسته شد سرویس را اجرا کند – چند ثانیه طول می‌کشد. اگر همین‌طور ماند، تلویزیون را ری‌استارت کنید و از این صفحه عکس بفرستید.', phWait: 'در انتظار ویدیو…', phDelQ: 'این ویدیو از تلویزیون حذف شود؟', phGone: 'این ویدیو دیگر روی تلویزیون نیست.'
    }
  });

  /* ---------------- background link to the service ---------------- */
  var PH = N.phone = { state: null, ok: false, fails: 0, lastPlay: -1, lastCtl: -1, subs: [], t: null };
  PH.available = function () { return N.platform !== 'webos' && !window.AndroidBridge; };
  // the service takes 8030, or the next free one of these (service/src/server.js); the app looks on each in turn
  PH.ports = [8030, 8031, 8032, 8034]; PH.pi = 0;
  PH.base = function () { return N.config.phoneBase || 'http://127.0.0.1:' + PH.ports[PH.pi]; };

  /* TizenBrew starts the service when it launches the module. If that did not happen (old module data in TizenBrew,
     a crash), ask TizenBrew directly over its own WebSocket (the page itself comes from TizenBrew on 127.0.0.1:8081):
     GetServiceStatuses (7), then StartService (6) for this module. PH.diag keeps what happened, shown on the screen. */
  PH.diag = { tb: '', svc: '', err: '', kicks: 0, at: 0 };
  function moduleName() {
    if (N.config.tbModule) return N.config.tbModule;     // tests
    var m = /\/module\/([^\/]+)\//.exec(location.pathname || '');
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
    return 'gh/Mehrdadeshghi/30nama-tv';                     // page not served by TizenBrew's proxy: assume this fork
  }
  PH.onTb = function () { return location.host === '127.0.0.1:8081' && /\/module\//.test(location.pathname || ''); };
  // the same app, served by TizenBrew (its proxy on 127.0.0.1:8081 is what lets the page reach the service)
  PH.tbUrl = function () { return 'http://127.0.0.1:8081/module/' + encodeURIComponent(moduleName()) + '/tizen-app/index.html'; };
  PH.kick = function (force) {
    var name = moduleName(), d = PH.diag;
    if (!window.WebSocket) { d.tb = 'nows'; return; }
    if (!force && (d.kicks >= 3 || Date.now() - d.at < 30000)) return;
    d.kicks++; d.at = Date.now();
    var ws, done = false, t;
    function fin() { if (done) return; done = true; clearTimeout(t); try { ws.close(); } catch (e) {} notify(); setTimeout(PH.poll, 2500); }
    try { ws = new WebSocket(N.config.tbWs || 'ws://127.0.0.1:8081'); } catch (e) { d.tb = 'noconn'; notify(); return; }
    t = setTimeout(function () { if (!d.svc) d.svc = 'noanswer'; fin(); }, 6000);
    ws.onerror = function () { if (d.tb !== 'ok') d.tb = 'noconn'; fin(); };
    ws.onopen = function () { d.tb = 'ok'; try { ws.send(JSON.stringify({ type: 7 })); } catch (e) {} };
    ws.onmessage = function (ev) {
      var m = null; try { m = JSON.parse(ev.data); } catch (e) {}
      if (!m || m.type !== 7 || !m.payload || !m.payload.forEach) return;
      var me = null; m.payload.forEach(function (x) { if (x && x.name === name) me = x; });
      d.svc = !me ? 'missing' : (me.hasCrashed ? 'crashed' : 'running');
      d.err = me && me.error ? String(typeof me.error === 'string' ? me.error : (me.error.message || JSON.stringify(me.error))).slice(0, 160) : '';
      if (!me || me.hasCrashed) {
        try { ws.send(JSON.stringify({ type: 6, payload: { fullName: name, name: name.split('/').pop(), serviceFile: 'tizen-app/service/phone.js' } })); d.svc += '>start'; } catch (e) {}
      }
      setTimeout(fin, 400);
    };
  };
  function notify() { PH.subs.forEach(function (f) { try { f(PH.ok ? PH.state : null); } catch (e) {} }); }
  PH.diagText = function () {
    var d = PH.diag;
    return 'TizenBrew: ' + (d.tb || '-') + ' · service: ' + (d.svc || '-') + (d.err ? ' (' + d.err + ')' : '') +
      ' · ports ' + PH.ports.join('/') + ' · app ' + (N.config.appVersion || '') +
      ' · page ' + String(location.protocol + '//' + location.host + location.pathname).slice(0, 90);
  };
  function xhr(method, path, cb) {
    var x = new XMLHttpRequest(), done = false;
    function fin(st, j) { if (done) return; done = true; clearTimeout(t); if (cb) cb(st, j); }
    var t = setTimeout(function () { try { x.abort(); } catch (e) {} fin(0, null); }, 4000);
    try { x.open(method, PH.base() + path, true); } catch (e) { fin(0, null); return; }
    x.onload = function () { var j = null; try { j = JSON.parse(x.responseText); } catch (e) {} fin(x.status, j); };
    x.onerror = function () { fin(0, null); };
    try { x.send(null); } catch (e) { fin(0, null); }
  }
  PH.call = function (path, cb) { xhr('POST', path, cb); };
  function playingLocal() { return N.player.open && N.player.post && N.player.post.local; }
  function delay() {
    if (PH.fails >= PH.ports.length * 3) return 20000;     // no service here: look again now and then (it may start later)
    if (PH.subs.length || playingLocal()) return 1000;
    return 2500;
  }
  function schedule() { clearTimeout(PH.t); PH.t = setTimeout(PH.poll, delay()); }
  PH.poll = function () {
    clearTimeout(PH.t);
    if (document.hidden) { schedule(); return; }
    xhr('GET', '/api/state', function (st, j) {
      if (st === 200 && j && j.items) {
        var first = PH.lastPlay < 0;
        PH.ok = true; PH.fails = 0; PH.state = j;
        if (first) {
          // a play request from the last minute (app opened right after sending) still counts; older ones are history
          PH.lastPlay = j.play && j.play.n && j.now - j.play.t < 60000 ? j.play.n - 1 : (j.play && j.play.n) || 0;
          PH.lastCtl = (j.ctl && j.ctl.n) || 0;
        }
        if (j.play && j.play.n > PH.lastPlay) { PH.lastPlay = j.play.n; var it = PH.find(j.play.id); if (it) PH.play(it); }
        if (j.ctl && j.ctl.n > PH.lastCtl) { PH.lastCtl = j.ctl.n; if (j.now - j.ctl.t < 15000) control(j.ctl.a); }
      } else {
        PH.ok = false; PH.fails++;
        if (!N.config.phoneBase) PH.pi = (PH.pi + 1) % PH.ports.length;
        if (PH.fails >= PH.ports.length) PH.kick();        // nothing on any port: have TizenBrew start the service
      }
      notify();
      schedule();
    });
  };
  PH.find = function (id) { var a = (PH.state && PH.state.items) || []; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; };
  PH.watch = function (fn) { PH.subs.push(fn); PH.poll(); return function () { var i = PH.subs.indexOf(fn); if (i >= 0) PH.subs.splice(i, 1); }; };
  function control(a) {
    var P = N.player; if (!P.open) return;
    if (a === 'toggle') P.togglePause();
    else if (a === 'back') P.seekBy(-10);
    else if (a === 'fwd') P.seekBy(10);
    else if (a === 'stop') P.close();
  }
  PH.url = function (it) { return PH.base() + '/v/' + it.id + '.' + (it.ext || 'mp4'); };
  function nameOf(it) { return String(it.name || 'Video').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' '); }
  // play a received video in the normal player; its own spot is kept on this TV ('phone.pos'), nothing goes to 30nama
  PH.play = function (it) {
    var P = N.player;
    N.splashReady();
    if (N.live && N.live.isOpen && N.live.isOpen()) N.live.close();
    if (P.open) P.close();
    if (document.querySelector('.modal') && N.closeModal) N.closeModal();
    var key = 'phone:' + it.id, pos = N.store.get('phone.pos', {}), saved = pos[it.id], start = 0;
    if (saved && saved.t > 15 && !(saved.d && saved.t > saved.d - 20)) start = saved.t;
    var post = { id: key, local: true, title: { english: nameOf(it) }, info: {}, image: null,
      onSave: function (t, d) {
        if (!(t > 0)) return;
        var all = N.store.get('phone.pos', {}); all[it.id] = { t: Math.floor(t), d: Math.floor(d || 0), at: Date.now() };
        var ks = Object.keys(all).sort(function (a, b) { return all[b].at - all[a].at; });
        ks.slice(20).forEach(function (k) { delete all[k]; });
        N.store.set('phone.pos', all);
      } };
    P.start(post, [{ info: { file_id: key }, file: { m3u8: PH.url(it) } }], 0, start ? { file_id: key, time: start } : false);
  };
  // start polling once the app has booted (only where the service can exist)
  setTimeout(function () { if (PH.available()) PH.poll(); }, 3000);

  /* ---------------- screen ---------------- */
  function mb(b) { var m = (b || 0) / 1048576; return m >= 1000 ? N.fmt.num((m / 1024).toFixed(1)) + ' GB' : N.fmt.num(m < 10 ? m.toFixed(1) : Math.round(m)) + ' MB'; }
  S.phone = function (root, params, restore) {
    var dead = false, tiles = [], lastSig = '', qrUrl = '';
    root.classList.add('phone'); N.stage.neutral(true); N.splashReady();
    var box = el('div', 'ph'); root.appendChild(box);
    box.appendChild(el('div', 'ph-h', N.t('phTitle')));
    var info = el('div', 'ph-info'); box.appendChild(info);
    info.appendChild(el('div', 'ph-sub', N.t('phSub')));
    var steps = el('ol', 'ph-steps');
    ['phStep1', 'phStep2', 'phStep3'].forEach(function (k, i) { var li = el('li'); li.appendChild(el('b', '', N.fmt.num(i + 1))); li.appendChild(el('span', '', N.t(k))); steps.appendChild(li); });
    info.appendChild(steps);
    info.appendChild(el('div', 'ph-tip', N.t('phTip')));

    var side = el('div', 'ph-qr'), qrBox = el('div', 'qr'), urlEl = el('div', 'url'), codeEl = el('div', 'code');
    side.appendChild(qrBox); side.appendChild(urlEl); side.appendChild(codeEl);
    var newB = ui.btn(N.t('phNewCode'), function () {
      PH.call('/api/newcode', function () { lastSig = ''; PH.poll(); });
    }, '', 'restart');
    side.appendChild(newB); box.appendChild(side);
    var msg = el('div', 'ph-msg hidden'); box.appendChild(msg);

    var listH = el('div', 'ph-lh', N.t('phOnTv')); box.appendChild(listH);
    var row = el('div', 'ph-row'); box.appendChild(row);
    row.onnav = function (dir, cur) {
      var i = tiles.indexOf(cur); if (i < 0) return false;
      if (dir === 'left' || dir === 'right') {
        var j = i + ui.step(dir); if (tiles[j]) { reveal(tiles[j]); return tiles[j]; }
        if (ui.step(dir) < 0) { N.rail.enter(); return true; }
        ui.bump(cur, dir); return true;
      }
      if (dir === 'up') return newB;
      return true;
    };
    newB.onnav = function (dir) {
      if (dir === 'down') return tiles[0] || true;
      if (dir === 'up') return true;
      if (ui.step(dir) < 0) N.rail.enter();   // nothing else on this row: the start side opens the sidebar
      return true;
    };
    function reveal(t) {
      var x = t.offsetLeft, w = row.offsetWidth, sw = row.scrollWidth, off = 0;
      // keep the focused tile inside the row; RTL rows scroll the other way
      if (sw > w) off = Math.max(0, Math.min(sw - w, (N.isRtl() ? sw - x - t.offsetWidth : x) - 120));
      row.style.transform = 'translateX(' + (N.isRtl() ? off : -off) + 'px)';
    }

    function showQr(st) {
      var ip = st.ip, url = ip ? 'http://' + ip + ':' + (st.port || 8030) + '/' + st.code : '';
      if (url === qrUrl) return; qrUrl = url;
      qrBox.innerHTML = '';
      if (!url) { qrBox.appendChild(el('div', 'noip', N.t('phNoNet'))); urlEl.textContent = ''; codeEl.textContent = ''; return; }
      var qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
      urlEl.textContent = ip + ':' + (st.port || 8030) + '/' + st.code; urlEl.dir = 'ltr';
      codeEl.textContent = N.tf('phCode', { c: st.code });
    }
    function tileFor(it) {
      var t = el('button', 'ph-tile f'), art = el('div', 'art'), cap = el('div', 'cap');
      art.appendChild(ui.icon(it.done || it.ready ? 'play' : 'phone'));
      var bar = el('div', 'bar'), bi = el('i'); bar.appendChild(bi); art.appendChild(bar);
      t.appendChild(art); t.appendChild(cap);
      var nm = el('div', 'nm'); ui.txt(nm, nameOf(it)); cap.appendChild(nm);
      var meta = el('div', 'meta'); cap.appendChild(meta);
      t._it = it;
      t.upd = function (x) {
        t._it = x;
        var p = x.size ? Math.floor(x.recv * 100 / x.size) : 0;
        meta.textContent = x.done ? mb(x.size) : (x.busy ? N.tf('phRecv', { p: N.fmt.num(p) }) : N.tf('phHalf', { p: N.fmt.num(p) }));
        bar.style.display = x.done ? 'none' : ''; bi.style.transform = 'scaleX(' + (p / 100).toFixed(3) + ')';
        t.classList.toggle('dim', !x.ready);
      };
      t.upd(it);
      t.onclick = function () { if (t._it.ready) PH.play(t._it); else N.toast(N.t('phWait'), 2500); };
      t._lp = function () {
        N.menu({ title: nameOf(t._it), items: [
          { label: N.t('phPlay'), icon: 'play', fn: t.onclick },
          { label: N.t('phDel'), icon: 'x', fn: function () { PH.call('/api/del/' + t._it.id, function () { lastSig = ''; PH.poll(); }); } }
        ] });
      };
      t.onred = t._lp;
      return t;
    }
    function render(st) {
      if (dead) return;
      if (!st || st.storage === false) {
        side.classList.add('hidden'); listH.classList.add('hidden'); row.classList.add('hidden'); info.classList.add('hidden');
        var hadMsg = N.nav.cur && msg.contains(N.nav.cur);
        msg.classList.remove('hidden'); msg.innerHTML = '';
        msg.appendChild(ui.icon('phone'));
        msg.appendChild(el('div', 'et', N.t(st ? 'phNoStore' : 'phNoSvc')));
        if (!st) msg.appendChild(el('div', 'eb', N.t(PH.diag.kicks ? 'phStarting' : 'phNoSvcSub')));
        var dg = el('div', 'dg'); dg.dir = 'ltr'; dg.textContent = PH.diagText(); msg.appendChild(dg);
        var rb = ui.btn(N.t('retry'), function () { PH.fails = 0; PH.kick(true); PH.poll(); }, '', 'restart');
        msg.appendChild(rb);
        if (!PH.onTb() && N.platform === 'tizen') {   // opened some other way: offer the TizenBrew-served copy
          msg.appendChild(ui.btn(N.t('phViaTb'), function () { location.href = PH.tbUrl(); }, '', 'play'));
        }
        if (hadMsg || !N.nav.cur || !document.body.contains(N.nav.cur) || root.contains(N.nav.cur)) {
          if (!N.rail.open && !document.querySelector('.modal') && !N.player.open) N.nav.focus(rb, true);
        }
        return;
      }
      side.classList.remove('hidden'); listH.classList.remove('hidden'); row.classList.remove('hidden'); info.classList.remove('hidden'); msg.classList.add('hidden');
      showQr(st);
      var sig = st.items.map(function (x) { return x.id; }).join(',');
      if (sig !== lastSig) {
        var focusId = N.nav.cur && N.nav.cur._it ? N.nav.cur._it.id : null, had = N.nav.cur && root.contains(N.nav.cur);
        lastSig = sig; row.innerHTML = ''; tiles = [];
        if (!st.items.length) row.appendChild(el('div', 'none', N.t('phNone')));
        st.items.forEach(function (x) { var t = tileFor(x); row.appendChild(t); tiles.push(t); });
        var want = null;
        tiles.forEach(function (t) { if (t._it.id === focusId) want = t; });
        if (!want && had && N.nav.cur && !root.contains(N.nav.cur)) want = tiles[0] || newB;
        if (!N.nav.cur || !document.body.contains(N.nav.cur) || (had && !root.contains(N.nav.cur))) want = want || tiles[0] || newB;
        if (want && !N.rail.open && !document.querySelector('.modal') && !N.player.open) { N.nav.focus(want, true); reveal(want); }
      } else {
        tiles.forEach(function (t) { var x = PH.find(t._it.id); if (x) t.upd(x); });
      }
    }
    var unwatch = PH.watch(render);
    // first frame before the service answers: QR area waits, focus on the code button
    N.nav.focus(newB, true);
    return {
      destroy: function () { dead = true; unwatch(); },
      focusState: function () { return null; }
    };
  };
})();
