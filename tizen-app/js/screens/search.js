/* Search screen: grid keyboard on the start side (letters in a block, function keys below), 4-column poster grid on the end side. */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui, sc = N.sc;

  /* ================= Search ================= */
  var KB = {
    en: { cols: 6, keys: 'abcdefghijklmnopqrstuvwxyz0123456789'.split('') },
    fa: { cols: 7, keys: ['ا', 'آ', 'ب', 'پ', 'ت', 'ث', 'ج', 'چ', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'ژ', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ه', 'ی', 'ئ', 'ء', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] }
  };
  var PW = 560, KH = 72, KG = 10, COLS = 4, ZWNJ = '‌';
  // query normalisation: Persian/Arabic digits -> ASCII, Arabic yeh/kaf -> Persian, collapse blanks. ZWNJ is kept.
  function norm(q) {
    return q.replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 1776); }).replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 1632); })
      .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[ \t]+/g, ' ').replace(/^\s+|\s+$/g, '');
  }
  S.search = function (root, params, restore) {
    var dead = false, seq = 0, timer = null, swT = null, q = (restore && restore.q) || (params && params.q) || '', kbLang = N.store.get('kbLang', 'en'); // English keyboard first: titles are English
    var keys = [], rows = [], cells = [], kMem = null, kX = 0, vMove = false, cLast = 0, wantIdx = restore && restore.idx >= 0 ? restore.idx : -1, langKey = null, micKey = null;
    if (kbLang !== 'fa' && kbLang !== 'en') kbLang = N.lang;
    root.classList.add('search'); N.stage.neutral(true);
    var spage = el('div', 's-page'); root.appendChild(spage);
    var pane = el('div', 's-kbp'); spage.appendChild(pane);
    var qi = el('div', 's-qi'); qi.appendChild(ui.icon('search')); pane.appendChild(qi);
    var field = el('div', 's-q'), qt = el('span', 'qt'), ph = el('span', 'ph-t', N.t('searchPh')), caret = el('i', 'caret');
    field.appendChild(qt); field.appendChild(caret); field.appendChild(ph); pane.appendChild(field);
    var kb = el('div', 'kb'); pane.appendChild(kb);
    var res = el('div', 's-res'), rh = el('div', 'rh'), rg = el('div', 'rgrid'); res.appendChild(rh); res.appendChild(rg); spage.appendChild(res);
    rg.reveal = function (e) { ui.vscroll(res, e._cell || e, 160); };
    var hid = el('input'); hid.type = 'text'; hid.setAttribute('autocomplete', 'off'); hid.style.cssText = 'position:absolute;left:-2000px;top:0;width:10px;height:10px';
    root.appendChild(hid);

    // keys sit at absolute logical x (from the keyboard's own start edge) so up/down can pick the nearest key by centre
    function key(label, x, y, w, cls, fn2) {
      var k = el('button', 'key f fl' + (cls ? ' ' + cls : ''));
      if (typeof label === 'string') k.textContent = label; else k.appendChild(label);
      k.style.width = w + 'px'; k.style.top = y + 'px'; k.style[kbLang === 'fa' ? 'right' : 'left'] = x + 'px';
      k._cx = x + w / 2; k._r = rows.length; k.onclick = fn2; keys.push(k); kb.appendChild(k);
      k.onfocus2 = function () { kMem = k; if (!vMove) kX = k._cx; vMove = false; };
      return k;
    }
    function layout() {
      kb.innerHTML = ''; keys = []; rows = []; kb.dir = kbLang === 'fa' ? 'rtl' : 'ltr'; kb.className = 'kb ' + kbLang;
      var L = KB[kbLang], kw = (PW - (L.cols - 1) * KG) / L.cols, y = 0, r, row;
      for (r = 0; r * L.cols < L.keys.length; r++) {
        row = [];
        L.keys.slice(r * L.cols, (r + 1) * L.cols).forEach(function (c, i) { row.push(key(c, i * (kw + KG), y, kw, '', function () { type(c); })); });
        rows.push(row); y += KH + KG;
      }
      y += 16; // air between letters and function keys
      // function rows on a 6-unit grid: [label, class, action, units]
      var uw = (PW - 5 * KG) / 6, fns = [
        kbLang === 'fa'
          ? [[N.t('space'), '', function () { type(' '); }, 2], [N.t('zwnj'), '', function () { type(ZWNJ); }, 2], ['⌫', 'bs mirror', del, 2]]
          : [[N.t('space'), '', function () { type(' '); }, 4], ['⌫', 'bs', del, 2]],
        [[N.t('clearK'), '', function () { q = ''; changed(); }, 2], [kbLang === 'en' ? 'فا' : 'EN', 'lg', function () {
          kbLang = kbLang === 'en' ? 'fa' : 'en'; N.store.set('kbLang', kbLang); layout(); N.nav.focus(langKey, true);
        }, 2], [ui.icon('mic'), 'mic', function () { hid.value = q; N.nav.focus(hid); }, 2]]
      ];
      fns.forEach(function (f) {
        var x = 0; row = [];
        f.forEach(function (d) { var w = d[3] * uw + (d[3] - 1) * KG, k = key(d[0], x, y, w, 'fn ' + d[1], d[2]); row.push(k); x += w + KG; if (d[1] === 'lg') langKey = k; if (d[1] === 'mic') micKey = k; });
        rows.push(row); y += KH + KG;
      });
      kb.style.height = (y - KG) + 'px';
      kMem = keys[0]; kX = keys[0]._cx;
    }
    // Left/Right follow the keyboard's own direction (physical keys); Up/Down keep the column (nearest key centre).
    // Row ends: towards the UI start edge opens the sidebar, towards the end edge enters the results.
    kb.onnav = function (dir, cur) {
      var row = rows[cur._r], i = row ? row.indexOf(cur) : -1; if (i < 0) return false;
      if (dir === 'up' || dir === 'down') {
        var nr = rows[cur._r + (dir === 'up' ? -1 : 1)]; if (!nr) return true;
        var best = nr[0]; nr.forEach(function (k) { if (Math.abs(k._cx - kX) < Math.abs(best._cx - kX)) best = k; });
        vMove = true; return best;
      }
      var n = i + ((dir === 'right') !== (kbLang === 'fa') ? 1 : -1);
      if (n >= 0 && n < row.length) return row[n];
      if (ui.step(dir) < 0) { N.rail.enter(); return true; }
      if (cells.length) return cells[Math.min(cLast, cells.length - 1)].card;
      return true;
    };
    function type(c) { if (q.length < 60) { q += c; changed(); } }
    function del() { if (q) { q = q.slice(0, -1); changed(); } }
    function paintQ() {
      var fa = N.FA.test(q), lat = !fa && /[A-Za-z]/.test(q);
      qt.textContent = q; ph.style.display = q ? 'none' : '';
      if (q) { qt.dir = fa ? 'rtl' : 'ltr'; field.dir = qt.dir; } else { qt.removeAttribute('dir'); field.removeAttribute('dir'); }
      qt.classList.toggle('latin', lat);
      field.classList.toggle('long', !!q && qt.offsetWidth > field.clientWidth - 20); // keep the end of a long query in view
    }
    // results follow the typing (short pause so every key press does not fire a request)
    function changed() { paintQ(); clearTimeout(timer); timer = setTimeout(run, 350); }
    hid.oninput = function () { q = hid.value; changed(); };
    hid.onenter = function () { hid.blur(); N.nav.focus(micKey, true); clearTimeout(timer); run(); };
    // physical keyboard (desktop testing / USB keyboards); MediaPlayPause = backspace while a key is focused
    function onKeyDown(e) {
      if ((N.player && N.player.open) || document.querySelector('.modal')) return;
      if (e.keyCode === N.keys.PLAYPAUSE) { if (N.nav.cur && kb.contains(N.nav.cur)) { e.preventDefault(); del(); } return; }
      if (document.activeElement === hid || e.ctrlKey || e.altKey || e.metaKey || !e.key || e.key.length !== 1) return;
      type(e.key.toLowerCase());
    }
    document.addEventListener('keydown', onKeyDown);

    function loadAround(i) {
      var row = Math.floor(i / COLS);
      for (var k = Math.max(0, (row - 1) * COLS); k < Math.min(cells.length, (row + 3) * COLS); k++) ui.load(cells[k].card);
    }
    function cellNav(idx) {
      return function (dir, cur) {
        var col = idx % COLS, last = cells.length - 1;
        if (dir === 'up') return idx < COLS ? true : cells[idx - COLS].card;
        if (dir === 'down') { if (cells[idx + COLS]) return cells[idx + COLS].card; return Math.floor(idx / COLS) < Math.floor(last / COLS) ? cells[last].card : true; }
        if (ui.step(dir) > 0) { if (col < COLS - 1 && cells[idx + 1]) return cells[idx + 1].card; ui.bump(cur, dir); return true; }
        if (col > 0) return cells[idx - 1].card;
        return kMem || keys[0]; // first column, towards the start edge: back to the keyboard
      };
    }
    function show(posts, header, msg) {
      clearTimeout(swT); rg.classList.add('sw');
      swT = setTimeout(function () {
        if (dead) return;
        var inGrid = N.nav.cur && rg.contains(N.nav.cur);
        rg.innerHTML = ''; cells = []; cLast = 0; res._ty = null; res.style.transform = '';
        rh.className = 'rh' + (msg ? ' nores' : ''); rh.innerHTML = ''; rh.appendChild(ui.txt(el('span'), msg || header));
        posts.forEach(function (p, i) {
          var cell = ui.cell(p), c = cell.card;
          c.onclick = function () { N.go('details', { id: p.id }); };
          c.onfocus2 = function () { cLast = i; loadAround(i); if (i >= cells.length - 2 * COLS) nextPage(); };
          c.onnav = cellNav(i);
          cells.push(cell); rg.appendChild(cell);
        });
        for (var k = 0; k < Math.min(cells.length, 3 * COLS); k++) ui.load(cells[k].card);
        rg.classList.remove('sw');
        if (wantIdx >= 0) {
          var w = cells[wantIdx]; wantIdx = -1;
          if (w) { sc.instant(root, function () { N.nav.focus(w.card); }); return; }
        }
        if (inGrid || !N.nav.cur) N.nav.focus(kMem || keys[0], true);
      }, 120);
    }
    function popular(msg) {
      var my = seq; // a slow home_stream must not overwrite newer results
      N.getHome().then(function (h) {
        if (dead || my !== seq) return;
        var ps = (h.suggested && h.suggested.posts) || (h.movies && h.movies.posts) || [];
        show(ps.slice(0, 20), N.t('popularNow'), msg);
      }).catch(function () { if (!dead && my === seq) show([], '', msg || N.t('error')); });
    }
    // further result pages, appended when focus nears the end
    var sPage = 1, sPages = 1, sQ = '', sBusy = false;
    function nextPage() {
      if (sBusy || sPage >= sPages || !sQ) return;
      var my = seq, want = sPage + 1; sBusy = true;
      N.api.get('search', { query: sQ, streamonly: 'true', page: want }).then(function (r) {
        sBusy = false; if (dead || my !== seq) return;
        sPage = want; sPages = +(r && r.pages) || sPage;
        sc.extractPosts(r).forEach(function (p) {
          var i = cells.length, cell = ui.cell(p), c = cell.card;
          c.onclick = function () { N.go('details', { id: p.id }); };
          c.onfocus2 = function () { cLast = i; loadAround(i); if (i >= cells.length - 2 * COLS) nextPage(); };
          c.onnav = cellNav(i);
          cells.push(cell); rg.appendChild(cell);
        });
      }, function () { sBusy = false; });
    }
    function run() {
      var qq = norm(q), my = ++seq;
      sQ = ''; sPage = 1; sPages = 1; sBusy = false;
      if (qq.length < 3) { popular(''); return; } // the API rejects queries shorter than 3 letters
      function get(s) { return N.api.get('search', { query: s, streamonly: 'true', page: 1 }); }
      get(qq).then(function (r) {
        if (dead || my !== seq) return null;
        if ((!r || !r.posts || !r.posts.length) && qq.indexOf(ZWNJ) >= 0) return get(qq.replace(/‌/g, ' '));
        return r;
      }).then(function (r) {
        if (!r || dead || my !== seq) return;
        var ps = sc.extractPosts(r);
        if (!ps.length) { popular(N.tf('nothingFor', { q: '⁨' + qq + '⁩' })); return; }
        sQ = r.__q || qq; sPages = +(r && r.pages) || 1;
        show(ps, N.t('topResults'), '');
      }).catch(function () { if (!dead && my === seq) popular(N.t('error')); });
    }
    layout(); paintQ();
    if (restore && keys[restore.k]) kMem = keys[restore.k];
    if (q) run(); else popular('');
    N.nav.focus(kMem || keys[0], true);
    return {
      destroy: function () { dead = true; clearTimeout(timer); clearTimeout(swT); document.removeEventListener('keydown', onKeyDown); },
      focusState: function () { var k = keys.indexOf(kMem); for (var i = 0; i < cells.length; i++) if (cells[i].card === N.nav.cur) return { q: q, idx: i, k: k }; return { q: q, idx: -1, k: k }; }
    };
  };
})();
