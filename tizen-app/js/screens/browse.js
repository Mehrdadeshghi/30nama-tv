/* Browse with filters (Movies / Series / Anime in the sidebar, genre tiles in the archive).
   30nama's advanced search (advanced_search + advanced_search_parameters, the same API the official apps use):
   type, genre, year, IMDb rating, country, language and sort. A filter takes effect as soon as it is chosen; while
   moving through a filter's list the number of matching titles is shown live. Only streamable titles (stream: true).
   Parameter formats verified against the live API (Nov 2026): genre/type are arrays (several = all must match),
   country/language/age are strings, min_year+max_year only together, imdb_rate a number. ES5 only. */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui, sc = N.sc;
  var errorView = sc.errorView, instant = sc.instant, COLS = 6;

  N.addStrings({
    en: { fType: 'Type', fGenre: 'Genre', fYear: 'Year', fImdb: 'IMDb', fCountry: 'Country', fLang: 'Language', fSort: 'Sort',
      fAll: 'All', fAny: 'Any', fReset: 'Reset', fSeries: 'Series', fMini: 'Miniseries', fAnime: 'Anime', fMovie: 'Movies',
      sortImdb: 'IMDb rating', sortYear: 'Release year', sortRel: 'Relevance', sort30: '30nama rating', sortNew: 'Newest', sortPop: 'Popular',
      yThis: 'This year', y20s: '2020s', y10s: '2010s', y00s: '2000s', y90s: '1990s', y80s: '1980s', yOld: 'Before 1980',
      imdbAbove: '{n}+', imdbUnder: 'Under 5', matchN: '{n} titles', matchNone: 'No titles', counting: 'Counting…', noMatch: 'No titles match these filters.' },
    fa: { fType: 'نوع', fGenre: 'ژانر', fYear: 'سال', fImdb: 'IMDb', fCountry: 'کشور', fLang: 'زبان', fSort: 'ترتیب',
      fAll: 'همه', fAny: 'همه', fReset: 'پاک کردن فیلترها', fSeries: 'سریال', fMini: 'مینی‌سریال', fAnime: 'انیمه', fMovie: 'فیلم',
      sortImdb: 'امتیاز IMDb', sortYear: 'سال انتشار', sortRel: 'مرتبط‌ترین', sort30: 'امتیاز سی‌نما', sortNew: 'جدیدترین', sortPop: 'محبوب‌ترین',
      yThis: 'امسال', y20s: 'دهه ۲۰۲۰', y10s: 'دهه ۲۰۱۰', y00s: 'دهه ۲۰۰۰', y90s: 'دهه ۱۹۹۰', y80s: 'دهه ۱۹۸۰', yOld: 'قبل از ۱۹۸۰',
      imdbAbove: 'بالای {n}', imdbUnder: 'زیر ۵', matchN: '{n} عنوان', matchNone: 'عنوانی نیست', counting: 'در حال شمارش…', noMatch: 'عنوانی با این فیلترها پیدا نشد.' }
  });

  /* ---------- filter options (advanced_search_parameters, cached per language for a day) ---------- */
  var pcache = {};
  function params() {
    var lang = N.lang, mem = pcache[lang];
    if (mem) return mem;
    var st = N.store.get('advParams.' + lang, null);
    if (st && st.v && Date.now() - st.t < 864e5) { pcache[lang] = Promise.resolve(st.v); return pcache[lang]; }
    pcache[lang] = N.api.get('advanced_search_parameters', {}).then(function (r) {
      var v = slim(r || {}); N.store.set('advParams.' + lang, { t: Date.now(), v: v }); return v;
    }, function (e) { pcache[lang] = null; if (st && st.v) return st.v; throw e; });
    return pcache[lang];
  }
  function opts(list) { return (list || []).map(function (x) { return { v: x.value, t: String(x.name || x.title || x.value) }; }).filter(function (x) { return x.v !== '' && x.v !== null && x.v !== undefined; }); }
  function slim(r) { return { genre: opts(r.genre), country: opts(r.country), language: opts(r.language), imdb: opts(r.imdb_rate), maxYear: +r.max_year || new Date().getFullYear() }; }

  var TYPES = [['', 'fAll'], ['movie', 'fMovie'], ['series', 'fSeries'], ['miniseries', 'fMini'], ['anime', 'fAnime']];
  var SORTS = [['update', 'sortNew'], ['favorite', 'sortPop'], ['imdb-rate', 'sortImdb'], ['year', 'sortYear'], ['30nama-rate', 'sort30'], ['relevant', 'sortRel']];
  function years(maxY) {
    return [['', 'fAny'], ['this', 'yThis', maxY, maxY], ['20s', 'y20s', 2020, maxY], ['10s', 'y10s', 2010, 2019], ['00s', 'y00s', 2000, 2009],
      ['90s', 'y90s', 1990, 1999], ['80s', 'y80s', 1980, 1989], ['old', 'yOld', 1890, 1979]];
  }
  function imdbLabel(v) { v = +v; return v < 0 ? N.t('imdbUnder') : N.tf('imdbAbove', { n: N.fmt.num(v, v % 1 ? 1 : 0) }); }

  // the request parameters for a filter state f
  function query(f, P) {
    var q = { stream: 'true' };
    if (f.type) q.type = [f.type];
    if (f.genre) q.genre = [f.genre];
    if (f.year) { var y = years(P.maxYear).filter(function (x) { return x[0] === f.year; })[0]; if (y) { q.min_year = y[2]; q.max_year = y[3]; } }
    if (f.imdb !== '' && f.imdb !== undefined && f.imdb !== null) q.imdb_rate = +f.imdb;
    if (f.country) q.country = f.country;
    if (f.language) q.language = f.language;
    return q;
  }
  function search(f, P, page, prio) {
    return N.api.get('advanced_search', { parameters: JSON.stringify(query(f, P)), orderby: f.sort || 'update', order: 'DESC', page: page }, { prio: prio === undefined ? 1 : prio })
      .then(function (r) { return { posts: sc.extractPosts(r), total: +(r && r.total) || 0, pages: +(r && r.pages) || 1 }; });
  }

  // grid nav (same rules as the archive grid): explicit so a row end never jumps far; start edge opens the sidebar
  function gridNav(list, idx, up) {
    return function (dir, cur) {
      var col = idx % COLS, last = list.length - 1;
      if (dir === 'up') return idx < COLS ? up() : list[idx - COLS];
      if (dir === 'down') { if (list[idx + COLS]) return list[idx + COLS]; return Math.floor(idx / COLS) < Math.floor(last / COLS) ? list[last] : true; }
      if (ui.step(dir) > 0) { if (col < COLS - 1 && list[idx + 1]) return list[idx + 1]; ui.bump(cur, dir); return true; }
      if (col > 0) return list[idx - 1];
      N.rail.enter(); return true;
    };
  }

  /* ================= Browse ================= */
  // params: {type: 'movie'|'series'|'anime'|'', genre: slug, nameKey, name}
  S.browse = function (root, prm, restore) {
    var dead = false, P = null, gen = 0, page = 1, pages = 1, total = 0, loading = false, cards = [], cells = [], skels = [], chips = [], chipMem = 0, pop = null, cntT = null, cntGen = 0;
    var skey = 'browseF.' + (prm.type || '') + '.' + (prm.genre || '');
    var saved = (restore && restore.f) || N.store.get(skey, null) || {};
    var f = { type: prm.type || '', genre: prm.genre || '', year: '', imdb: '', country: '', language: '', sort: 'update' };
    for (var k in saved) if (saved.hasOwnProperty(k) && f.hasOwnProperty(k)) f[k] = saved[k];
    var wantIdx = restore && restore.idx > 0 ? restore.idx : -1;

    root.classList.add('archive', 'gridpage', 'browse'); N.stage.neutral(true);
    var box = el('div', 'arch'); root.appendChild(box);
    var head = el('div', 'ah'), ht = el('span', 'ht'), cnt = el('small', 'cnt', '');
    ui.txt(ht, prm.nameKey ? N.t(prm.nameKey) : (prm.name || N.t('archive'))); head.appendChild(ht); head.appendChild(cnt); box.appendChild(head);
    var bar = el('div', 'bfbar scroll'); bar.setAttribute('data-mv', '0'); box.appendChild(bar);   // .scroll: nav.ensureVisible keeps the focused chip in view
    var grid = el('div', 'ggrid'); box.appendChild(grid);
    box.reveal = function (e) { if (e._cell) ui.vscroll(box, e._cell, 260); else { box._ty = 0; box.style.transform = ''; } };

    /* ---------- chips ---------- */
    function label(key) {
      var v = f[key], o;
      if (key === 'type') { o = TYPES.filter(function (x) { return x[0] === v; })[0]; return o ? N.t(o[1]) : N.t('fAll'); }
      if (key === 'sort') { o = SORTS.filter(function (x) { return x[0] === v; })[0]; return o ? N.t(o[1]) : ''; }
      if (key === 'year') { o = years(P.maxYear).filter(function (x) { return x[0] === v; })[0]; return v && o ? N.t(o[1]) : N.t('fAny'); }
      if (key === 'imdb') return v !== '' ? imdbLabel(v) : N.t('fAny');
      var list = key === 'genre' ? P.genre : key === 'country' ? P.country : P.language;
      o = list.filter(function (x) { return String(x.v) === String(v); })[0];
      return v ? (o ? o.t : String(v)) : N.t('fAll');
    }
    var KEYS = [['sort', 'fSort'], ['type', 'fType'], ['genre', 'fGenre'], ['year', 'fYear'], ['imdb', 'fImdb'], ['country', 'fCountry'], ['language', 'fLang']];
    function isSet(key) {
      if (key === 'sort') return false;
      if (key === 'type') return f.type !== (prm.type || '');
      if (key === 'genre') return f.genre !== (prm.genre || '');
      return f[key] !== '' && f[key] !== undefined;
    }
    function anySet() { for (var i = 0; i < KEYS.length; i++) if (isSet(KEYS[i][0])) return true; return false; }
    function buildBar() {
      bar.innerHTML = ''; chips = [];
      KEYS.forEach(function (kk) {
        if (kk[0] === 'type' && prm.type === 'anime') return;   // anime is its own type
        var c = el('button', 'pill f fl bchip' + (isSet(kk[0]) ? ' set' : ''));
        c.appendChild(el('span', 'bk', N.t(kk[1]))); c.appendChild(ui.txt(el('b', 'bv'), label(kk[0])));
        c._key = kk[0]; c.onclick = function () { openPop(c); };
        chips.push(c); bar.appendChild(c);
      });
      if (anySet()) {
        var r = el('button', 'pill f fl bchip reset'); r.appendChild(ui.icon('x')); r.appendChild(el('span', '', N.t('fReset')));
        r._key = 'reset'; r.onclick = function () { var t0 = prm.type || '', g0 = prm.genre || ''; f.type = t0; f.genre = g0; f.year = ''; f.imdb = ''; f.country = ''; f.language = ''; applied(null, 'sort'); };   // the chips are rebuilt: focus a new one
        chips.push(r); bar.appendChild(r);
      }
      chips.forEach(function (c, i) {
        c.onfocus2 = function () { chipMem = i; box.reveal(c); };
        c.onnav = function (dir) {
          if (dir === 'up') return true;
          if (dir === 'down') return cards.length ? cards[0] : (grid.querySelector('.f') || true);
          var n = i + ui.step(dir);
          if (n < 0) { N.rail.enter(); return true; }
          return chips[n] || true;
        };
      });
    }
    function chipFor(key) { for (var i = 0; i < chips.length; i++) if (chips[i]._key === key) return chips[i]; return chips[0]; }

    /* ---------- popover with the options of one filter; the count of matches follows the focused row ---------- */
    function optionsFor(key) {
      if (key === 'type') return TYPES.map(function (x) { return { v: x[0], t: N.t(x[1]) }; });
      if (key === 'sort') return SORTS.map(function (x) { return { v: x[0], t: N.t(x[1]) }; });
      if (key === 'year') return years(P.maxYear).map(function (x) { return { v: x[0], t: N.t(x[1]) }; });
      if (key === 'imdb') return [{ v: '', t: N.t('fAny') }].concat(P.imdb.map(function (x) { return { v: x.v, t: imdbLabel(x.v) }; }));
      var list = key === 'genre' ? P.genre : key === 'country' ? P.country : P.language;
      return [{ v: '', t: N.t('fAll') }].concat(list);
    }
    function openPop(chip) {
      if (pop || !P) return;
      var key = chip._key, list = optionsFor(key), box2 = el('div', 'bpop'), ph = el('div', 'bp-h'), cntE = el('div', 'bp-c'), lst = el('div', 'bp-l'), rows = [], sel = null;
      ph.appendChild(el('span', '', chip.querySelector('.bk').textContent)); ph.appendChild(cntE);
      box2.appendChild(ph); box2.appendChild(lst);
      list.forEach(function (o, i) {
        var r = el('div', 'chk f fl' + (String(o.v) === String(f[key]) ? ' sel' : ''));
        r.appendChild(ui.icon('check')); r.appendChild(ui.txt(el('span'), o.t));
        r.onclick = function () { choose(key, o.v); };
        r.onnav = function (dir) {
          if (dir === 'left' || dir === 'right') return true;
          return rows[i + (dir === 'up' ? -1 : 1)] || true;
        };
        r.onfocus2 = function () { countFor(key, o.v, cntE); };
        lst.appendChild(r); rows.push(r); if (String(o.v) === String(f[key])) sel = r;
      });
      lst.reveal = function (r) {
        var a = r.offsetTop, b = a + r.offsetHeight;
        if (a - 10 < lst.scrollTop) lst.scrollTop = Math.max(0, a - 10);
        else if (b + 10 > lst.scrollTop + lst.clientHeight) lst.scrollTop = b + 10 - lst.clientHeight;
      };
      // under its chip, kept on screen
      root.appendChild(box2);
      var cr = chip.getBoundingClientRect(), rr = root.getBoundingClientRect(), sx = rr.width / 1920 || 1;
      var x = (N.isRtl() ? cr.right - rr.left - 560 * sx : cr.left - rr.left) / sx; x = Math.max(60, Math.min(1920 - 60 - 560, x));   // fa: under the chip's right edge
      box2.style.left = x + 'px'; box2.style.top = ((cr.bottom - rr.top) / sx + 16) + 'px';
      pop = { el: box2, chip: chip };
      N.nav.pushScope(box2); void box2.offsetWidth; box2.classList.add('show');
      var r0 = sel || rows[0]; N.nav.focus(r0, true); lst.reveal(r0);
    }
    function closePop(refocus) {
      if (!pop) return; var p = pop; pop = null; cntGen++; clearTimeout(cntT);
      N.nav.popScope(); if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
      if (refocus !== false) N.nav.focus(chipFor(p.chip._key), true);
    }
    // live count: what the grid would show with this option (debounced; stale answers are dropped)
    function countFor(key, v, out) {
      clearTimeout(cntT); var my = ++cntGen;
      if (String(v) === String(f[key])) { out.textContent = total ? N.tf('matchN', { n: N.fmt.num(total) }) : ''; return; }
      out.textContent = N.t('counting');
      cntT = setTimeout(function () {
        var g = {}; for (var x in f) if (f.hasOwnProperty(x)) g[x] = f[x]; g[key] = v;
        search(g, P, 1, 2).then(function (r) { if (!dead && my === cntGen) out.textContent = r.total ? N.tf('matchN', { n: N.fmt.num(r.total) }) : N.t('matchNone'); },
          function () { if (!dead && my === cntGen) out.textContent = ''; });
      }, 450);
    }
    function choose(key, v) {
      var same = String(f[key]) === String(v);
      closePop(false); f[key] = v;
      if (same) { N.nav.focus(chipFor(key), true); return; }
      applied(null, key);
    }
    // new filter state: remember it, redraw the chips, reload the grid (stale pages are dropped via gen)
    function applied(focusChip, key) {
      N.store.set(skey, { type: f.type, genre: f.genre, year: f.year, imdb: f.imdb, country: f.country, language: f.language, sort: f.sort });
      buildBar();
      N.nav.focus(focusChip || chipFor(key) || chips[0], true);
      reset();
    }

    /* ---------- grid ---------- */
    function addSkels(n) { for (var i = 0; i < n; i++) { var c = el('div', 'gcell sk'); c.appendChild(el('div', 'sk-p')); skels.push(c); grid.appendChild(c); } }
    function clearSkels() { skels.forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); }); skels = []; }
    function upFromGrid() { return chips[Math.min(chipMem, chips.length - 1)] || true; }
    function noRes() { grid.appendChild(el('div', 'bmsg', N.t('noMatch'))); }
    function reset() {
      gen++; loading = false; page = 1; pages = 1; total = 0; cells = []; cards = []; grid.innerHTML = ''; skels = []; cnt.textContent = '';
      box.style.transition = 'none'; box._ty = null; box.style.transform = ''; void box.offsetWidth; box.style.transition = '';
      load();
    }
    function more() { if (!loading && page <= pages) load(); }
    function load() {
      if (loading) return; loading = true; var my = gen; addSkels(page === 1 ? 12 : 6);
      search(f, P, page).then(function (r) {
        if (dead || my !== gen) return;
        loading = false; clearSkels(); page++;
        total = r.total; pages = r.pages || 1;
        cnt.textContent = total ? N.tf('titlesN', { n: N.fmt.num(total) }) : '';
        r.posts.forEach(function (p) {
          var cell = ui.cell(p), idx = cells.length, c = cell.card;
          c.onclick = function () { N.go('details', { id: p.id }); };
          c.onfocus2 = function () {
            var row = Math.floor(idx / COLS), rows = Math.ceil(cells.length / COLS);
            for (var q = 0; q < cards.length; q++) { var rq = Math.floor(q / COLS); if (rq >= row - 1 && rq <= row + 3) ui.load(cards[q]); else if (rq < row - 6 || rq > row + 8) ui.unload(cards[q]); }
            if (row >= rows - 2) more();
          };
          c.onnav = gridNav(cards, idx, upFromGrid);
          cells.push(cell); cards.push(c); grid.appendChild(cell);
        });
        for (var q = 0; q < Math.min(cards.length, 3 * COLS); q++) ui.load(cards[q]);
        if (!cards.length) { noRes(); return; }
        if (wantIdx >= 0) {
          if (wantIdx < cards.length) { var w = cards[wantIdx]; wantIdx = -1; instant(root, function () { N.nav.focus(w, true); box.reveal(w); }); }
          else if (page <= pages) load(); else { wantIdx = -1; }
        }
      }).catch(function (e) {
        if (dead || my !== gen) return;
        loading = false; clearSkels();
        if (!cells.length) { var m = el('div', 'bmsg f', N.t('error') + ' – ' + N.t('retry') + ': OK'); grid.appendChild(m); m.onclick = function () { reset(); }; m.onnav = function (dir) { if (dir === 'up') return upFromGrid(); return true; }; }
        else N.toast(N.t('error'), 2500);
      });
    }

    function start(p) {
      if (dead) return; P = p;
      if (sk.parentNode) sk.parentNode.removeChild(sk);
      buildBar();
      if (wantIdx < 0) N.nav.focus(chips[Math.min((restore && restore.chip) || 0, chips.length - 1)] || chips[0], true);
      load();
    }
    var sk = el('div', 'msg', N.t('loading')); sk.style.cssText = 'position:absolute;top:300px;inset-inline-start:90px'; root.appendChild(sk);
    params().then(start).catch(function (e) { if (!dead) errorView(root, e, function () { N.go('browse', prm, { replace: true }); }); });

    return {
      destroy: function () { dead = true; clearTimeout(cntT); if (pop) { N.nav.popScope(); pop = null; } },
      back: function () { if (pop) { closePop(); return true; } return false; },
      focusState: function () { var i = cards.indexOf(N.nav.cur); return { idx: i, chip: chipMem, f: { type: f.type, genre: f.genre, year: f.year, imdb: f.imdb, country: f.country, language: f.language, sort: f.sort } }; }
    };
  };
})();
