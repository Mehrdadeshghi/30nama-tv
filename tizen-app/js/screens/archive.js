/* Archive: browse root (categories shelf + genre tiles) and the paged 6-column grid page (category / genre / My List). */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui, sc = N.sc;
  var errorView = sc.errorView, instant = sc.instant;

  /* ================= Archive ================= */
  var menuCache = {}; // keyed by language (menu names come back localised)
  // localized category/genre name for a slug from the current language's menu ('' when not cached yet)
  function menuName(slug) {
    var m = menuCache[N.lang], all = m ? (m.categories || []).concat(m.genres || []) : [];
    for (var i = 0; i < all.length; i++) if (all[i].slug === slug) return all[i].name;
    return '';
  }
  function imgUrl(im) { im = im || {}; return (im.webp && (im.webp.full || im.webp.thumb)) || (im.jpg && (im.jpg.full || im.jpg.thumb)) || ''; }
  // grid nav (COLS per row, UI direction): explicit so a row end never jumps to a far element; start edge opens the sidebar
  function gridNav(list, idx, cols, up) {
    return function (dir, cur) {
      var col = idx % cols, last = list.length - 1;
      if (dir === 'up') return idx < cols ? (up ? up() : true) : list[idx - cols];
      if (dir === 'down') { if (list[idx + cols]) return list[idx + cols]; return Math.floor(idx / cols) < Math.floor(last / cols) ? list[last] : true; }
      if (ui.step(dir) > 0) { if (col < cols - 1 && list[idx + 1]) return list[idx + 1]; ui.bump(cur, dir); return true; }
      if (col > 0) return list[idx - 1];
      N.rail.enter(); return true;
    };
  }
  S.archive = function (root, params, restore) {
    if (params && (params.slug || params.list)) return archiveList(root, params, restore);
    var dead = false, cats = [], gens = [], cMem = 0;
    root.classList.add('archive'); N.stage.neutral(true);
    var box = el('div', 'arch'); root.appendChild(box);
    box.reveal = function (e) { ui.vscroll(box, e._row || e, 200); };
    var sk = el('div', 'msg', N.t('loading')); sk.style.cssText = 'position:absolute;top:300px;inset-inline-start:90px'; root.appendChild(sk);
    function show(m) {
      if (dead) return; if (sk.parentNode) root.removeChild(sk);
      box.appendChild(el('div', 'ah', N.t('archive')));
      // categories shelf (minimal scroll)
      var cs = el('div', 'a-sec cats'), track = el('div', 'a-track');
      cs.appendChild(el('div', 'sec-h', N.t('categories'))); cs.appendChild(track); box.appendChild(cs);
      (m.categories || []).forEach(function (c, i) {
        var card = ui.card({ id: c.id, title: { english: c.name } }, 'tile', { image: imgUrl(c.image), name: c.name }); // no count: the menu counts include unplayable titles, the grid (streamonly) does not
        card.onclick = function () { N.go('archive', { slug: c.slug, name: c.name }); };
        card.onfocus2 = function () { cMem = i; ui.slideTo(track, ui.keepX(track, card, 404, 1.08)); };
        card._row = cs; track.appendChild(card); cats.push(card); ui.load(card);
      });
      ui.layoutTrack(track, cats, cats.map(function () { return 404; }), 40);
      track.onnav = function (dir, cur) {
        var i = cats.indexOf(cur); if (i < 0) return false;
        if (dir === 'up') return true;
        if (dir === 'down') return gens.length ? gens[0] : true;
        var n = i + ui.step(dir);
        if (n < 0) { N.rail.enter(); return true; }
        if (!cats[n]) ui.bump(cur, dir);
        return cats[n] || true;
      };
      // genre tiles: 4 x 404
      var gs = el('div', 'a-sec gens'), grid = el('div', 'a-grid');
      gs.appendChild(el('div', 'sec-h', N.t('genres'))); gs.appendChild(grid); box.appendChild(gs);
      (m.genres || []).forEach(function (g, i) {
        var c = ui.card({ id: g.id, title: { english: g.name } }, 'tile', { image: imgUrl(g.image), name: g.name });
        c.onclick = function () { N.go('browse', { genre: g.slug, name: g.name }); };   // genre page with all filters
        c.onfocus2 = function () { for (var k = Math.max(0, i - 8); k < Math.min(gens.length, i + 9); k++) ui.load(gens[k]); };
        c.onnav = gridNav(gens, i, 4, function () { return cats[cMem] || cats[0] || true; });
        if (i < 4) c._row = gs;
        grid.appendChild(c); gens.push(c); if (i < 16) ui.load(c);
      });
      var want = restore && restore.g !== undefined ? gens[restore.g] : (restore && restore.c !== undefined ? cats[restore.c] : null);
      if (want) instant(root, function () { N.nav.focus(want); });
      else N.nav.focus(cats[0] || gens[0], true);
    }
    var lang = N.lang;
    if (menuCache[lang]) show(menuCache[lang]);
    else N.api.get('menu').then(function (m) { menuCache[lang] = m; show(m); }).catch(function (e) { if (!dead) errorView(root, e, function () { N.go('archive', {}, { replace: true }); }); });
    return {
      destroy: function () { dead = true; },
      focusState: function () { var i = cats.indexOf(N.nav.cur); if (i >= 0) return { c: i }; i = gens.indexOf(N.nav.cur); return i >= 0 ? { g: i } : null; }
    };
  };

  // orderby values the API knows (advanced_search / archive): 'date' was not one of them (silently = relevant)
  var SORTS = [['update', 'newest'], ['favorite', 'popular'], ['imdb-rate', 'sortImdb'], ['year', 'sortYear']];
  function archiveList(root, params, restore) {
    var dead = false, page = 1, pages = 1, loading = false, total = 0, cells = [], cards = [], skels = [], sort = (restore && restore.sort) || 'update', wantIdx = restore && restore.idx || 0, restoring = !!(restore && restore.idx > 0), gen = 0, COLS = 6;
    var isList = !!params.list;
    root.classList.add('archive', 'gridpage'); N.stage.neutral(true);
    var box = el('div', 'arch'); root.appendChild(box);
    var head = el('div', 'ah'), ht = el('span', 'ht'), cnt = el('small', 'cnt', '');
    // names resolve at render in the current language: nameKey (rail) via N.t, slugs via the language-keyed menu
    ui.txt(ht, params.nameKey ? N.t(params.nameKey) : (menuName(params.slug) || params.name || params.slug)); head.appendChild(ht);
    if (!params.nameKey && !isList && !menuCache[N.lang]) {
      var ml = N.lang;
      N.api.get('menu').then(function (m) { menuCache[ml] = m; var nm = !dead && ml === N.lang && menuName(params.slug); if (nm) ui.txt(ht, nm); }).catch(function () {});
    } head.appendChild(cnt); box.appendChild(head);
    var sorts = el('div', 'sorts'); if (!isList) box.appendChild(sorts);
    var grid = el('div', 'ggrid'); box.appendChild(grid);
    box.reveal = function (e) { ui.vscroll(box, e._cell || e, 180); };
    SORTS.forEach(function (s) {
      var p = ui.pill(N.t(s[1]), function () { if (sort === s[0]) return; sort = s[0]; paint(); reset(); }, sort === s[0]); p._k = s[0]; sorts.appendChild(p);
      p.onnav = function (dir) { if (dir === 'down') return cards[0] || true; if (dir === 'up') return true; return false; };
    });
    function curSort() { for (var i = 0; i < sorts.children.length; i++) if (sorts.children[i]._k === sort) return sorts.children[i]; return sorts.firstChild; }
    function paint() { for (var i = 0; i < sorts.children.length; i++) sorts.children[i].classList.toggle('cur', sorts.children[i]._k === sort); }
    function addSkels(n) { for (var i = 0; i < n; i++) { var c = el('div', 'gcell sk'); c.appendChild(el('div', 'sk-p')); skels.push(c); grid.appendChild(c); } }
    function clearSkels() { skels.forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); }); skels = []; }
    function reset() {
      gen++; loading = false; page = 1; pages = 1; cells = []; cards = []; grid.innerHTML = ''; skels = []; box.style.transition = 'none'; box._ty = null; box.style.transform = ''; void box.offsetWidth; box.style.transition = '';
      wantIdx = 0; restoring = false; load();
    }
    function fetchPage() {
      if (isList) return N.lists.listPosts(params.list, page);
      return N.api.get('archive', { slugs: params.slug, streamonly: 'true', page: page, orderby: sort, order: 'DESC' }).then(function (r) {
        return { posts: sc.extractPosts(r), total: r && r.total, pages: r && r.pages };
      });
    }
    function empty() {
      var m = el('div', 'nores f', N.t('emptyList')); box.appendChild(m);
      m.onnav = function (dir) { if ((dir === 'left' || dir === 'right') && ui.step(dir) < 0) N.rail.enter(); return true; };
      N.nav.focus(m, true);
    }
    // `page` = the page to fetch next; it only moves on after that page arrived (a failed page is fetched again)
    function more() { if (!loading && page <= pages) load(); }
    function load() {
      if (loading) return; loading = true; var my = gen; addSkels(page === 1 ? 12 : 6);
      fetchPage().then(function (r) {
        if (dead || my !== gen) return;
        loading = false; clearSkels(); page++;
        var first = cells.length === 0;
        total = r.total || total; pages = r.pages || 1;
        if (total) cnt.textContent = N.tf('titlesN', { n: N.fmt.num(total) });
        (r.posts || []).forEach(function (p) {
          var cell = ui.cell(p), idx = cells.length, c = cell.card;
          c.onclick = function () { N.go('details', { id: p.id }); };
          c.onfocus2 = function () {
            var row = Math.floor(idx / COLS), rows = Math.ceil(cells.length / COLS);
            for (var k = 0; k < cards.length; k++) {   // posters near the view load, far ones are released (TV memory)
              var rr = Math.floor(k / COLS);
              if (rr >= row - 1 && rr <= row + 3) ui.load(cards[k]); else if (rr < row - 6 || rr > row + 8) ui.unload(cards[k]);
            }
            if (row >= rows - 2) more();
          };
          c.onnav = gridNav(cards, idx, COLS, isList ? null : curSort);
          cells.push(cell); cards.push(c); grid.appendChild(cell);
        });
        for (var k = 0; k < Math.min(cells.length, 3 * COLS); k++) ui.load(cards[k]);
        if (first && !cells.length) { if (isList) empty(); else N.nav.focus(curSort(), true); return; }
        if (first && !restoring) N.nav.focus(cards[0], true);
        if (restoring) {
          if (wantIdx < cells.length) { restoring = false; instant(root, function () { N.nav.focus(cards[wantIdx], true); box.reveal(cards[wantIdx]); }); }
          else if (page <= pages) load(); else { restoring = false; N.nav.focus(cards[0], true); }
        }
      }).catch(function (e) {
        if (dead || my !== gen) return;
        loading = false; clearSkels();
        if (!cells.length) errorView(root, e, function () { N.go('archive', params, { replace: true }); });
        else N.toast(N.t('error'), 2500);   // the next move near the end tries this page again
      });
    }
    load();
    return {
      destroy: function () { dead = true; },
      focusState: function () { var i = cards.indexOf(N.nav.cur); return i >= 0 ? { idx: i, sort: sort } : null; }
    };
  }
})();
