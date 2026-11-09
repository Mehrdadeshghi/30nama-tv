/* Home screen: one scrolling page (tvOS). The hero is the first block of .hpage; Down translates the whole page (and the stage art) so rows scroll up under it. */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui, sc = N.sc;
  var extractPosts = sc.extractPosts, errorView = sc.errorView, instant = sc.instant, skeletonHome = sc.skeletonHome;
  // watchlist row posts survive Home rebuilds (so Back restores focus into it synchronously); sig = user_mylist watchlist ids, tok = session
  var wlCache = null;

  /* ================= Home ================= */
  S.home = function (root, params, restore) {
    // page y of .rows; focused row header lands at ANCHOR (the lower part of the row above stays visible)
    var HERO_ROWS_TOP = 872, ANCHOR = 330;
    var dead = false, st = { mode: 'hero', row: -1 }, logged = N.isLoggedIn();
    var heroes = [], defs = [], rowEls = [], tracks = [], cards = [], mem = [], tops = [], cwIds = {}, rowObjs = [];
    var hpage, bb, bbE, dotsEl, playBtn, wlBtn = null, infoBtn, heroBtns = [], heroUi, rowsEl, noteBtn = null, noteEl = null;
    var curPost = null, curImm = false, shownKey = '', fT = null, bbT = null, flip = false, lastAct = Date.now(), advT = null, rowsTy = null, heroIdx = 0, heroNav = 0, heroT = null, wlBusy = {};
    root.classList.add('home');
    var sk = skeletonHome(root);
    function act() { lastAct = Date.now(); }
    document.addEventListener('keydown', act);

    function load() {
      var cw = logged ? N.api.get('continue_watching').catch(function () { return null; }) : Promise.resolve(null);
      var tmOn = N.tmdb.enabled(), tmH = Promise.resolve([]);
      if (tmOn) { root.classList.add('tm'); N.tmdb.startHome(); tmH = N.tmdb.heroes(6, 3200).catch(function () { return []; }); }
      Promise.all([N.getHome(), cw, tmH]).then(function (res) { if (!dead) build(res[0], N.cwHidden.filter(logged ? N.resume.mergeCw(extractPosts(res[1])) : []), res[2], !!res[1]); }) // locally dismissed ids stay hidden (screens/progress.js)
        .catch(function (e) { if (dead) return; N.splashReady(); errorView(root, e, function () { root.innerHTML = ''; sk = skeletonHome(root); load(); }); });
    }

    function wlTok() { return (N.session && N.session.token) || ''; }
    function build(h, cwPosts, tmHeroes, cwOk) {
      root.removeChild(sk);
      heroes = ((h.hero_header && h.hero_header.posts) || []).slice(0, 8);
      if (tmHeroes && tmHeroes.length >= 3) heroes = tmHeroes;
      if (cwOk) for (var ck in N.cwData) if (N.cwData.hasOwnProperty(ck)) delete N.cwData[ck]; // fresh list: drop entries that left Continue Watching
      cwPosts.forEach(function (p) { cwIds[p.id] = true; N.cwData[p.id] = p.data || {}; });
      if (cwPosts.length) defs.push({ key: 'cw', kind: 'cw', title: N.t('continueWatching'), posts: cwPosts });
      if (logged && wlCache && wlCache.tok === wlTok() && wlCache.posts.length) defs.push({ key: 'wl', kind: 'poster', title: N.t('watchlist'), posts: wlCache.posts.slice() });
      ['suggested', 'new_releases', 'top_10', 'movies', 'series', 'anime'].forEach(function (k) {
        var ps = h[k] && h[k].posts; if (!ps || !ps.length) return;
        defs.push({ key: k, title: N.t(k), kind: k === 'top_10' ? 'top' : k === 'suggested' ? 'land' : 'poster', posts: k === 'top_10' ? ps.slice(0, 10) : ps });
      });
      hpage = el('div', 'hpage'); root.appendChild(hpage);
      var mark = el('img', 'home-mark'); mark.alt = ''; mark.src = 'img/logo-mark.png'; hpage.appendChild(mark);
      // billboard
      bb = el('div', 'bb'); bbE = {};
      ['title:bb-title t1', 'sub:bb-sub', 'meta:bb-meta', 'plot:bb-plot'].forEach(function (s) {
        var p = s.split(':'), e = el('div', 'bb-i ' + p[1]); bbE[p[0]] = e; bb.appendChild(e);
      });
      hpage.appendChild(bb);
      // hero buttons + dots
      heroUi = el('div', 'hero-ui');
      playBtn = ui.btn(N.t('play'), function () { goDetails(heroes[heroIdx], true); }, '', 'play');
      heroBtns = [playBtn];
      if (logged) { wlBtn = ui.circle('plus', function () { toggleWl(heroes[heroIdx]); }); heroBtns.push(wlBtn); }
      infoBtn = ui.circle('info', function () { goDetails(heroes[heroIdx], false); });
      heroBtns.push(infoBtn);
      heroBtns.forEach(function (b) { heroUi.appendChild(b); b.onfocus2 = function () { if (st.mode !== 'hero') exitBrowse(true); }; });
      dotsEl = el('div', 'dots'); if (heroes.length > 1) heroes.forEach(function () { dotsEl.appendChild(el('i')); }); heroUi.appendChild(dotsEl);
      hpage.appendChild(heroUi);
      if (!heroes.length) { bb.style.display = 'none'; heroUi.style.display = 'none'; }
      // rows
      rowsEl = el('div', 'rows'); hpage.appendChild(rowsEl);
      defs.slice().forEach(function (d) { pushRow(makeRow(d)); });
      if (!logged) {
        noteEl = el('div', 'guest-note'); noteEl.appendChild(el('div', 'gn-t', N.t('loginRequired')));
        noteBtn = ui.btn(N.t('signIn'), function () { N.go('login', {}, { reset: true }); }, '');
        noteBtn.onfocus2 = function () { enterBrowse(); setRow(defs.length); };
        noteEl.appendChild(noteBtn); rowsEl.appendChild(noteEl);
      }
      recalcTops();
      root.onnav = onnav;
      N.nav.onSettle(follow);
      // initial state (restore by row key: rows above may have been inserted async)
      var start = 0, rk = -1, br = null;
      if (restore && restore.mode === 'browse') {
        rk = restore.key ? keyIndex(restore.key) : -1;
        if (rk >= 0 && cards[rk].length) br = cards[rk][Math.min(restore.idx || 0, cards[rk].length - 1)];
      }
      if (restore && typeof restore.hero === 'number' && heroes[restore.hero]) start = restore.hero;
      instant(root, function () { setRowsRest(); });
      if (heroes.length) setHero(start, true);
      else if (!br) N.splashReady();
      if (br) still(function () { enterBrowse(); mem[rk] = cards[rk].indexOf(br); setRow(rk); N.nav.focus(br, true); });
      else if (heroes.length) N.nav.focus(playBtn, true);
      else if (cards[0]) N.nav.focus(cards[0][0], true);
      else if (noteBtn) N.nav.focus(noteBtn, true);
      advT = setInterval(autoAdvance, 1000);
      if (logged) refreshWl(false);
      tmSetup();
      liveRow();
    }
    // instant layout change for the page AND the stage art (the .mv wrapper lives outside root)
    function still(fn) {
      var mv = document.querySelector('#stage .mv');
      if (mv) mv.style.transition = 'none';
      instant(root, fn);
      if (mv) { void mv.offsetWidth; mv.style.transition = ''; }
    }
    function keyIndex(k) { for (var i = 0; i < defs.length; i++) if (defs[i].key === k) return i; return -1; }

    // one row = {d, row, tr, cs, ws}; d.posts are cards in order. Closures resolve row/card indexes lazily (rows and cards can be inserted/removed).
    function addCard(r, p, i) {
      var d = r.d, c, w;
      if (d.kind === 'live') {   // fork: live channel card, OK plays the channel straight away
        c = N.live.card(p, 0); w = 250;
        c.onfocus2 = function () { onCardFocus(defs.indexOf(d), r.cs.indexOf(c)); };
        c.onclick = function () { N.live.play(d.posts, d.posts.indexOf(p)); };
        c._lp = function () { c.classList.toggle('fav', N.live.toggleFav(p)); };
        r.tr.appendChild(c); r.cs.push(c); r.ws.push(w);
        if (i < 10) ui.load(c);
        return;
      }
      if (d.kind === 'cw') { c = N.cwCard(p); w = 548; } else if (d.kind === 'land') { c = ui.card(p, 'land'); w = 404; }
      else if (d.kind === 'top') { c = ui.card(p, 'top', { rank: i + 1 }); w = i + 1 >= 10 ? 440 : 360; }
      else { c = ui.card(p, 'poster'); w = 250; }
      c.onfocus2 = function () { onCardFocus(defs.indexOf(d), r.cs.indexOf(c)); };
      // Continue Watching: OK plays on at the saved spot (or the next episode); other rows open the details page
      c.onclick = function () { goDetails(p, !!c._cw); };
      if (logged) c._lp = function () { openCardMenu(r, c, p); };
      if (logged && c._cw) c.onred = c._lp; // Red opens the CW menu (as on the In progress screen); elsewhere Red stays Search
      r.tr.appendChild(c); r.cs.push(c); r.ws.push(w);
      if (i < 10) ui.load(c);
    }
    // "See all" tile closing a long CW row: opens the In progress screen. Not a post (r.d.posts stays aligned with the cards before it).
    function addMore(r) {
      var c = el('div', 'card f k-cw k-more'), art = el('div', 'art');
      c.appendChild(el('i', 'lift')); art.appendChild(ui.icon('chev', 'mirror')); art.appendChild(el('div', 'ml', N.t('seeAll'))); art.appendChild(el('i', 'sheen'));
      c.appendChild(art); c._art = art; c._more = true;
      c.onfocus2 = function () { onCardFocus(defs.indexOf(r.d), r.cs.indexOf(c)); };
      c.onclick = function () { N.go('progress', {}); };
      r.tr.appendChild(c); r.cs.push(c); r.ws.push(308);
    }
    function makeRow(d) {
      var k = d.kind === 'poster' ? 'p' : d.kind;
      var row = el('div', 'hrow r-' + k), hd = el('div', 'hrow-h'), tr = el('div', 'track'), r = { d: d, row: row, tr: tr, cs: [], ws: [] };
      hd.appendChild(ui.txt(el('span'), d.title)); row.appendChild(hd); row.appendChild(tr);
      d.posts.forEach(function (p, i) { addCard(r, p, i); });
      if (d.kind === 'cw' && d.posts.length > 6) addMore(r);
      ui.layoutTrack(tr, r.cs, r.ws, 40);
      return r;
    }
    // fork: "Live TV" row right after Continue Watching (async: the channel list may still be loading)
    function liveRow() {
      if (!N.live || !N.store.get('liveHome', true)) return;
      N.live.load(false).then(function () {
        if (dead || keyIndex('live') >= 0) return;
        var ps = N.live.homeList(); if (!ps.length) return;
        insertRowAt(makeRow({ key: 'live', kind: 'live', title: N.t('live'), posts: ps }), keyIndex('cw') + 1);
      }).catch(function () {});
    }
    function pushRow(r) { if (defs.indexOf(r.d) < 0) defs.push(r.d); rowEls.push(r.row); tracks.push(r.tr); cards.push(r.cs); mem.push(0); rowsEl.appendChild(r.row); rowObjs.push(r); }
    function recalcTops() { tops.length = 0; for (var k = 0; k < rowEls.length; k++) tops.push(rowEls[k].offsetTop); if (noteEl) tops.push(noteEl.offsetTop); }
    // re-anchor the focused row after rows above it changed (no animation)
    function reanchor(curD) {
      still(function () {
        if (st.mode === 'hero') { setRowsRest(); return; }
        var k = curD ? defs.indexOf(curD) : (N.nav.cur && N.nav.cur === noteBtn ? defs.length : -1);
        if (k >= 0) { st.row = -1; rowsTy = null; setRow(k); }
      });
    }
    // insert a row at index `at`, keeping the current view stable
    function insertRowAt(r, at) {
      var curD = st.mode === 'browse' && defs[st.row] ? defs[st.row] : null;
      defs.splice(at, 0, r.d); rowEls.splice(at, 0, r.row); tracks.splice(at, 0, r.tr); cards.splice(at, 0, r.cs); mem.splice(at, 0, 0); rowObjs.splice(at, 0, r);
      rowsEl.insertBefore(r.row, rowEls[at + 1] || noteEl || null);
      recalcTops(); reanchor(curD);
      for (var k = 0; k < r.cs.length && k < 10; k++) ui.load(r.cs[k]);
    }
    // remove row k; if focus was in it, focus moves to row k (the next one), then k-1, then the hero
    function removeRowAt(k) {
      if (k < 0 || k >= defs.length) return;
      var wasCur = st.mode === 'browse' && st.row === k, curD = st.mode === 'browse' && !wasCur && defs[st.row] ? defs[st.row] : null, r = rowObjs[k];
      defs.splice(k, 1); rowEls.splice(k, 1); tracks.splice(k, 1); cards.splice(k, 1); mem.splice(k, 1); rowObjs.splice(k, 1);
      if (r.row.parentNode) r.row.parentNode.removeChild(r.row);
      recalcTops();
      if (!wasCur) { reanchor(curD); return; }
      st.row = -1; rowsTy = null;
      var t = cards[k] ? k : cards[k - 1] ? k - 1 : -1;
      if (t >= 0) N.nav.focus(cards[t][Math.min(mem[t] || 0, cards[t].length - 1)]);
      else if (noteBtn) N.nav.focus(noteBtn);
      else if (heroes.length) N.nav.focus(playBtn);
      else setRowsRest();
    }
    var tmRows = {}, tmFeeds = [];
    function tmSetup() {
      if (!N.tmdb.enabled()) return;
      var TD = [['trend', 'trendingWeek', 5], ['fresh', 'newSeries', 5], ['pop', 'popularMovies', 5]];
      TD.forEach(function (x) {
        var f = N.tmdb.feed(x[0]); tmFeeds.push(f);
        function cb() {
          if (dead) return;
          var items = f.items.slice().sort(function (a, b) { return a.i - b.i; }), r = tmRows[x[0]];
          if (!r) {
            if (items.length < x[2]) return;
            var d = { key: 'tm_' + x[0], title: N.t(x[1]), kind: 'poster', posts: items.map(function (it) { return it.post; }) };
            r = tmRows[x[0]] = makeRow(d); r.n = items.length;
            // after cw/wl, keeping trend < fresh < pop order
            var order = { tm_trend: 0, tm_fresh: 1, tm_pop: 2 }, at = 0;
            while (at < defs.length && (defs[at].key === 'cw' || defs[at].key === 'wl' || (order[defs[at].key] !== undefined && order[defs[at].key] < order[d.key]))) at++;
            insertRowAt(r, at);
          } else {
            var seen = {}; r.d.posts.forEach(function (p) { seen[p.id] = 1; });
            items.forEach(function (it) { if (!seen[it.post.id]) { seen[it.post.id] = 1; r.d.posts.push(it.post); addCard(r, it.post, r.d.posts.length - 1); } });
            var s0 = r.tr._s; ui.layoutTrack(r.tr, r.cs, r.ws, 40); r.tr._s = s0;
          }
          if (f.done) f.unsubscribe(cb);
        }
        f.subscribe(cb);
      });
    }

    /* ---- watchlist row + context menu ---- */
    // (re)load user_mylist; rebuild the Watchlist row when its ids changed (skipped while focus is inside it)
    function refreshWl(force) {
      N.lists.load(force).then(function () {
        if (dead) return; wlIcon();
        var sig = ((N.lists.arr && N.lists.arr.watchlist) || []).join(','), tok = wlTok();
        if (wlCache && wlCache.tok === tok && wlCache.sig === sig) { if (keyIndex('wl') < 0 && wlCache.posts.length) setWlRow(wlCache.posts); return; }
        return N.lists.listPosts('watchlist', 1).then(function (res) {
          if (dead) return;
          wlCache = { tok: tok, sig: sig, posts: (res.posts || []).slice(0, 24) };
          setWlRow(wlCache.posts);
        });
      }).catch(function () {});
    }
    function setWlRow(posts) {
      var k = keyIndex('wl');
      if (k >= 0) { if (st.mode === 'browse' && st.row === k) return; removeRowAt(k); }
      if (!posts.length) return;
      insertRowAt(makeRow({ key: 'wl', kind: 'poster', title: N.t('watchlist'), posts: posts.slice() }), keyIndex('cw') + 1);
    }
    function wlIcon() {
      if (!wlBtn) return; var p = heroes[heroIdx];
      ui.setIcon(wlBtn.firstChild, p && N.lists.has('watchlist', p.id) ? 'check' : 'plus');
    }
    function toggleWl(p) {
      if (!p || wlBusy[p.id]) return; wlBusy[p.id] = 1;
      N.lists.toggle('watchlist', p.id).then(function (on) {
        delete wlBusy[p.id]; N.toast(N.t(on ? 'addedToList' : 'removedFromList'));
        if (dead) return; wlIcon();
        var k = keyIndex('wl'), r = k >= 0 ? rowObjs[k] : null, ix = -1;
        if (r) for (var i = 0; i < r.d.posts.length; i++) if (String(r.d.posts[i].id) === String(p.id)) ix = i;
        if (!on && r && ix >= 0) {
          removeCard(r, r.cs[ix]);
          if (wlCache) { wlCache.posts = wlCache.posts.filter(function (x) { return String(x.id) !== String(p.id); }); wlCache.sig = ((N.lists.arr && N.lists.arr.watchlist) || []).join(','); }
        } else if (on !== (ix >= 0)) refreshWl(false);
      }).catch(function () { delete wlBusy[p.id]; N.toast(N.t('error')); });
    }
    function openCardMenu(r, c, p) {
      var items = [], on = N.lists.has('watchlist', p.id);
      if (c._cw) items.push({ label: N.t('removeCw'), icon: 'x', fn: function () { dismiss(r, c, p); } });
      items.push({ label: N.t(on ? 'removeFromList' : 'addToList'), icon: on ? 'check' : 'plus', fn: function () { toggleWl(p); } });
      items.push({ label: N.t('moreInfo'), icon: 'info', fn: function () { goDetails(p, false); } });
      N.menu({ title: N.title(p), items: items });
    }
    // continue_watching_dismiss lags server-side: N.cwDismiss remembers the id locally; drop the card at once
    function dismiss(r, c, p) {
      if (c._gone) return;
      N.cwDismiss(p); delete cwIds[p.id];
      if (heroes[heroIdx] && heroes[heroIdx].id === p.id) playBtn.lastChild.textContent = N.t('play');
      removeCard(r, c);
    }
    // fade the card out (.gone), then splice it and slide its following siblings into the gap; an emptied row is removed
    function removeCard(r, c) {
      if (!c || c._gone) return; c._gone = true;
      c.classList.add('gone');
      setTimeout(function () {
        if (dead) return;
        var idx = r.cs.indexOf(c); if (idx < 0) return;
        var had = N.nav.cur === c, w = r.ws[idx] + 40, s0 = r.tr._s, sh = N.isRtl() ? -w : w;
        r.cs.splice(idx, 1); r.ws.splice(idx, 1); r.d.posts.splice(idx, 1);
        if (c.parentNode) c.parentNode.removeChild(c);
        if (had) N.nav.clear();
        if (!r.d.posts.length) { removeRowAt(defs.indexOf(r.d)); return; } // only the See-all tile (if any) is left
        ui.layoutTrack(r.tr, r.cs, r.ws, 40); r.tr._s = s0;
        var k = defs.indexOf(r.d); if (k >= 0 && mem[k] >= r.cs.length) mem[k] = r.cs.length - 1;
        // FLIP: siblings after the gap start where they were and glide back (transform only)
        var moved = r.cs.slice(idx, idx + 8);
        moved.forEach(function (x) { x.style.transition = 'none'; x.style.transform = 'translateX(' + sh + 'px)'; });
        void r.tr.offsetWidth;
        moved.forEach(function (x) { x.style.transition = 'transform var(--d-move) var(--e-move)'; x.style.transform = ''; });
        setTimeout(function () { moved.forEach(function (x) { x.style.transition = ''; }); }, 500);
        if (had) N.nav.focus(r.cs[Math.min(idx, r.cs.length - 1)]);
        else ui.slideTo(r.tr, r.tr._start + (s0 || 0));
      }, 220);
    }

    function goDetails(p, play) { if (p) N.go('details', { id: p.id, autoplay: play ? 1 : 0 }); }

    /* ---- billboard (hero mode only) ---- */
    function fill(p) {
      ui.txt(bbE.title, N.title(p));
      var o = N.titleAlt(p); ui.txt(bbE.sub, o); bbE.sub.style.display = o ? '' : 'none';
      bbE.meta.innerHTML = ''; bbE.meta.appendChild(ui.meta(p, { genres: 2 }));
      ui.txt(bbE.plot, N.plot(p));
      bbE.title.classList.remove('has-logo');
      if (p._logo) {
        var im = el('img', 'logo'); im.alt = ''; im.decoding = 'async'; bbE.title.appendChild(im); bbE.title.classList.add('has-logo');
        im.onload = function () { im.classList.add('in'); };
        im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); bbE.title.classList.remove('has-logo'); };
        im.src = p._logo;
      }
    }
    function swapBB(p, first) {
      clearTimeout(bbT);
      if (first || document.body.classList.contains('calm')) { fill(p); bb.classList.remove('out'); return; }
      bb.classList.add('out');
      bbT = setTimeout(function () {
        if (dead) return; fill(p); bb.classList.remove('out', 'in-a', 'in-b'); bb.classList.add(flip ? 'in-a' : 'in-b'); flip = !flip;
      }, 120);
    }
    function follow() { clearTimeout(fT); if (dead || !curPost || st.mode !== 'hero') return; if (N.nav.isFast()) return; fT = setTimeout(function () { apply(false); }, 60); }
    function apply(first) {
      if (dead || !curPost) return;
      var key = String(curPost.id);
      if (key !== shownKey) { var f = !shownKey; shownKey = key; swapBB(curPost, f); }
      N.stage.show(curPost, (curImm || first) ? { immediate: true, done: first ? function () { N.splashReady(); } : null } : {});
      curImm = false;
    }

    /* ---- hero mode ---- */
    function heroUiFor(i) {
      var p = heroes[i], kids = dotsEl.children;
      for (var k = 0; k < kids.length; k++) kids[k].classList.toggle('on', k === i);
      playBtn.lastChild.textContent = cwIds[p.id] ? N.t('resume') : N.t('play');
      wlIcon();
    }
    function setHero(i, first) {
      heroIdx = i; var p = heroes[i]; if (!p) return;
      heroUiFor(i);
      if (st.mode !== 'hero') return;
      curPost = p; curImm = true; clearTimeout(fT); apply(!!first);
    }
    // manual slide change: dots/buttons update at once, billboard + backdrop settle after a short debounce
    function heroStep(d) {
      if (heroes.length < 2) return;
      var i = (heroIdx + d + heroes.length) % heroes.length;
      heroNav = lastAct = Date.now();
      heroIdx = i; heroUiFor(i);
      curPost = heroes[i]; curImm = true; clearTimeout(fT); clearTimeout(heroT);
      heroT = setTimeout(function () { if (!dead && st.mode === 'hero') apply(false); }, 200);
    }
    function autoAdvance() {
      if (dead || st.mode !== 'hero' || heroes.length < 2 || document.body.classList.contains('calm') || N.player.open || N.rail.open || document.querySelector('.modal')) return;
      if (Date.now() - lastAct < 9000 || Date.now() - heroNav < 12000) return;
      lastAct = Date.now(); setHero((heroIdx + 1) % heroes.length, false);
    }
    function setRowsRest() { rowsTy = 0; hpage.style.transform = ''; N.stage.offset(0); st.row = -1; }
    function exitBrowse(noFocus) {
      st.mode = 'hero'; root.classList.remove('browse'); setRowsRest(); lastAct = Date.now();
      if (!noFocus) N.nav.focus(playBtn);
    }

    /* ---- browse mode (the billboard and stage art never change here) ---- */
    function enterBrowse() {
      if (st.mode === 'browse') return;
      clearTimeout(heroT); clearTimeout(fT);
      // flush a pending hero swap (heroStep debounce) so billboard + art match heroIdx/dots/Play when we come back
      if (curPost && String(curPost.id) !== shownKey) apply(false);
      st.mode = 'browse'; root.classList.add('browse');
    }
    function windowRow(k, center) {
      var cs = cards[k], from = Math.max(0, center - 2), to = Math.min(cs.length - 1, center + 9);
      for (var i = from; i <= to; i++) ui.load(cs[i]);
    }
    function windowRows(ri) {
      for (var k = 0; k < cards.length; k++) {
        var d = Math.abs(k - ri);
        if (d <= 2) windowRow(k, mem[k] || 0);
        else if (d > 4) for (var i = 0; i < cards[k].length; i++) ui.unload(cards[k][i]);
      }
    }
    function setRow(ri) {
      if (tops[ri] === undefined) return;
      // the guest note sits at the page bottom (y 1020) so the last row stays in full view above it
      var ty = noteEl && ri === defs.length ? 1020 - (HERO_ROWS_TOP + tops[ri] + noteEl.offsetHeight) : ANCHOR - (HERO_ROWS_TOP + tops[ri]);
      if (rowsTy !== ty) { rowsTy = ty; hpage.style.transform = 'translateY(' + ty + 'px)'; N.stage.offset(ty); }
      if (st.row !== ri) { st.row = ri; windowRows(ri); }
    }
    function onCardFocus(ri, i) {
      if (ri < 0 || i < 0) return;
      enterBrowse();
      mem[ri] = i; setRow(ri);
      ui.slideTo(tracks[ri], ui.keepX(tracks[ri], cards[ri][i], rowObjs[ri].ws[i], defs[ri].kind === 'cw' ? 1.08 : 1.1));
      windowRow(ri, i);
    }
    function onnav(dir, cur) {
      var s = (dir === 'left' || dir === 'right') ? ui.step(dir) : 0, hb = heroBtns.indexOf(cur);
      if (hb >= 0) {
        if (dir === 'down') { if (cards.length) return cards[0][Math.min(mem[0] || 0, cards[0].length - 1)]; return noteBtn || true; }
        if (dir === 'up') return true;
        var nb = hb + s;
        if (nb < 0) { if (heroIdx > 0) heroStep(-1); else N.rail.enter(); return true; }
        if (nb >= heroBtns.length) { heroStep(1); return true; }
        return heroBtns[nb];
      }
      if (cur === noteBtn) {
        if (dir === 'up') { if (cards.length) return cards[cards.length - 1][Math.min(mem[cards.length - 1] || 0, cards[cards.length - 1].length - 1)]; return heroes.length ? playBtn : true; }
        if (s < 0) { N.rail.enter(); } return true;
      }
      var ri = -1, i = -1;
      for (var r = 0; r < cards.length && ri < 0; r++) { var ix = cards[r].indexOf(cur); if (ix >= 0) { ri = r; i = ix; } }
      if (ri < 0) return false;
      if (s) {
        var ni = i + s;
        if (ni < 0) { N.rail.enter(); return true; }
        if (ni >= cards[ri].length) { ui.bump(cur, dir); return true; } // row end: swallowed
        return cards[ri][ni];
      }
      if (dir === 'down') {
        if (ri + 1 < cards.length) return cards[ri + 1][Math.min(mem[ri + 1] || 0, cards[ri + 1].length - 1)];
        return noteBtn || true;
      }
      if (dir === 'up') {
        if (ri === 0) return heroes.length ? playBtn : true;
        return cards[ri - 1][Math.min(mem[ri - 1] || 0, cards[ri - 1].length - 1)];
      }
      return true;
    }

    load();
    return {
      destroy: function () {
        dead = true; clearTimeout(fT); clearTimeout(bbT); clearTimeout(heroT); clearInterval(advT); document.removeEventListener('keydown', act);
        N.nav.offSettle(follow); N.stage.cancel();
      },
      // Back in browse returns to the hero (Play focused); in hero mode the router opens the sidebar
      back: function () {
        if (st.mode !== 'browse' || !heroes.length) return false;
        exitBrowse(); return true;
      },
      focusState: function () {
        if (st.mode === 'browse' && N.nav.cur) { for (var r = 0; r < cards.length; r++) { var ix = cards[r].indexOf(N.nav.cur); if (ix >= 0) return { mode: 'browse', key: defs[r].key, row: r, idx: ix, hero: heroIdx }; } }
        return { mode: 'hero', hero: heroIdx };
      }
    };
  };
})();
