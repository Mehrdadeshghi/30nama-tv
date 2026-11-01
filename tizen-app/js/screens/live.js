/* Live TV (fork addition): Iranian and Persian-language channels from public playlists, a channel grid with
   favourites and categories, and a full-screen live player (channel up/down, number entry, channel list).
   Sources are the public M3U lists of iptv-org (only streams the broadcasters offer for free). Nothing is
   reported to 30nama. ES5 only. */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui, K = N.keys, $ = N.$;

  N.config.liveSources = N.config.liveSources || [
    'https://iptv-org.github.io/iptv/countries/ir.m3u',
    'https://iptv-org.github.io/iptv/languages/fas.m3u'
  ];
  var CACHE_MS = 6 * 3600 * 1000;
  var CH_UP = [427, 33], CH_DOWN = [428, 34];     // Samsung ChannelUp/Down, LG PageUp/PageDown

  N.addStrings({
    en: {
      live: 'Live TV', liveAll: 'All', liveFav: 'Favorites', liveChN: '{n} channels', liveLoading: 'Loading channels…',
      liveNone: 'No channels found.', liveFailT: 'This channel is not available right now',
      liveFailGeo: 'The broadcaster only allows viewers in Iran.', liveFailHint: 'Up / Down: next channel · OK: channel list',
      liveFavOn: 'Added to favorites', liveFavOff: 'Removed from favorites', liveHold: 'Hold OK: add to favorites',
      liveGeo: 'Iran only', liveSrc: 'Public channels (iptv-org)', liveList: 'Channels', liveBadge: 'LIVE',
      lc_news: 'News', lc_sports: 'Sports', lc_kids: 'Kids', lc_music: 'Music', lc_movies: 'Movies', lc_series: 'Series',
      lc_religious: 'Religious', lc_general: 'General', lc_entertainment: 'Entertainment', lc_documentary: 'Documentary',
      lc_culture: 'Culture', lc_education: 'Education', lc_legislative: 'Parliament', lc_business: 'Business',
      lc_lifestyle: 'Lifestyle', lc_family: 'Family', lc_cooking: 'Cooking', lc_animation: 'Animation', lc_classic: 'Classic',
      lc_comedy: 'Comedy', lc_travel: 'Travel', lc_science: 'Science', lc_outdoor: 'Outdoor', lc_auto: 'Auto', lc_weather: 'Weather',
      lc_undefined: 'Other'
    },
    fa: {
      live: 'پخش زنده', liveAll: 'همه', liveFav: 'علاقه‌مندی‌ها', liveChN: '{n} شبکه', liveLoading: 'در حال دریافت شبکه‌ها…',
      liveNone: 'هیچ شبکه‌ای پیدا نشد.', liveFailT: 'این شبکه الان در دسترس نیست',
      liveFailGeo: 'این شبکه فقط برای بینندگان داخل ایران پخش می‌شود.', liveFailHint: 'بالا / پایین: شبکهٔ بعدی · OK: فهرست شبکه‌ها',
      liveFavOn: 'به علاقه‌مندی‌ها اضافه شد', liveFavOff: 'از علاقه‌مندی‌ها حذف شد', liveHold: 'نگه‌داشتن OK: افزودن به علاقه‌مندی‌ها',
      liveGeo: 'فقط ایران', liveSrc: 'شبکه‌های عمومی (iptv-org)', liveList: 'شبکه‌ها', liveBadge: 'زنده',
      lc_news: 'خبری', lc_sports: 'ورزشی', lc_kids: 'کودک', lc_music: 'موسیقی', lc_movies: 'فیلم', lc_series: 'سریال',
      lc_religious: 'مذهبی', lc_general: 'عمومی', lc_entertainment: 'سرگرمی', lc_documentary: 'مستند',
      lc_culture: 'فرهنگی', lc_education: 'آموزشی', lc_legislative: 'مجلس', lc_business: 'اقتصادی',
      lc_lifestyle: 'سبک زندگی', lc_family: 'خانواده', lc_cooking: 'آشپزی', lc_animation: 'انیمیشن', lc_classic: 'کلاسیک',
      lc_comedy: 'طنز', lc_travel: 'سفر', lc_science: 'علمی', lc_outdoor: 'طبیعت', lc_auto: 'خودرو', lc_weather: 'هواشناسی',
      lc_undefined: 'سایر'
    }
  });

  /* ================= channel list ================= */
  // "#EXTINF:-1 tvg-id=".." tvg-logo=".." group-title="News",IRINN (720p) [Geo-blocked]" + optional #EXTVLCOPT lines + URL
  function parseM3U(txt) {
    var lines = String(txt || '').split(/\r?\n/), out = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/^\s+|\s+$/g, '');
      if (!l) continue;
      if (/^#EXTINF/i.test(l)) {
        cur = { attrs: {}, hdr: false };
        var re = /([\w-]+)="([^"]*)"/g, m;
        while ((m = re.exec(l))) cur.attrs[m[1].toLowerCase()] = m[2];
        var q = false, c = -1;
        for (var j = 7; j < l.length; j++) { var ch = l.charAt(j); if (ch === '"') q = !q; else if (ch === ',' && !q) { c = j; break; } }
        cur.raw = c >= 0 ? l.slice(c + 1) : '';
      } else if (/^#EXTVLCOPT:http-(referrer|user-agent)/i.test(l)) { if (cur) cur.hdr = true; }
      else if (l.charAt(0) !== '#' && cur && /^https?:\/\//i.test(l)) { cur.url = l; out.push(cur); cur = null; }
    }
    return out.map(function (e) {
      var raw = e.raw, flags = [], qm = /\((\d{3,4}p)\)/.exec(raw);
      raw.replace(/\[([^\]]+)\]/g, function (_, f) { flags.push(f.toLowerCase()); return ''; });
      var name = raw.replace(/\s*\(\d{3,4}p\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/^\s+|\s+$/g, '') || (e.attrs['tvg-name'] || 'TV');
      var grp = String(e.attrs['group-title'] || '').split(';')[0].toLowerCase().replace(/^\s+|\s+$/g, '') || 'undefined';
      return {
        name: name, url: e.url, logo: e.attrs['tvg-logo'] || '', id: e.attrs['tvg-id'] || '', group: grp,
        q: qm ? parseInt(qm[1], 10) : 0, geo: flags.join(' ').indexOf('geo') >= 0, part: flags.join(' ').indexOf('24/7') >= 0, hdr: e.hdr
      };
    });
  }
  function key(c) { return (c.id || c.name).toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, ''); }
  function merge(lists) {
    var byKey = {}, order = [];
    lists.forEach(function (l) {
      l.forEach(function (c) {
        var k = key(c), o = byKey[k];
        if (!o) { byKey[k] = c; order.push(k); return; }
        if (o.url === c.url) return;
        // two streams of the same channel: keep the better one (no extra headers, not geo-blocked, higher quality)
        var sc = function (x) { return (x.hdr ? 0 : 4) + (x.geo ? 0 : 2) + (x.q >= 720 ? 1 : 0); };
        if (sc(c) > sc(o)) { c.logo = c.logo || o.logo; byKey[k] = c; }
      });
    });
    var all = order.map(function (k) { return byKey[k]; });
    // usable first: no special headers, not geo-blocked, 24/7; then alphabetical
    all.sort(function (a, b) {
      var d = (a.hdr - b.hdr) || (a.geo - b.geo) || (a.part - b.part);
      return d || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    return all;
  }
  var L = N.live = { channels: null, loading: null };
  L.load = function (force) {
    var c = N.store.get('live.cache', null);
    if (!force && c && c.list && c.list.length && Date.now() - c.t < CACHE_MS) { L.channels = c.list; return Promise.resolve(c.list); }
    if (L.loading) return L.loading;
    L.loading = Promise.all(N.config.liveSources.map(function (u) {
      return N.fetch(u).then(function (r) { if (!r.ok) throw new Error('m3u ' + r.status); return r.text(); })
        .then(parseM3U, function () { return []; });
    })).then(function (lists) {
      L.loading = null;
      var all = merge(lists);
      if (!all.length) { if (c && c.list && c.list.length) { L.channels = c.list; return c.list; } throw new Error('no channels'); }
      L.channels = all; N.store.set('live.cache', { t: Date.now(), list: all });
      return all;
    }, function (e) { L.loading = null; if (c && c.list) { L.channels = c.list; return c.list; } throw e; });
    return L.loading;
  };
  L.favs = function () { return N.store.get('live.favs', []); };
  L.isFav = function (ch) { return L.favs().indexOf(key(ch)) >= 0; };
  L.toggleFav = function (ch) {
    var f = L.favs(), k = key(ch), i = f.indexOf(k);
    if (i >= 0) f.splice(i, 1); else f.push(k);
    N.store.set('live.favs', f); N.toast(N.t(i >= 0 ? 'liveFavOff' : 'liveFavOn'), 1800);
    return i < 0;
  };
  L.catName = function (g) { var t = N.t('lc_' + g); return t === 'lc_' + g ? g : t; };

  /* ================= screen ================= */
  var COLS = 6;
  function gridNav(list, idx, up) {
    return function (dir, cur) {
      var col = idx % COLS, last = list.length - 1;
      if (dir === 'up') return idx < COLS ? (up ? up() : true) : list[idx - COLS];
      if (dir === 'down') { if (list[idx + COLS]) return list[idx + COLS]; return Math.floor(idx / COLS) < Math.floor(last / COLS) ? list[last] : true; }
      if (ui.step(dir) > 0) { if (col < COLS - 1 && list[idx + 1]) return list[idx + 1]; ui.bump(cur, dir); return true; }
      if (col > 0) return list[idx - 1];
      N.rail.enter(); return true;
    };
  }
  function chCard(ch, num) {
    var c = el('div', 'card f k-ch'), art = el('div', 'art');
    c.appendChild(el('i', 'lift'));
    art.appendChild(el('div', 'chn tab', String(num)));
    var ph = el('div', 'ph'); ph.appendChild(ui.txt(el('span'), ch.name)); art.appendChild(ph);
    if (ch.logo) { var im = el('img', 'im'); im.alt = ''; im.decoding = 'async'; art.appendChild(im); c._im = im; c._src = ch.logo; }
    if (L.isFav(ch)) c.classList.add('fav');
    art.appendChild(el('i', 'favdot'));
    art.appendChild(el('i', 'sheen'));
    c.appendChild(art); c._art = art;
    var cap = el('div', 'cap'), ct = el('div', 'ct'), cs = el('div', 'cs');
    ui.txt(ct, ch.name);
    ui.dots(cs, [L.catName(ch.group), ch.q ? ch.q + 'p' : '', ch.geo ? N.t('liveGeo') : '']);
    cap.appendChild(ct); cap.appendChild(cs); c.appendChild(cap);
    return c;
  }

  // logos: own lazy loader (hides the name placeholder once a logo is there; drops broken logos)
  function chLoad(c) {
    if (!c || c._on || !c._src || !c._im) return; c._on = true;
    var im = c._im;
    im.onload = function () { im.classList.add('in'); c.classList.add('ok'); };
    im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); c._im = null; };
    im.src = c._src;
  }

  S.live = function (root, params, restore) {
    var dead = false, cards = [], pills = [], filter = (restore && restore.f) || 'all', list = [];
    root.classList.add('live-s'); N.stage.neutral(true);
    var box = el('div', 'arch'); root.appendChild(box);
    var head = el('div', 'ah'), ht = el('span', 'ht', N.t('live')), cnt = el('small', 'cnt', '');
    head.appendChild(ht); head.appendChild(cnt); box.appendChild(head);
    var bar = el('div', 'lv-pills'); box.appendChild(bar);
    var grid = el('div', 'ggrid lv-grid'); box.appendChild(grid);
    var foot = el('div', 'lv-foot', N.t('liveHold') + ' · ' + N.t('liveSrc')); box.appendChild(foot);
    box.reveal = function (e) { ui.vscroll(box, e._cell || e, 220); };
    var msg = el('div', 'nores', N.t('liveLoading')); box.appendChild(msg);

    function shown() {
      var all = L.channels || [];
      if (filter === 'fav') return all.filter(L.isFav);
      if (filter === 'all') return all;
      return all.filter(function (c) { return c.group === filter; });
    }
    function curPill() { for (var i = 0; i < pills.length; i++) if (pills[i]._k === filter) return pills[i]; return pills[0]; }
    function buildPills() {
      bar.innerHTML = ''; pills = [];
      var counts = {}, all = L.channels || [];
      all.forEach(function (c) { counts[c.group] = (counts[c.group] || 0) + 1; });
      var groups = Object.keys(counts).filter(function (g) { return g !== 'undefined'; }).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 7);
      var keys = ['all'].concat(L.favs().length ? ['fav'] : []).concat(groups);
      if (keys.indexOf(filter) < 0) filter = 'all';
      keys.forEach(function (k) {
        var p = ui.pill(k === 'all' ? N.t('liveAll') : k === 'fav' ? N.t('liveFav') : L.catName(k), function () {
          if (filter === k) return; filter = k; paintPills(); paintGrid(true);
        }, filter === k);
        p._k = k;
        p.onnav = function (dir) { if (dir === 'down') return cards[0] || true; if (dir === 'up') return true; return false; };
        bar.appendChild(p); pills.push(p);
      });
    }
    function paintPills() { pills.forEach(function (p) { p.classList.toggle('cur', p._k === filter); }); }
    function paintGrid(focusFirst, want) {
      grid.innerHTML = ''; cards = []; list = shown();
      box.style.transition = 'none'; box._ty = null; box.style.transform = ''; void box.offsetWidth; box.style.transition = '';
      cnt.textContent = N.tf('liveChN', { n: N.fmt.num(list.length) });
      msg.style.display = list.length ? 'none' : ''; msg.textContent = N.t('liveNone');
      list.forEach(function (ch, i) {
        var cell = el('div', 'gcell lv-cell'), c = chCard(ch, i + 1);
        cell.appendChild(c); c._cell = cell;
        c.onclick = function () { L.play(list, i); };
        c._lp = function () {
          var on = L.toggleFav(ch), hadFav = false;
          for (var q = 0; q < pills.length; q++) if (pills[q]._k === 'fav') hadFav = true;
          c.classList.toggle('fav', on);
          if (filter === 'fav' && !on) { buildPills(); paintGrid(true); }
          else if (hadFav !== (L.favs().length > 0)) { buildPills(); paintPills(); }
        };
        c.onfocus2 = function () {
          var row = Math.floor(i / COLS);
          for (var k = Math.max(0, (row - 1) * COLS); k < Math.min(cards.length, (row + 3) * COLS); k++) chLoad(cards[k]);
        };
        c.onnav = gridNav(cards, i, function () { return curPill() || true; });
        grid.appendChild(cell); cards.push(c);
      });
      for (var k = 0; k < Math.min(cards.length, 3 * COLS); k++) chLoad(cards[k]);
      var t = want !== undefined && cards[want] ? cards[want] : (focusFirst ? (cards[0] || curPill()) : null);
      if (t) { N.nav.focus(t, true); box.reveal(t); }
    }
    function show() {
      if (dead) return;
      msg.style.display = 'none';
      buildPills(); paintGrid(true, restore && restore.idx);
    }
    L.load(false).then(show).catch(function (e) {
      if (!dead) N.sc.errorView(root, e, function () { N.go('live', {}, { replace: true }); });
    });
    return {
      destroy: function () { dead = true; },
      focusState: function () { var i = cards.indexOf(N.nav.cur); return { f: filter, idx: i >= 0 ? i : undefined }; },
      onPlayerClosed: function () {
        var i = L.lastIdx, c = cards[i] && list[i] === L.lastCh ? cards[i] : null;
        if (!c) { for (var k = 0; k < list.length; k++) if (list[k] === L.lastCh) { c = cards[k]; break; } }
        c = c || cards[0] || curPill(); if (c) { N.nav.focus(c, true); box.reveal(c); }
      }
    };
  };

  /* ================= live player ================= */
  var V = { open: false, list: [], idx: 0, be: null, osdT: null, startT: null, numT: null, num: '', panel: false, sel: 0, dom: null, paused: false };
  var hasAV = function () { return !!(window.webapis && window.webapis.avplay); };

  function build() {
    if (V.dom) return V.dom;
    var d = { root: el('div', 'hidden') }; d.root.id = 'live';
    d.video = el('video'); d.video.id = 'lvideo'; d.video.setAttribute('playsinline', ''); d.root.appendChild(d.video);
    d.spin = el('div', 'lv-spin'); d.root.appendChild(d.spin);
    d.osd = el('div', 'lv-osd off');
    d.logo = el('img', 'lv-logo'); d.logo.alt = ''; d.osd.appendChild(d.logo);
    d.num = el('div', 'lv-num tab'); d.osd.appendChild(d.num);
    d.name = el('div', 'lv-name'); d.osd.appendChild(d.name);
    d.meta = el('div', 'lv-meta'); d.osd.appendChild(d.meta);
    d.badge = el('div', 'lv-badge', N.t('liveBadge')); d.osd.appendChild(d.badge);
    d.clock = el('div', 'lv-clock tab'); d.osd.appendChild(d.clock);
    d.root.appendChild(d.osd);
    d.err = el('div', 'lv-err off'); d.root.appendChild(d.err);
    d.entry = el('div', 'lv-entry tab off'); d.root.appendChild(d.entry);
    d.panel = el('div', 'lv-panel off'); d.ph = el('div', 'lv-ph', N.t('liveList')); d.rows = el('div', 'lv-rows');
    d.panel.appendChild(d.ph); d.panel.appendChild(d.rows); d.root.appendChild(d.panel);
    document.body.appendChild(d.root);
    V.dom = d; return d;
  }

  // one backend per tune: AVPlay (Samsung app), else <video> with hls.js and the engine's own HLS as fallback
  function backend(url, ok, fail) {
    var d = V.dom, done = false, started = false;
    function good() { if (started) return; started = true; ok(); }
    function bad(m) { if (done) return; done = true; fail(m); }
    if (hasAV()) {
      var av = webapis.avplay;
      $('avplayObj').style.display = 'block'; document.body.classList.add('av'); document.documentElement.classList.add('avh');
      try { av.close(); } catch (e) {}
      try { av.open(String(url)); } catch (e) { setTimeout(function () { bad('open'); }, 0); return { stop: function () {}, pause: function () {}, play: function () {} }; }
      av.setDisplayRect(0, 0, 1920, 1080);
      try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) {}
      av.setListener({
        onbufferingstart: function () { d.spin.classList.add('on'); },
        onbufferingcomplete: function () { d.spin.classList.remove('on'); good(); },
        oncurrentplaytime: function () { good(); },
        onstreamcompleted: function () { bad('ended'); },
        onevent: function () {}, onerror: function (e) { bad(String(e)); }, onsubtitlechange: function () {}
      });
      av.prepareAsync(function () { try { av.play(); } catch (e) {} good(); }, function (e) { bad(String(e)); });
      return {
        stop: function () { done = true; try { av.stop(); } catch (e) {} try { av.close(); } catch (e) {} $('avplayObj').style.display = 'none'; document.body.classList.remove('av'); document.documentElement.classList.remove('avh'); },
        pause: function () { try { av.pause(); } catch (e) {} }, play: function () { try { av.play(); } catch (e) {} }
      };
    }
    var v = d.video, hls = null, native = false;
    v.onplaying = function () { d.spin.classList.remove('on'); good(); };
    v.onwaiting = function () { d.spin.classList.add('on'); };
    v.onerror = function () { if (!native || !hls) bad('video'); };
    v.onended = function () { bad('ended'); };
    function goNative() {
      native = true; if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
      v.src = url; var p = v.play(); if (p && p.catch) p.catch(function () {});
    }
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: false, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3, liveDurationInfinity: true });
      hls.on(Hls.Events.MANIFEST_PARSED, function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); });
      hls.on(Hls.Events.ERROR, function (ev, x) {
        if (!x || !x.fatal) return;
        if (!started && !native) { goNative(); return; }   // CORS or a format hls.js cannot read: let the TV try
        if (x.type === Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); } catch (e) { bad('media'); } return; }
        bad('hls ' + x.details);
      });
      hls.loadSource(url); hls.attachMedia(v);
    } else goNative();
    return {
      stop: function () { done = true; v.onplaying = v.onwaiting = v.onerror = v.onended = null; if (hls) { try { hls.destroy(); } catch (e) {} hls = null; } try { v.pause(); } catch (e) {} v.removeAttribute('src'); try { v.load(); } catch (e) {} },
      pause: function () { try { v.pause(); } catch (e) {} }, play: function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    };
  }

  function clock() { var t = new Date(), h = t.getHours(), m = t.getMinutes(); return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
  function showOsd(ms) {
    var d = V.dom, ch = V.list[V.idx]; if (!ch) return;
    d.num.textContent = String(V.idx + 1);
    d.name.innerHTML = ''; d.name.appendChild(ui.txt(el('span'), ch.name));   // dir=ltr only on the inner span (keeps the box on the start side in RTL)
    d.meta.innerHTML = ''; ui.dots(d.meta, [L.catName(ch.group), ch.q ? ch.q + 'p' : '', ch.geo ? N.t('liveGeo') : '']);
    if (ch.logo) { d.logo.style.display = ''; if (d.logo.getAttribute('src') !== ch.logo) d.logo.src = ch.logo; } else d.logo.style.display = 'none';
    d.logo.onerror = function () { d.logo.style.display = 'none'; };
    d.clock.textContent = clock();
    d.osd.classList.remove('off'); clearTimeout(V.osdT);
    V.osdT = setTimeout(function () { if (!V.panel) d.osd.classList.add('off'); }, ms || 4000);
  }
  function showErr(ch, m) {
    var d = V.dom; d.spin.classList.remove('on'); d.err.innerHTML = '';
    d.err.appendChild(ui.icon('warn'));
    d.err.appendChild(el('div', 'et', N.t('liveFailT')));
    if (ch && ch.geo) d.err.appendChild(el('div', 'ed', N.t('liveFailGeo')));
    d.err.appendChild(el('div', 'eh', N.t('liveFailHint')));
    d.err.classList.remove('off');
    try { console.warn('live: ' + (ch && ch.name) + ' failed: ' + m); } catch (e) {}
  }
  function tune(i) {
    var d = V.dom, n = V.list.length; if (!n) return;
    i = ((i % n) + n) % n; V.idx = i; L.lastIdx = i; L.lastCh = V.list[i];
    if (V.be) { V.be.stop(); V.be = null; }
    clearTimeout(V.startT); d.err.classList.add('off'); d.spin.classList.add('on'); V.paused = false; d.root.classList.remove('paused');
    var ch = V.list[i]; N.store.set('live.last', key(ch));
    showOsd();
    var my = {};
    V.cur = my;
    V.be = backend(ch.url, function () { if (V.cur !== my) return; clearTimeout(V.startT); d.spin.classList.remove('on'); },
      function (m) { if (V.cur !== my) return; clearTimeout(V.startT); if (V.be) { V.be.stop(); V.be = null; } showErr(ch, m); showOsd(8000); });
    V.startT = setTimeout(function () { if (V.cur === my) { if (V.be) V.be.stop(); V.be = null; showErr(ch, 'timeout'); showOsd(8000); } }, 20000);
    if (V.panel) renderPanel();
  }
  function renderPanel() {
    var d = V.dom; d.rows.innerHTML = '';
    var from = Math.max(0, Math.min(V.sel - 5, V.list.length - 11)), to = Math.min(V.list.length, from + 11);
    for (var i = from; i < to; i++) {
      var ch = V.list[i], r = el('div', 'lv-row' + (i === V.sel ? ' sel' : '') + (i === V.idx ? ' cur' : ''));
      r.appendChild(el('span', 'rn tab', String(i + 1)));
      if (ch.logo) { var im = el('img', 'rl'); im.alt = ''; im.onerror = function () { this.style.visibility = 'hidden'; }; im.src = ch.logo; r.appendChild(im); } else r.appendChild(el('span', 'rl'));
      r.appendChild(ui.txt(el('span', 'rt'), ch.name));
      d.rows.appendChild(r);
    }
  }
  function panel(on) {
    var d = V.dom; V.panel = on; d.panel.classList.toggle('off', !on);
    if (on) { V.sel = V.idx; renderPanel(); showOsd(600000); } else showOsd();
  }
  function digit(n) {
    var d = V.dom; V.num = (V.num + n).slice(-3); d.entry.textContent = V.num; d.entry.classList.remove('off');
    clearTimeout(V.numT);
    V.numT = setTimeout(function () {
      var x = parseInt(V.num, 10); V.num = ''; d.entry.classList.add('off');
      if (x >= 1 && x <= V.list.length) tune(x - 1);
    }, 1500);
  }
  function onKey(e) {
    if (!V.open) return false;
    var k = e.keyCode;
    if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) { if (V.panel) panel(false); else L.close(); return true; }
    if (V.panel) {
      if (k === K.UP) { V.sel = Math.max(0, V.sel - 1); renderPanel(); }
      else if (k === K.DOWN) { V.sel = Math.min(V.list.length - 1, V.sel + 1); renderPanel(); }
      else if (CH_UP.indexOf(k) >= 0) { V.sel = Math.max(0, V.sel - 10); renderPanel(); }
      else if (CH_DOWN.indexOf(k) >= 0) { V.sel = Math.min(V.list.length - 1, V.sel + 10); renderPanel(); }
      else if (k === K.ENTER) { panel(false); if (V.sel !== V.idx) tune(V.sel); }
      else if (k === K.LEFT || k === K.RIGHT) panel(false);
      return true;
    }
    if (k === K.UP || CH_UP.indexOf(k) >= 0) tune(V.idx + 1);
    else if (k === K.DOWN || CH_DOWN.indexOf(k) >= 0) tune(V.idx - 1);
    else if (k === K.ENTER) panel(true);
    else if (k >= 48 && k <= 57) digit(String(k - 48));
    else if (k >= 96 && k <= 105) digit(String(k - 96));
    else if (k === K.PLAY || k === K.PAUSE || k === K.PLAYPAUSE) {
      if (!V.be) tune(V.idx);
      else if (V.paused || k === K.PLAY) { V.be.play(); V.paused = false; V.dom.root.classList.remove('paused'); }
      else { V.be.pause(); V.paused = true; V.dom.root.classList.add('paused'); }
      showOsd();
    }
    else if (k === K.STOP) L.close();
    else showOsd();
    return true;
  }
  L.play = function (list, idx) {
    if (!list || !list.length) return;
    build(); V.list = list; V.open = true; V.panel = false;
    var d = V.dom; d.root.classList.remove('hidden'); d.panel.classList.add('off'); d.entry.classList.add('off');
    document.body.classList.add('playing', 'live-on');
    N.nav.pushHandler(onKey);
    tune(idx || 0);
  };
  L.close = function () {
    if (!V.open) return;
    V.open = false; clearTimeout(V.startT); clearTimeout(V.osdT); clearTimeout(V.numT); V.cur = null;
    if (V.be) { V.be.stop(); V.be = null; }
    var d = V.dom; d.root.classList.add('hidden'); d.osd.classList.add('off'); d.err.classList.add('off'); d.spin.classList.remove('on');
    document.body.classList.remove('playing', 'live-on');
    N.nav.popHandler(onKey);
    if (N.onPlayerClosed) N.onPlayerClosed();
  };
  L.isOpen = function () { return V.open; };
  document.addEventListener('visibilitychange', function () {
    if (!V.open) return;
    if (document.hidden) { clearTimeout(V.startT); V.cur = null; if (V.be) { V.be.stop(); V.be = null; } }
    else tune(V.idx);
  });
  L._parse = parseM3U; L._merge = merge;   // for tests
})();
