/* Details screen (tvOS product page): title block, buttons, resume caption, plot; below the fold season tabs + episode shelf, cast, TMDB rows, information grid. */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui, sc = N.sc;
  var errorView = sc.errorView;

  var REG = { US: 'آمریکا', GB: 'انگلستان', JP: 'ژاپن', KR: 'کره جنوبی', CN: 'چین', FR: 'فرانسه', DE: 'آلمان', IT: 'ایتالیا', ES: 'اسپانیا', CA: 'کانادا', IN: 'هند', TR: 'ترکیه', IR: 'ایران', AU: 'استرالیا', RU: 'روسیه', MX: 'مکزیک', BR: 'برزیل', SE: 'سوئد', DK: 'دانمارک', NO: 'نروژ', TW: 'تایوان', HK: 'هنگ‌کنگ', BE: 'بلژیک', NL: 'هلند', IE: 'ایرلند', NZ: 'نیوزیلند' };
  var LNG = { en: 'انگلیسی', ja: 'ژاپنی', ko: 'کره‌ای', zh: 'چینی', cn: 'چینی', cmn: 'چینی', fr: 'فرانسوی', de: 'آلمانی', es: 'اسپانیایی', it: 'ایتالیایی', fa: 'فارسی', tr: 'ترکی', hi: 'هندی', ru: 'روسی', ar: 'عربی', pt: 'پرتغالی', sv: 'سوئدی', da: 'دانمارکی', no: 'نروژی', th: 'تایلندی' };
  // country/language display name: Intl (fa only when it really answers in Persian), then the fa table, then the raw (Latin) name
  function regionName(code, type, raw) {
    code = String(code || ''); if (!code) return raw || '';
    try { var dn = new Intl.DisplayNames([N.lang], { type: type }), v = dn.of(type === 'region' ? code.toUpperCase() : code.toLowerCase()); if (v && v.toLowerCase() !== code.toLowerCase() && (N.lang !== 'fa' || N.FA.test(v))) return v; } catch (e) {}
    if (N.lang === 'fa') { var t = type === 'region' ? REG[code.toUpperCase()] : LNG[code.toLowerCase()]; if (t) return t; }
    return raw || code;
  }
  function initials(n) { var p = String(n || '').split(/\s+/); return ((p[0] || '').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase(); }
  // k-face: 180 circle (portrait or initials) + centred name/role
  function faceCard(name, role, img) {
    var c = el('div', 'card f k-face'), art = el('div', 'art'), cap = el('div', 'cap');
    c.appendChild(el('i', 'lift')); art.appendChild(el('span', 'ini', initials(name)));
    if (img) { var im = el('img', 'im'); im.alt = ''; im.decoding = 'async'; art.appendChild(im); c._im = im; c._src = img; }
    art.appendChild(el('i', 'sheen')); c.appendChild(art); c._art = art;
    cap.appendChild(ui.txt(el('div', 'ct c'), name)); cap.appendChild(ui.txt(el('div', 'cs c'), role || '')); c.appendChild(cap);
    return c;
  }
  // air.next_episode_date {g:'16 October 2026 Friday', j} is sometimes stale: hide it once the day has passed
  function nextDay(o) {
    if (!o) return null;
    var m = o.g && /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(o.g), t = m ? Date.parse(m[2] + ' ' + m[1] + ', ' + m[3]) : NaN, d = new Date();
    if (!isNaN(t) && t < new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) return null;
    return o;
  }
  function isNew(post) {
    var u = post.note && post.note.update && post.note.update[0], g = u && u.date && u.date.g, m = g && /(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d))?/.exec(g);
    if (!m) return false;
    var t = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime(), d = Date.now() - t;
    return d > -864e5 && d < 7 * 864e5;
  }

  /* ================= Details ================= */
  S.details = function (root, params) {
    var dead = false, lastFocus = null, swT = null, curS = null;
    root.classList.add('det');
    N.stage.details(true); N.stage.dim(0);
    var sk = el('div', 'skel-wrap'), skb = el('div', 'sk-bb'); skb.style.top = '520px';
    [[640, 64, 0], [420, 28, 20], [760, 28, 20]].forEach(function (s) { var x = el('div', 'bar'); x.style.width = s[0] + 'px'; x.style.height = s[1] + 'px'; x.style.marginTop = s[2] + 'px'; skb.appendChild(x); });
    sk.appendChild(skb); root.appendChild(sk);

    function load() {
      var wantStream = N.isLoggedIn();
      N.api.get('single', { post_id: params.id }).then(function (post) {
        if (dead) return;
        N.stage.show(post, { immediate: true });
        var free = post.options && post.options.free_stream;
        var sp = (wantStream || free) ? N.api.call('stream', { post_id: post.id, free_stream: wantStream ? 0 : 1 }).then(function (j) {
          return (j && j.success) ? j.result : null;
        }).catch(function () { return null; }) : Promise.resolve(null);
        return sp.then(function (st) { if (!dead) render(post, st); });
      }).catch(function (e) { if (!dead) errorView(root, e, function () { root.innerHTML = ''; root.appendChild(sk); load(); }); });
    }
    function render(post, st) {
      root.removeChild(sk);
      var items = (st && st.hls ? st.hls.slice() : []);
      items.sort(function (a, b) {
        var ai = a.info || {}, bi = b.info || {};
        return ((+ai.season || 0) - (+bi.season || 0)) || ((+ai.episode || 0) - (+bi.episode || 0));
      });
      var resume = st && st.continue_watching && st.continue_watching.file_id ? st.continue_watching : null;
      var po = post.options || {}, isSeries = !!po.is_series, info = post.info || {}, air = post.air || {}, nextD = nextDay(air.next_episode_date);
      var tmOn = N.tmdb.enabled(), dpage = el('div', 'd-page'), col = el('div', 'det-col'), dsecs = el('div', 'd-secs');
      if (tmOn) root.classList.add('tm');
      var startIdx = 0;
      if (resume) items.forEach(function (it, i) { if (it.info && String(it.info.file_id) === String(resume.file_id)) startIdx = i; });
      // AmbiSync-Fork: auf dem Fernseher gemerkte Position (siehe js/resume.js). Sie gewinnt, außer der Server
      // kennt dieselbe Folge mit einer mehr als 60 s späteren Zeit.
      function localResume() {
        var loc = N.resume && N.resume.latestFor(post.id); if (!loc) return null;
        var li = -1;
        items.forEach(function (it, i) { var f = it.info || {}; if ((+f.season || 0) === loc.season && N.resume.epNo(f) === loc.episode) li = i; });
        if (li < 0) return null;
        var f0 = items[li].info || {}, srv = null;
        if (resume) items.forEach(function (it) { var f = it.info || {}; if (String(f.file_id) === String(resume.file_id)) srv = { season: +f.season || 0, episode: N.resume.epNo(f), time: +resume.time || 0 }; });
        if (srv && N.resume.serverWins(srv, loc)) return null;
        // Folge zu Ende geschaut: die nächste anbieten (von vorn); beim Film bleibt es beim normalen "Abspielen"
        if (loc.done) return li + 1 < items.length && isSeries ? { i: li + 1, r: null } : { i: 0, r: null, none: true };
        return { i: li, r: { file_id: f0.file_id, time: loc.time, duration: loc.duration, local: true } };
      }
      var lr = localResume();
      if (lr) { resume = lr.r; startIdx = lr.i; }
      // withResume=false: bewusst von vorn (auch die lokale Position wird dann ignoriert)
      function play(i, withResume) { lastFocus = N.nav.cur; N.player.start(post, items, i, withResume ? (i === startIdx ? resume : null) : false); }
      function resumeInfo() {
        var t = +(resume && resume.time) || 0, d = +(resume && resume.duration) || 0;
        if (!d) { var cd = N.cwData[post.id], pr = cd && parseFloat(cd.progress); if (pr > 0 && +cd.time) d = cd.time * 100 / pr; else if (!isSeries && info.time && info.time.default) d = info.time.default * 60; }
        var left = d && t && t < d ? Math.max(1, Math.round((d - t) / 60)) : 0;
        return { left: left, frac: left ? t / d : 0 };
      }
      var ri = resume ? resumeInfo() : { left: 0, frac: 0 };

      /* ---------- above the fold ---------- */
      var titleEl = el('div', 'd-title t1'); col.appendChild(titleEl);
      if (tmOn) titleEl.appendChild(ui.txt(el('span', 'tt t1'), N.title(post))); else ui.txt(titleEl, N.title(post));
      var alt = N.titleAlt(post), altEl = null; if (alt) { altEl = ui.txt(el('div', 'd-alt'), alt); col.appendChild(altEl); }
      var dmeta = el('div', 'd-meta'); dmeta.appendChild(ui.meta(post, { genres: 3 })); col.appendChild(dmeta);
      function badge(cls, text) { dmeta.appendChild(ui.txt(el('span', 'badge ' + cls), text)); }
      var m3 = (items[0] && items[0].file && items[0].file.m3u8) || [], maxH = 0, ch6 = false;
      for (var q = 0; q < m3.length; q++) { var mh = /(\d{3,4})p/i.exec(m3[q].label || ''); if (mh) maxH = Math.max(maxH, +mh[1]); if (/4k|2160/i.test(m3[q].label || '')) maxH = Math.max(maxH, 2160); if (m3[q]['6ch']) ch6 = true; }
      if (maxH >= 2160) badge('o', '4K'); else if (maxH >= 720) badge('o', 'HD');
      if (ch6) { badge('o tab', '5.1'); dmeta.lastChild.classList.add('latin'); dmeta.lastChild.dir = 'ltr'; } // technical label: Latin digits in fa too
      if (po.persian_subtitle) badge('o', N.t('persianSubBadge'));
      if (po.exclusive_subtitle) badge('b', N.t('exclusiveSub'));
      if (isNew(post)) badge('b', N.t(isSeries ? 'newEp' : 'newBadge'));
      if (nextD) { var nd = N.fmt.nextDate(nextD); if (nd) dmeta.appendChild(el('span', 'd-next', N.tf('nextEpOn', { d: nd }))); }

      var btns = el('div', 'd-btns'), playB, rsB = null, wlB = null, wlBusy = false; col.appendChild(btns);
      function noStream() { N.toast(N.isLoggedIn() ? N.t('noStream') : N.t('playLogin'), 3500); }
      if (!items.length) playB = ui.btn(N.t('play'), noStream, '', 'play');
      else playB = ui.btn(N.t(resume ? 'resume' : 'play'), function () { play(startIdx, true); }, '', 'play');
      btns.appendChild(playB);
      if (resume && items.length) { rsB = ui.circle('restart', function () { play(startIdx, false); }); btns.appendChild(rsB); }
      if (N.isLoggedIn()) {
        wlB = ui.circle(N.lists.has('watchlist', post.id) ? 'check' : 'plus', function () {
          if (wlBusy) return; wlBusy = true; // user_list add is a server-side toggle: never fire twice
          N.lists.toggle('watchlist', post.id).then(function (on) {
            wlBusy = false; if (dead) return; ui.setIcon(wlB.firstChild, on ? 'check' : 'plus'); N.toast(N.t(on ? 'addedToList' : 'removedFromList'));
          }, function () { wlBusy = false; if (!dead) N.toast(N.t('error')); });
        });
        btns.appendChild(wlB);
        N.lists.load().then(function () { if (!dead && !wlBusy) ui.setIcon(wlB.firstChild, N.lists.has('watchlist', post.id) ? 'check' : 'plus'); }, function () {});
      }
      if (ri.frac > 0) { var bar = el('div', 'bar'), bi = el('i'); bi.style.transform = 'scaleX(' + Math.min(1, ri.frac) + ')'; bar.appendChild(bi); playB.appendChild(bar); }
      // resume caption: [S/E] · [N min left], composed from spans + i.dot-s (a literal '·' next to digits reads as a Persian zero)
      function captionParts() {
        var rparts = [], i0 = (items[startIdx] && items[startIdx].info) || {};
        if (resume && items.length) { if (isSeries) rparts.push(N.fmt.ep(i0.season || 1, i0.episode || startIdx + 1)); if (ri.left) rparts.push(N.tf('minLeftN', { n: ri.left })); }
        else if (isSeries && items.length) { var f0 = (items[startIdx] && items[startIdx].info) || {}; rparts.push(N.fmt.ep(f0.season || 1, f0.episode || startIdx + 1)); }
        return rparts;
      }
      var rparts = captionParts(), capEl = null;
      if (rparts.length) { capEl = ui.dots(el('div', 'd-resume'), rparts); col.appendChild(capEl); }
      var plotEl = ui.txt(el('div', 'd-plot'), N.plot(post)); col.appendChild(plotEl);
      dpage.appendChild(col); dpage.appendChild(dsecs); root.appendChild(dpage);

      /* ---------- below the fold: entries {key, el, cs, mem, tr, w, s} ---------- */
      var xRows = [], xOn = false, rvOpen = null;
      function setTy(ty) { dpage._ty = ty; dpage.style.transform = ty ? 'translateY(' + ty + 'px)' : ''; }
      function maxTy() { return Math.min(0, -(dsecs.offsetTop + dsecs.offsetHeight + 60 - 1080)); }
      function setX(on) {
        if (on === xOn) return; xOn = on; root.classList.toggle('xs', on); N.stage.dim(on ? 0.8 : 0);
        if (on) { infoMode(false, true); return; }
        setTy(0);
        for (var k = 0; k < xRows.length; k++) {
          var r = xRows[k]; r.el.classList.remove('cur');
          if (!r.tr || r.key === 'eps') continue;
          r.tr.style.transition = 'none'; r.tr._s = null; ui.slideTo(r.tr, 0); r.mem = 0; void r.tr.offsetWidth; r.tr.style.transition = '';
        }
      }
      function focusSection(r) {
        setX(true);
        var top = ui.topIn(r.el, dpage); setTy(Math.max(maxTy(), -(top - 150)));
        for (var k = 0; k < xRows.length; k++) xRows[k].el.classList.toggle('cur', xRows[k].el === r.el);
      }
      // info mode (no cast/TMDB rows): the grid rises over the cover, so dim it like the xs state
      function infoMode(on, keep) { root.classList.toggle('info', on); if (!keep) { setTy(on ? maxTy() : 0); N.stage.dim(on ? 0.8 : 0); } }
      var infoEl = el('div', 'sec d-info');
      function addRow(r) { if (r.el.parentNode !== dsecs) { if (infoEl.parentNode === dsecs) dsecs.insertBefore(r.el, infoEl); else dsecs.appendChild(r.el); } xRows.push(r); return r; }
      function mkRow(key, cls, title, w, s) {
        var sec = el('div', 'sec ' + cls), tr = el('div', 'dtr');
        if (title) sec.appendChild(el('div', 'sec-h', title));
        sec.appendChild(tr);
        return { key: key, el: sec, tr: tr, cs: [], ws: [], mem: 0, w: w, s: s };
      }
      function rowCard(r, c) {
        var i = r.cs.length;
        c.onfocus2 = function () { r.mem = i; ui.slideTo(r.tr, ui.keepX(r.tr, c, r.w, r.s)); focusSection(r); };
        r.tr.appendChild(c); r.cs.push(c); r.ws.push(r.w);
        var s0 = r.tr._s; ui.layoutTrack(r.tr, r.cs, r.ws, 40); r.tr._s = s0;
      }

      /* series: season tabs + episode shelf (crossfades on season change) */
      var map = {}, seasons = [], epMem = {}, tabsE = null, epsE = null, track = null, wrap = null;
      if (isSeries && items.length) {
        items.forEach(function (it, i) { var s = (it.info && it.info.season) || 1; if (!map[s]) { map[s] = []; seasons.push(s); } map[s].push(i); });
        var sec = el('div', 'sec sec-eps'), tabs = el('div', 'tabs');
        wrap = el('div', 'eps-w'); track = el('div', 'dtr'); wrap.appendChild(track);
        sec.appendChild(tabs); sec.appendChild(wrap);
        tabsE = { key: 'tabs', el: sec, cs: [], mem: 0, tr: null };
        epsE = { key: 'eps', el: sec, cs: [], mem: 0, tr: track, w: 404, s: 1.1 };
        seasons.forEach(function (s, si) {
          var t = ui.pill(N.t('season') + ' ' + s, function () { flush(); var e = epsE.cs[Math.min(epsE.mem, epsE.cs.length - 1)]; if (e) N.nav.focus(e, true); }, false); t._s = s;
          t.onfocus2 = function () { showSeason(s); tabsE.mem = si; focusSection(tabsE); };
          tabs.appendChild(t); tabsE.cs.push(t);
        });
        addRow(tabsE); addRow(epsE);
      }
      function loadNear(tiles, i) { for (var k = Math.max(0, i - 6); k < Math.min(tiles.length, i + 9); k++) ui.load(tiles[k]); }
      // the only place that sets epsE.cs / epsE.mem
      function buildSeason(s) {
        track.innerHTML = ''; var tiles = [], at = -1;
        map[s].forEach(function (idx) {
          var it = items[idx], isRes = resume && it.info && String(it.info.file_id) === String(resume.file_id);
          var t = ui.epCard(it, idx, post, { progress: isRes ? ri.frac : 0 }), ti = tiles.length;
          t.onclick = function () { play(idx, true); };
          t.onfocus2 = function () { epMem[curS] = ti; epsE.mem = ti; ui.slideTo(track, ui.keepX(track, t, 404, 1.1)); loadNear(tiles, ti); focusSection(epsE); };
          if (idx === startIdx) at = ti;
          t._idx = idx; track.appendChild(t); tiles.push(t);
        });
        epsE.cs = tiles; epsE.mem = epMem[s] !== undefined ? epMem[s] : (at >= 0 ? at : 0);
        ui.layoutTrack(track, tiles, tiles.map(function () { return 404; }), 40);
        track.style.transition = 'none'; track._s = null;
        if (tiles[epsE.mem]) ui.slideTo(track, ui.keepX(track, tiles[epsE.mem], 404, 1.1));
        void track.offsetWidth; track.style.transition = '';
        loadNear(tiles, epsE.mem);
      }
      function showSeason(s, now) {
        if (s === curS) return; curS = s;
        for (var k = 0; k < tabsE.cs.length; k++) tabsE.cs[k].classList.toggle('cur', tabsE.cs[k]._s === s);
        clearTimeout(swT);
        if (now) { swT = null; buildSeason(s); wrap.classList.remove('sw'); return; }
        wrap.classList.add('sw'); swT = setTimeout(function () { swT = null; buildSeason(s); wrap.classList.remove('sw'); }, 160);
      }
      function flush() { if (swT) { clearTimeout(swT); swT = null; buildSeason(curS); wrap.classList.remove('sw'); } }
      if (tabsE) {
        var s0 = (items[startIdx].info && items[startIdx].info.season) || seasons[0];
        tabsE.mem = Math.max(0, seasons.indexOf(s0)); showSeason(s0, true);
      }

      /* cast (API; TMDB cast replaces it in place) */
      function castRow(list) {
        var r = mkRow('cast', 'sec-cast', N.t('cast'), 180, 1.12);
        list.forEach(function (p) { var c = faceCard(p.n, p.c, p.p); c.onclick = function () { N.go('search', { q: p.n }); }; rowCard(r, c); ui.load(c); });
        return r;
      }
      if (post.cast && post.cast.length) {
        addRow(castRow(post.cast.slice(0, 20).map(function (c) {
          var im = c.image && c.image.poster, src = im && ((im.webp && im.webp.medium) || (im.jpg && im.jpg.medium));
          return { n: c.name, c: c.as, p: src || '' };
        })));
      }

      /* information grid (not focusable) */
      var grid = el('div', 'ig');
      function cell(label, val, viaTxt) {
        if (val === undefined || val === null || val === '') return;
        var c = el('div', 'igc'), v = el('div', 'igv');
        c.appendChild(el('div', 'igl', label)); if (viaTxt) ui.txt(v, val); else v.textContent = val;
        c.appendChild(v); grid.appendChild(c);
      }
      cell(N.t('genre'), N.fmt.list((post.genre || []).map(function (g) { return g.name; })));
      cell(N.t('released'), info.year ? info.year + (info.year_end && info.year_end !== info.year ? '–' + info.year_end : '') : '');
      cell(N.t('runtime'), N.fmt.dur(info.time && info.time.default));
      cell(N.t('rated'), info.age, true);
      cell(N.t('country'), N.fmt.list((post.country || []).map(function (c) { return regionName(c.code, 'region', c.name); })));
      var lp = post.language && post.language.primary; if (lp) cell(N.t('origLang'), regionName(lp.code, 'language', lp.name));
      var net = post.network instanceof Array ? post.network : (post.network ? [post.network] : []);
      cell(N.t('network'), N.fmt.list(net.map(function (x) { return typeof x === 'object' ? x.name : x; })), true);
      var im0 = post.score && post.score.imdb, isc = +(im0 && im0.score) || 0, ivo = +(im0 && im0.votes) || 0;
      if (isc > 0) cell('IMDb', N.fmt.num(isc, 1) + (ivo > 0 ? ' (' + N.fmt.num(ivo) + ')' : ''));
      if (isSeries && air.air_status) {
        var as = air.air_status;
        if (as === 'Continuing') cell(N.t('status'), N.t('airContinuing')); else if (as === 'Ended') cell(N.t('status'), N.t('airEnded')); else cell(N.t('status'), as, !N.FA.test(as));
      }
      cell(N.t('nextEp'), N.fmt.nextDate(nextD));
      if (grid.firstChild) { infoEl.appendChild(el('div', 'sec-h', N.t('info'))); infoEl.appendChild(grid); dsecs.appendChild(infoEl); }

      /* ---------- navigation ---------- */
      function xNav(dir, cur) {
        var r = -1, i = -1, k;
        for (k = 0; k < xRows.length && r < 0; k++) { var ix = xRows[k].cs.indexOf(cur); if (ix >= 0) { r = k; i = ix; } }
        if (r < 0) return false;
        if (dir === 'left' || dir === 'right') { var ni = i + ui.step(dir); if (ni < 0) { N.rail.enter(); return true; } if (!xRows[r].cs[ni]) ui.bump(cur, dir); return xRows[r].cs[ni] || true; }
        if (dir === 'down') {
          var nx = xRows[r + 1];
          if (nx) { if (nx.key === 'eps') flush(); return nx.cs[Math.min(nx.mem, nx.cs.length - 1)] || true; }
          setTy(maxTy()); return true;
        }
        if (dir === 'up') {
          if (r === 0) { setX(false); return playB; }
          var pv = xRows[r - 1]; if (pv.key === 'eps') flush();
          return pv.cs[Math.min(pv.mem, pv.cs.length - 1)] || true;
        }
        return true;
      }
      dsecs.onnav = xNav;
      btns.onnav = function (dir, cur) {
        if (dir === 'down') {
          var r0 = xRows[0]; if (r0) { if (r0.key === 'eps') flush(); return r0.cs[Math.min(r0.mem, r0.cs.length - 1)] || true; }
          if (infoEl.parentNode) infoMode(true);
          return true;
        }
        if (dir === 'up') { if (root.classList.contains('info')) infoMode(false); return true; }
        // left/right stay inside the button row (spatial search would reach the off-screen section cards); past the start edge opens the rail
        var bs = btns.children, bx = -1; for (var k = 0; k < bs.length; k++) if (bs[k] === cur || bs[k].contains(cur)) bx = k;
        if (bx < 0) return false;
        var ni = bx + ui.step(dir);
        if (ni >= bs.length) return true;
        if (ni < 0) { N.rail.enter(); return true; }
        return bs[ni];
      };
      function heroFocus() { setX(false); }
      playB.onfocus2 = heroFocus; if (rsB) rsB.onfocus2 = heroFocus; if (wlB) wlB.onfocus2 = heroFocus;
      current.back = function () {
        if (rvOpen) { closeReview(); return true; }
        if (xOn) { setX(false); N.nav.focus(playB, true); return true; }
        if (root.classList.contains('info')) { infoMode(false); return true; }
        return false;
      };
      current.closeRv = function () { if (rvOpen) { N.nav.popScope(); rvOpen = null; } };

      /* ---------- TMDB extras (progressive; absent without a token) ---------- */
      function revCard(rv) {
        var c = el('div', 'card f k-rev'), h = el('div', 'rvh');
        h.appendChild(ui.txt(el('span', 'rva'), rv.a || '-'));
        if (rv.r) h.appendChild(el('span', 'rvr tab', '★ ' + rv.r));
        var rt = ui.txt(el('div', 'rvt'), rv.t.replace(/\s+/g, ' '));
        c.appendChild(h); c.appendChild(rt);
        c.onclick = function () { openReview(rv); };
        return c;
      }
      function openReview(rv) {
        if (rvOpen) return;
        var m = el('div', 'rv-sheet'), box = el('div', 'rv-box'), hd = el('div', 'rv-h'), bodyW = el('div', 'rv-body'), txt = ui.txt(el('div', 'rv-text'), rv.t), off = 0;
        hd.appendChild(ui.txt(el('span', 'rva'), rv.a || '-')); if (rv.r) hd.appendChild(el('span', 'rvr tab', '★ ' + rv.r)); if (rv.d) hd.appendChild(el('span', 'rvd tab', rv.d));
        bodyW.appendChild(txt); box.appendChild(hd); box.appendChild(bodyW);
        var cb = ui.btn(N.t('close'), function () { closeReview(); }, 'primary');
        cb.onnav = function (dir) {
          if (dir === 'up' || dir === 'down') {
            var mx = Math.max(0, txt.offsetHeight - bodyW.offsetHeight); off = Math.max(0, Math.min(mx, off + (dir === 'down' ? 200 : -200)));
            txt.style.transform = 'translateY(' + (-off) + 'px)'; return true;
          }
          return true;
        };
        var ft = el('div', 'rv-f'); ft.appendChild(cb); box.appendChild(ft);
        m.appendChild(box); root.appendChild(m); rvOpen = { el: m, prev: N.nav.cur };
        N.nav.pushScope(m); void m.offsetWidth; m.classList.add('show'); N.nav.focus(cb, true);
      }
      function closeReview() {
        if (!rvOpen) return; var o = rvOpen; rvOpen = null; N.nav.popScope(); o.el.classList.remove('show');
        setTimeout(function () { if (o.el.parentNode) o.el.parentNode.removeChild(o.el); }, 260);
        if (o.prev && o.prev.offsetWidth > 0) N.nav.focus(o.prev, true);
      }
      function paintTmdb(d) {
        if (d.logo) {
          var li = el('img', 'logo'); li.alt = ''; li.decoding = 'async';
          li.onload = function () { if (dead) return; titleEl.appendChild(li); void li.offsetWidth; li.classList.add('in'); titleEl.classList.add('has-logo'); };
          li.src = N.tmdb.img(d.logo, 'w500');
        }
        if (d.votes >= 5 && d.rating) { var tc = ui.txt(el('span', 'tmdb tab fadein'), 'TMDB ' + (+d.rating).toFixed(1)); tc.dir = 'ltr'; dmeta.appendChild(tc); }
        // fa: TMDB's Persian title as the secondary line when the API has no Persian local title; Persian overview over an English plot
        if (post._faTitle && !N.titleFa(post) && !altEl) { altEl = ui.txt(el('div', 'd-alt'), post._faTitle); col.insertBefore(altEl, dmeta); }
        if (post._faPlot && N.plot(post) === N.unent(post._faPlot)) ui.txt(plotEl, N.plot(post));
        if (d.bd) {
          var tb = N.tmdb.img(d.bd, 'w1280'), cv = ui.coverUrl(post);
          if (!cv) { post._bd = tb; N.stage.show(post, { immediate: true }); }
          else {
            var ci = new Image();
            ci.onload = function () { if (dead) return; if (ci.naturalWidth && ci.naturalWidth < 1280) { post._bd = tb; post._bdPref = true; N.stage.show(post, { immediate: true }); } };
            ci.src = cv;
          }
        }
        if (d.cast.length) {
          var nc = castRow(d.cast.map(function (p) { return { n: p.n, c: p.c, p: p.p ? N.tmdb.img(p.p, 'w185') : '' }; })), oi = -1;
          for (var k = 0; k < xRows.length; k++) if (xRows[k].key === 'cast') oi = k;
          if (oi >= 0) {
            var old = xRows[oi], had = N.nav.cur && old.el.contains(N.nav.cur), idx = had ? old.cs.indexOf(N.nav.cur) : 0;
            dsecs.replaceChild(nc.el, old.el); xRows.splice(oi, 1, nc);
            if (had) N.nav.focus(nc.cs[Math.min(Math.max(0, idx), nc.cs.length - 1)], true);
          } else addRow(nc);
        }
        if (d.crew.length) { var rr = addRow(mkRow('crew', 'sec-cast', N.t('crew'), 180, 1.12)); d.crew.forEach(function (p) { var c = faceCard(p.n, N.t(p.j), p.p ? N.tmdb.img(p.p, 'w185') : ''); rowCard(rr, c); ui.load(c); }); }
        if (d.reviews.length) { var rv = addRow(mkRow('rev', 'sec-rev', N.t('reviews'), 520, 1.05)); d.reviews.forEach(function (x) { rowCard(rv, revCard(x)); }); }
        if (d.recs.length) {
          var recRow = null, got = {}, n = 0, queued = [];
          var addRec = function (p) {
            var c = ui.card(p, 'poster'); c.onclick = function () { N.go('details', { id: p.id }); }; rowCard(recRow, c); ui.load(c);
          };
          d.recs.slice(0, 20).forEach(function (it) {
            N.tmdb.resolve(it, function () { return !dead && n < 12; }).then(function (p) {
              if (dead || !p || p.id === post.id || got[p.id] || n >= 12) return;
              got[p.id] = 1; n++;
              if (!recRow) {
                queued.push(p); if (queued.length < 3) return;
                recRow = addRow(mkRow('rec', 'sec-rec', N.t('moreLikeThis'), 250, 1.1)); queued.forEach(addRec); return;
              }
              addRec(p);
            });
          });
        }
      }
      if (tmOn) N.tmdb.details(post).then(function (d) { if (!dead && d) paintTmdb(d); }).catch(function () {});
      current.onPlayerClosed = function () {
        // AmbiSync-Fork: sonst kennt die Seite noch die alte Position und "Abspielen" startet wieder bei 0
        try {
          var nr = localResume();
          if (nr && items.length) {
            resume = nr.r; startIdx = nr.i; ri = resume ? resumeInfo() : { left: 0, frac: 0 };
            var lab = playB.querySelector('span'); if (lab) lab.textContent = N.t(resume ? 'resume' : 'play');
            var ob = playB.querySelector('.bar'); if (ob) playB.removeChild(ob);
            if (ri.frac > 0) { var nb = el('div', 'bar'), ni = el('i'); ni.style.transform = 'scaleX(' + Math.min(1, ri.frac) + ')'; nb.appendChild(ni); playB.appendChild(nb); }
            if (resume && !rsB) { rsB = ui.circle('restart', function () { play(startIdx, false); }); rsB.onfocus2 = heroFocus; btns.insertBefore(rsB, playB.nextSibling); }
            else if (!resume && rsB) { if (N.nav.cur === rsB || lastFocus === rsB) lastFocus = playB; btns.removeChild(rsB); rsB = null; }
            var np = captionParts(), nc = np.length ? ui.dots(el('div', 'd-resume'), np) : null;
            if (capEl && nc) col.replaceChild(nc, capEl); else if (capEl) col.removeChild(capEl); else if (nc) col.insertBefore(nc, plotEl);
            capEl = nc;
          }
        } catch (e) {}
        var t = lastFocus && lastFocus.offsetWidth > 0 ? lastFocus : playB; N.nav.focus(t, true);
      };
      N.nav.focus(playB, true);
      if (params.autoplay) {
        if (items.length) play(startIdx, true); else noStream();
      }
    }
    var current = { destroy: function () { dead = true; clearTimeout(swT); if (current.closeRv) current.closeRv(); } };
    load();
    return current;
  };
})();
