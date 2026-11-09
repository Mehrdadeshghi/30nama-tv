/* Shared UI helpers: icons, cards, meta line, track/scroll layout. */
(function () {
  var el = N.el, ui = N.ui = {};
  var NS = 'http://www.w3.org/2000/svg', XL = 'http://www.w3.org/1999/xlink';

  ui.icon = function (name, cls) {
    var s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
    var u = document.createElementNS(NS, 'use'); u.setAttributeNS(XL, 'xlink:href', '#i-' + name); u.setAttribute('href', '#i-' + name);
    s.appendChild(u); return s;
  };
  ui.setIcon = function (svg, name) {
    var u = svg.firstChild; u.setAttributeNS(XL, 'xlink:href', '#i-' + name); u.setAttribute('href', '#i-' + name);
  };
  ui.btn = function (text, fn, cls, icon) {
    var b = el('button', 'btn f fl' + (cls ? ' ' + cls : ''));
    if (icon) b.appendChild(ui.icon(icon));
    b.appendChild(el('span', '', text)); b.onclick = fn; return b;
  };
  // round glyph-only button (72x72)
  ui.circle = function (icon, fn, cls) {
    var b = el('button', 'btn circle f fl' + (cls ? ' ' + cls : ''));
    b.appendChild(ui.icon(icon)); b.onclick = fn; return b;
  };
  // set text; Latin-only strings get dir=ltr + .latin (Vz font, isolated, start-aligned in RTL)
  ui.txt = function (e, s) {
    s = s === undefined || s === null ? '' : String(s); e.textContent = s;
    // Arabic separators/comma (٫ ٬ ،) are punctuation, not Persian text: 'IMDb 8٫5' is still a Latin string
    if (/[A-Za-z]/.test(s) && !N.FA.test(s.replace(/[\u060C\u066B\u066C]/g, ''))) { e.dir = 'ltr'; e.classList.add('latin'); }
    else { e.removeAttribute('dir'); e.classList.remove('latin'); }
    return e;
  };
  ui.pill = function (text, fn, cur) {
    var b = el('button', 'pill f fl' + (cur ? ' cur' : ''), text); b.onclick = fn; return b;
  };

  /* ---------- images ---------- */
  ui.posterUrl = function (p) {
    var po = p && p.image && p.image.poster; if (!po) return '';
    return (po.webp && (po.webp.large || po.webp.medium)) || (po.jpg && (po.jpg.large || po.jpg.medium)) || '';
  };
  ui.coverUrl = function (p) { var c = p && p.image && p.image.cover; return c ? (c.webp || c.jpg || '') : ''; };
  ui.load = function (c) {
    if (c._on || !c._src) return; c._on = true;
    var im = c._im; if (!im) return;
    im.onload = function () { im.classList.add('in'); };
    im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); c._im = null; };
    im.src = c._src;
  };
  ui.unload = function (c) {
    if (!c._on) return; c._on = false;
    var im = c._im; if (im) { im.classList.remove('in'); im.onload = null; im.removeAttribute('src'); }
  };

  /* ---------- cards ---------- */
  // kind: poster | land | cw | ep | top | grid | tile. DOM: .card.f.k-* > i.lift + .art(.ph, img.im, overlays, i.sheen) + .cap(.ct, .cs)
  // o: {rank, image, name, count, cap:{t,s}|false, overlays:[el]}. Returns the focusable .card (c._art, c._im, c._src, c._post).
  ui.card = function (post, kind, o) {
    o = o || {}; var k = kind === 'poster' ? 'p' : kind, c = el('div', 'card f k-' + k), url;
    if (kind === 'land' || kind === 'cw' || kind === 'ep') url = ui.coverUrl(post) || ui.posterUrl(post);
    else if (kind === 'tile') url = o.image || '';
    else url = ui.posterUrl(post);
    c._post = post; c._src = url;
    c.appendChild(el('i', 'lift'));
    if (kind === 'top') {
      c.appendChild(el('div', 'rank', String(o.rank)));
      c.appendChild(el('div', 'rank hi', String(o.rank)));
      if (o.rank >= 10) c.classList.add('wide');
    }
    var art = el('div', 'art'), ph = el('div', 'ph'), phs = el('span');
    ui.txt(phs, kind === 'tile' ? '' : N.title(post)); ph.appendChild(phs); art.appendChild(ph);
    if (url) { var im = el('img', 'im'); im.alt = ''; im.decoding = 'async'; art.appendChild(im); c._im = im; }
    if (kind === 'tile') {
      art.appendChild(el('div', 'shade'));
      art.appendChild(ui.txt(el('div', 'tn'), o.name));
      var hasC = o.count !== undefined && o.count !== null; if (hasC) art.classList.add('has-c');
      art.appendChild(el('div', 'tc', hasC ? N.tf('titlesN', { n: N.fmt.num(o.count) }) : ''));
    }
    if (o.overlays) for (var i = 0; i < o.overlays.length; i++) art.appendChild(o.overlays[i]);
    art.appendChild(el('i', 'sheen'));
    c.appendChild(art); c._art = art;
    if (kind !== 'tile' && kind !== 'top' && o.cap !== false) {
      var cap = el('div', 'cap'), ct = el('div', 'ct'), cs = el('div', 'cs');
      if (o.cap) { ui.txt(ct, o.cap.t); if (o.cap.s instanceof Array) ui.dots(cs, o.cap.s); else ui.txt(cs, o.cap.s); }
      else {
        ui.txt(ct, N.title(post));
        if (kind === 'land') {
          var yr = post.info && post.info.year;
          cs.appendChild(el('span', '', ui.typeLabel(post)));
          if (yr) { cs.appendChild(el('i', 'dot-s')); cs.appendChild(el('span', '', String(yr))); }
        }
      }
      cap.appendChild(ct); cap.appendChild(cs); c.appendChild(cap);
    }
    return c;
  };
  // grid cell: wraps a k-grid card (title-only caption on focus). Returns the cell; cell.card is the focusable.
  ui.cell = function (post) {
    var cell = el('div', 'gcell'), c = ui.card(post, 'grid');
    cell.appendChild(c); cell.card = c; c._cell = cell; return cell;
  };
  // episode tiles (typographic; the API has no stills)
  var GENERIC_EP_EN = /^(season\s*\d+\s*-\s*)?episode\s*\d+$/i, GENERIC_EP_FA = /^(فصل\s*[\d۰-۹]+\s*[-–]\s*)?(قسمت|اپیزود)\s*[\d۰-۹]+$/;
  ui.epName = function (it) {
    var i = (it && it.info) || {}, t = i.title || i.name || (it && it.title);
    if (t && typeof t === 'object') t = (N.lang === 'fa' && t.local) ? t.local : (t.english || t.local);
    t = t ? String(t) : '';
    return (GENERIC_EP_EN.test(t) || GENERIC_EP_FA.test(t)) ? '' : t;
  };
  // k-ep card (tvOS episode tile): cover art + dim/gradient/numeral overlays, caption '.ce' (Episode N · duration) + '.ct' (real name, hidden when empty).
  // o: {progress: 0..1}. Returns the focusable .card (c._src is the cover; load with ui.load).
  ui.epCard = function (it, idx, post, o) {
    o = o || {}; var i = (it && it.info) || {}, n = i.episode || (idx + 1), ov = [];
    ov.push(el('div', 'dim')); ov.push(el('div', 'grad')); ov.push(el('div', 'en tab', String(n)));
    if (o.done) { var wm = el('div', 'watched-m'); wm.appendChild(ui.icon('check')); ov.push(wm); }
    else if (o.progress > 0) { var pb = el('div', 'prog'), pi = el('i'); pi.style.transform = 'scaleX(' + Math.min(1, o.progress) + ')'; pb.appendChild(pi); ov.push(pb); }
    var c = ui.card(post, 'ep', { cap: false, overlays: ov }), ph = c._art.querySelector('.ph');
    if (o.done) c.classList.add('is-watched');
    if (ph) c._art.removeChild(ph);
    c._src = ui.coverUrl(post) || c._src;
    var dur = Number(i.duration || i.time || 0); if (dur > 600) dur = dur / 60;
    var cap = el('div', 'cap'), ce = el('div', 'ce'), ct = el('div', 'ct');
    ce.appendChild(el('span', '', N.tf('epN', { n: n })));
    if (dur) { ce.appendChild(el('i', 'dot-s')); ce.appendChild(el('span', '', N.fmt.dur(dur))); }
    ui.txt(ct, ui.epName(it)); cap.appendChild(ce); cap.appendChild(ct); c.appendChild(cap);
    return c;
  };
  ui.skelCard = function (kind) { var c = el('div', 'card skel k-' + (kind || 'p')); return c; };

  /* ---------- text bits ---------- */
  ui.typeLabel = function (post) {
    var po = post.options || {};
    return po.title_type === 'anime' ? N.t('typeAnime') : po.is_series ? N.t('typeSeries') : N.t('movie');
  };
  // [type, 'N seasons'?] for ui.dots (never a literal '·' next to digits: in fa it reads as a Persian zero)
  ui.typeParts = function (post, withSeasons) {
    var po = post.options || {}, n = +((post.info || {}).seasons) || 0, a = [ui.typeLabel(post)];
    if (withSeasons && po.is_series && n) a.push(N.tf(n === 1 ? 'seasonsN1' : 'seasonsN', { n: n }));
    return a;
  };
  // composed string: spans separated by i.dot-s (empty parts skipped). Returns e.
  ui.dots = function (e, parts) {
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === undefined || parts[i] === null || parts[i] === '') continue;
      if (e.lastChild) e.appendChild(el('i', 'dot-s'));
      e.appendChild(ui.txt(el('span'), parts[i]));
    }
    return e;
  };
  ui.duration = function (min) { return N.fmt.dur(min); };
  // Meta line: [IMDb 7.8] · year · duration · [age] · genres
  ui.meta = function (post, o) {
    if (typeof o === 'number') o = { genres: o };
    var m = el('div', 'meta'), pi = post.info || {}, sc = post.score || {};
    function dot() { if (m.lastChild) m.appendChild(el('i', 'dot-s')); }
    var imdb = +(sc.imdb && sc.imdb.score) || 0;
    if (imdb > 0) m.appendChild(ui.txt(el('span', 'badge l tab'), 'IMDb ' + imdb.toFixed(1))); // Latin badge: ASCII digits and '.' in both languages
    if (pi.year) { dot(); m.appendChild(el('span', 'tab', pi.year + (pi.year_end && pi.year_end !== pi.year && (post.options || {}).is_series ? '–' + pi.year_end : ''))); }
    var d = N.fmt.dur(pi.time && pi.time.default); if (d) { dot(); m.appendChild(el('span', 'tab', d)); }
    if (pi.age) { dot(); m.appendChild(ui.txt(el('span', 'badge o'), pi.age)); }
    if (post.genre && post.genre.length) {
      dot(); m.appendChild(el('span', '', N.fmt.list(post.genre.slice(0, (o && o.genres) || 2).map(function (g) { return g.name; }))));
    }
    return m;
  };

  /* ---------- layout: tracks inside the safe window (N.layout.start..end), vertical scroll ---------- */
  // cards: elements with known widths; sets card._x (logical start incl. leading inset) and track._total/_start/_end
  ui.layoutTrack = function (track, cards, widths, gap, start, end) {
    gap = gap === undefined ? 40 : gap; start = start === undefined ? N.layout.start : start; end = end === undefined ? N.layout.end : end;
    var x = start;
    for (var i = 0; i < cards.length; i++) { cards[i]._x = x; x += widths[i] + gap; }
    track._total = x - gap; track._start = start; track._end = end; track._s = null;
  };
  // translate so logical x sits at the leading edge (clamped so the last card ends at the trailing edge)
  ui.slideTo = function (track, x) {
    var st = track._start || N.layout.start, en = track._end || N.layout.end;
    var s = Math.max(0, x - st), max = Math.max(0, (track._total || 0) - en);
    if (s > max) s = max;
    if (track._s === s) return; track._s = s;
    track.style.transform = 'translateX(' + (N.isRtl() ? s : -s) + 'px)';
  };
  // minimal scroll (tvOS): target x for slideTo that keeps card (width w, focus scale s) inside the safe window
  ui.keepX = function (track, card, w, s) {
    var g = w * ((s || 1) - 1) / 2, st = track._start || N.layout.start, en = track._end || N.layout.end, off = track._s || 0;
    if (card._x + w + g - off > en) off = card._x + w + g - en;
    else if (card._x - g - off < st) off = card._x - g - st;
    return st + Math.max(0, off);
  };
  function topIn(e, box) { var t = 0; while (e && e !== box) { t += e.offsetTop; e = e.offsetParent; } return t; }
  ui.topIn = topIn;
  // keep `target` row at (at most) `anchor` px from the top of the screen
  ui.vscroll = function (box, target, anchor) {
    var ty = -Math.max(0, topIn(target, box) - anchor);
    if (box._ty === ty) return ty; box._ty = ty;
    box.style.transform = 'translateY(' + ty + 'px)'; return ty;
  };
  // edge bump: a horizontal move swallowed at a row end nudges the focused card 8px (physical direction) and back. Never on .k-rev (it scales itself).
  ui.bump = function (e, dir) {
    if (!e || !e.classList || !e.classList.contains('card') || e.classList.contains('k-rev') || document.body.classList.contains('calm')) return;
    var c = dir === 'right' ? 'bump-r' : 'bump-l';
    e.classList.remove('bump-r', 'bump-l'); void e.offsetWidth; e.classList.add(c);
    clearTimeout(e._bumpT); e._bumpT = setTimeout(function () { e.classList.remove(c); }, 200);
  };
  // is `dir` ('left'|'right') towards the end edge in the current direction?
  ui.step = function (dir) { var r = N.isRtl(); return (dir === 'right') !== r ? 1 : -1; };
})();
