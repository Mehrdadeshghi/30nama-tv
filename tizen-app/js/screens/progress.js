/* In progress screen: everything left unfinished (continue_watching) as a 16:9 grid, plus the shared CW helpers Home uses
   (N.cwNorm caption, N.cwCard builder, N.cwHidden local dismiss list, N.cwDismiss, N.cwMenu). */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui, sc = N.sc;
  var errorView = sc.errorView, instant = sc.instant;

  N.addStrings({
    en: { offlineList: 'Shown from this TV: 30nama could not be reached.', progress: 'In Progress', removeProg: 'Remove from In Progress', progEmpty: 'Nothing in progress', progEmptySub: 'Movies and series you start watching will appear here.', goHome: 'Go to Home', seeAll: 'See all', options: 'Options', progN: '{n} titles', progN1: '{n} title' },
    fa: { offlineList: 'از حافظه همین تلویزیون: سی‌نما در دسترس نبود.', progress: 'در حال تماشا', removeProg: 'حذف از در حال تماشا', progEmpty: 'چیزی در حال تماشا نیست', progEmptySub: 'فیلم‌ها و سریال‌هایی که شروع به تماشا کنید اینجا نمایش داده می‌شوند.', goHome: 'رفتن به خانه', seeAll: 'مشاهده همه', options: 'گزینه‌ها', progN: '{n} عنوان', progN1: '{n} عنوان' }
  });

  // rail icon (a 3/4 ring around a play glyph), added to the index.html sprite so N.ui.icon('progress') works
  (function () {
    var sp = document.querySelector('svg symbol'), NS = 'http://www.w3.org/2000/svg';
    if (!sp || document.getElementById('i-progress')) return;
    var s = document.createElementNS(NS, 'symbol'); s.setAttribute('id', 'i-progress'); s.setAttribute('viewBox', '0 0 24 24');
    ['M12 3.5a8.5 8.5 0 1 1-8.5 8.5', 'M10 8.8v6.4l5.2-3.2z'].forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    sp.parentNode.appendChild(s);
  })();

  /* ---------------- shared continue-watching helpers ---------------- */
  // caption from the post's own `data` (never episode_title). parts feed ui.dots; label is the plain joined string; prog 0 hides the bar.
  N.cwNorm = function (p) {
    var dd = p.data || {}, pr = parseFloat(dd.progress) || 0, t = +dd.time || 0, parts = [];
    var left = pr > 0 && pr < 95 ? Math.max(1, Math.round((t * 100 / pr - t) / 60)) : 0;
    if (dd.season && dd.episode && !dd.next) {
      // fa: two dot-separated parts (فصل ۳ · قسمت ۱۰); en: 'S3, E10'
      if (N.lang === 'fa') { parts.push(N.t('season') + ' ' + dd.season); parts.push(N.tf('epN', { n: dd.episode })); }
      else parts.push(N.fmt.ep(dd.season, dd.episode));
    }
    if (dd.next) parts.push(N.t('nextEpisode'));   // vorige Folge zu Ende geschaut (js/resume.js mergeCw)
    else if (left) parts.push(N.tf('minLeftN', { n: left })); else if (pr >= 95) parts.push(N.t('watched'));
    return { prog: left ? pr / 100 : 0, label: parts.join(' · '), parts: parts };
  };
  // k-cw card: cover art, white progress hairline, caption title + "S/E · X min left"
  N.cwCard = function (p) {
    var n = N.cwNorm(p), c = ui.card(p, 'cw', { cap: { t: N.title(p), s: n.parts } });
    if (n.prog > 0) { var pb = el('div', 'prog'), pi = el('i'); pi.style.transform = 'scaleX(' + n.prog.toFixed(3) + ')'; pb.appendChild(pi); c._art.insertBefore(pb, c._art.lastChild); }
    c._cw = true; return c;
  };
  // continue_watching_dismiss lags server-side (the item can come back for minutes or hours): remember dismissed ids locally
  // for 24 h as {id: {t: ms}}. A title only shows again when it is watched on this TV after the dismissal (local progress
  // newer than t). Before, a signature of the server data decided, and the server's changing `time` brought titles back.
  var HKEY = 'cwHidden', TTL = 864e5;
  function hRead() {
    var m = N.store.get(HKEY, null), now = Date.now(), out = {}, drop = false, v, t;
    if (!m || typeof m !== 'object') return out;
    for (var k in m) if (m.hasOwnProperty(k)) {
      v = m[k]; t = v && typeof v === 'object' ? +v.t || 0 : +v || 0;
      if (now - t < TTL) out[k] = { t: t }; else drop = true;
    }
    if (drop) N.store.set(HKEY, out);
    return out;
  }
  function watchedSince(id, t) { var l = N.resume && N.resume.latestFor(id); return !!(l && l.ts > t + 1000); }
  N.cwHidden = {
    add: function (p) { var m = hRead(); m[String(p.id)] = { t: Date.now() }; N.store.set(HKEY, m); },
    has: function (id) { var h = hRead()[String(id)]; return !!h && !watchedSince(id, h.t); },
    filter: function (posts) {
      var m = hRead(), drop = false, out = (posts || []).filter(function (p) {
        var h = p && m[String(p.id)];
        if (!h) return !!p;
        if (!watchedSince(p.id, h.t)) return false;
        delete m[String(p.id)]; drop = true; return true;   // watched again here since the dismissal: show it again
      });
      if (drop) N.store.set(HKEY, m);
      return out;
    }
  };
  // fire-and-forget server dismiss + local bookkeeping; the caller animates the card away
  N.cwDismiss = function (p) {
    N.api.call('continue_watching_dismiss', { id: p.id }).then(function (j) { if (!j || !j.success) N.toast(N.t('error')); }).catch(function () { N.toast(N.t('error')); });
    N.cwHidden.add(p); delete N.cwData[p.id]; N.dropHome();
    if (N.resume) N.resume.clearPost(p.id); // sonst holt die lokale Position den Titel wieder zurück
  };
  // context menu for a CW card: remove, watchlist toggle, more info. o: {removeKey, remove(), info(), wl(on)}
  N.cwMenu = function (p, o) {
    var on = N.lists.has('watchlist', p.id), items = [];
    items.push({ label: N.t(o.removeKey || 'removeCw'), icon: 'x', fn: o.remove });
    items.push({ label: N.t(on ? 'removeFromList' : 'addToList'), icon: on ? 'check' : 'plus', fn: function () { o.wl(on); } });
    items.push({ label: N.t('moreInfo'), icon: 'info', fn: o.info });
    N.menu({ title: N.title(p), items: items });
  };

  /* ================= In progress ================= */
  S.progress = function (root, params, restore) {
    var dead = false, COLS = 3, posts = [], cells = [], cards = [], wlBusy = {};
    root.classList.add('progress'); N.stage.neutral(true);
    var box = el('div', 'pg'); root.appendChild(box);
    var head = el('div', 'pg-h'), cnt = el('small', 'cnt', '');
    head.appendChild(el('span', '', N.t('progress'))); head.appendChild(cnt); box.appendChild(head);
    var hint = el('div', 'pg-hint'); hint.appendChild(el('i', 'rk')); hint.appendChild(el('span', '', N.t('options'))); box.appendChild(hint);
    var grid = el('div', 'pgrid'); box.appendChild(grid);
    box.reveal = function (e) { ui.vscroll(box, e._cell || e, 180); };
    for (var s = 0; s < 6; s++) { var sk = el('div', 'pcell sk'); sk.appendChild(el('div', 'sk-c')); grid.appendChild(sk); }
    N.lists.load().catch(function () {}); // watchlist state for the menu

    function count() { cnt.textContent = cards.length ? N.tf(cards.length === 1 ? 'progN1' : 'progN', { n: N.fmt.num(cards.length) }) : ''; hint.style.display = cards.length ? '' : 'none'; }
    // explicit grid nav: a row end never jumps to a far card; the start edge opens the sidebar
    grid.onnav = function (dir, cur) {
      var i = cards.indexOf(cur); if (i < 0) return false;
      var col = i % COLS, last = cards.length - 1;
      if (dir === 'up') return i < COLS ? true : cards[i - COLS];
      if (dir === 'down') { if (cards[i + COLS]) return cards[i + COLS]; return Math.floor(i / COLS) < Math.floor(last / COLS) ? cards[last] : true; }
      if (ui.step(dir) > 0) { if (col < COLS - 1 && cards[i + 1]) return cards[i + 1]; ui.bump(cur, dir); return true; }
      if (col > 0) return cards[i - 1];
      N.rail.enter(); return true;
    };
    function openMenu(c, p) {
      if (c._gone) return;
      N.cwMenu(p, { removeKey: 'removeProg', remove: function () { remove(c, p); }, info: function () { goDetails(p); }, wl: function () { toggleWl(p); } });
    }
    function toggleWl(p) {
      if (wlBusy[p.id]) return; wlBusy[p.id] = 1;
      N.lists.toggle('watchlist', p.id).then(function (on) { delete wlBusy[p.id]; N.toast(N.t(on ? 'addedToList' : 'removedFromList')); })
        .catch(function () { delete wlBusy[p.id]; N.toast(N.t('error')); });
    }
    function goDetails(p) { N.go('details', { id: p.id }); }
    // OK on a card continues playback straight away (Netflix-style); the menu (long OK / Red) still offers More info
    function resumePlay(p) { N.go('details', { id: p.id, autoplay: 1 }); }

    function show(list) {
      grid.innerHTML = ''; posts = list; cells = []; cards = [];
      list.forEach(function (p) {
        var cell = el('div', 'pcell'), c = N.cwCard(p);
        cell.appendChild(c); c._cell = cell;
        c.onclick = function () { if (!c._gone) resumePlay(p); };
        c._lp = function () { openMenu(c, p); };
        c.onred = c._lp;
        grid.appendChild(cell); cells.push(cell); cards.push(c); ui.load(c); // ~12 items, all at once
      });
      count();
      if (!cards.length) { empty(); return; }
      var want = restore && restore.idx !== undefined ? cards[Math.min(restore.idx, cards.length - 1)] : null;
      if (want && restore.idx > 0) instant(root, function () { N.nav.focus(want); });
      else N.nav.focus(cards[0], true);
    }
    function empty() {
      var w = el('div', 'pg-empty'); w.appendChild(ui.icon('progress'));
      w.appendChild(el('div', 'et', N.t('progEmpty'))); w.appendChild(el('div', 'eb', N.t('progEmptySub')));
      var b = ui.btn(N.t('goHome'), function () { N.go('home', {}, { reset: true }); }, '', 'home');
      b.onnav = function (dir) { if ((dir === 'left' || dir === 'right') && ui.step(dir) < 0) N.rail.enter(); return true; };
      w.appendChild(b); root.appendChild(w); box.style.transform = ''; N.nav.focus(b, true);
    }
    // fade the card out (.gone), splice it, then FLIP the following cells from their old slots (transform only); focus stays on a neighbour
    function remove(c, p) {
      if (c._gone) return; c._gone = true;
      N.cwDismiss(p);
      c.classList.add('gone');
      setTimeout(function () {
        if (dead) return;
        var idx = cards.indexOf(c); if (idx < 0) return;
        var had = N.nav.cur === c, after = cells.slice(idx + 1, idx + 1 + 3 * COLS), pos = after.map(function (x) { return [x.offsetLeft, x.offsetTop]; });
        var cell = cells[idx];
        cells.splice(idx, 1); cards.splice(idx, 1); posts.splice(idx, 1);
        if (cell.parentNode) cell.parentNode.removeChild(cell);
        if (had) N.nav.clear();
        count();
        if (!cards.length) { empty(); return; }
        after.forEach(function (x, i) { x.style.transition = 'none'; x.style.transform = 'translate(' + (pos[i][0] - x.offsetLeft) + 'px,' + (pos[i][1] - x.offsetTop) + 'px)'; });
        void grid.offsetWidth;
        after.forEach(function (x) { x.style.transition = 'transform var(--d-move) var(--e-move)'; x.style.transform = ''; });
        setTimeout(function () { after.forEach(function (x) { x.style.transition = ''; }); }, 500);
        if (had) N.nav.focus(cards[Math.min(idx, cards.length - 1)]);
      }, 220);
    }

    function load() {
      N.api.get('continue_watching').then(function (r) {
        if (dead) return;
        var all = N.resume.mergeCw(sc.extractPosts(r)); // AmbiSync-Fork: auf dem Fernseher geschaute Positionen zuerst
        for (var k in N.cwData) if (N.cwData.hasOwnProperty(k)) delete N.cwData[k]; // fresh list (as Home does)
        all.forEach(function (p) { N.cwData[p.id] = p.data || {}; });
        show(N.cwHidden.filter(all)); // API order = most recent first
      }).catch(function (e) {
        if (dead) return;
        // server unreachable: show what this TV knows instead of an error page
        var loc = N.cwHidden.filter(N.resume.mergeCw([]));
        if (loc.length) { loc.forEach(function (p) { N.cwData[p.id] = p.data || {}; }); show(loc); N.toast(N.t('offlineList'), 4000); return; }
        errorView(root, e, function () { N.go('progress', params, { replace: true }); });
      });
    }
    load();
    return {
      destroy: function () { dead = true; },
      focusState: function () { var i = cards.indexOf(N.nav.cur); return i >= 0 ? { idx: i } : null; }
    };
  };
})();
