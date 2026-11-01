/* Live TV (fork addition): Iranian and Persian-language channels from public playlists, a channel grid with
   favourites and categories, and a full-screen live player (channel up/down, number entry, channel list).
   Sources are the public M3U lists of iptv-org (only streams the broadcasters offer for free). Nothing is
   reported to 30nama. ES5 only. */
(function () {
  var S = N.screens = N.screens || {}, el = N.el, ui = N.ui, K = N.keys, $ = N.$, L;

  // Main source: shayanline/iptv-iran (MIT), a curated list of Iranian and Persian-language TV whose streams are
  // checked twice a month by pulling real video. "all" adds alternate streams per channel (tried automatically),
  // "compat" marks streams known to play on limited TV players. iptv-org is the fallback when GitHub Raw fails.
  var RAW = 'https://raw.githubusercontent.com/shayanline/iptv-iran/main/playlists/';
  N.config.liveSources = N.config.liveSources || {
    main: RAW + 'iran.m3u', all: RAW + 'iran-all-streams.m3u', compat: RAW + 'iran-compat.m3u',
    fallback: ['https://iptv-org.github.io/iptv/countries/ir.m3u', 'https://iptv-org.github.io/iptv/languages/fas.m3u']
  };
  // Telewebion (IRIB) media playlists carry a 16-digit EXT-X-MEDIA-SEQUENCE that Samsung AVPlay cannot hold (signed
  // 32 bit): one frame, then it stops. A small Cloudflare Worker (tools/telewebion-worker/) rewrites the number; the
  // video itself still comes straight from Telewebion. Set its address here or in localStorage 'n30.liveProxy'.
  if (N.config.liveProxy === undefined) N.config.liveProxy = '';
  var CACHE_MS = 6 * 3600 * 1000, CACHE_KEY = 'live.cache2';
  var CH_UP = [427, 33], CH_DOWN = [428, 34];     // Samsung ChannelUp/Down, LG PageUp/PageDown
  var MAX_TRIES = 5, TRY_MS = 12000;

  N.addStrings({
    en: {
      live: 'Live TV', liveAll: 'All', liveFav: 'Favorites', liveChN: '{n} channels', liveLoading: 'Loading channels…',
      liveNone: 'No channels found.', liveFailT: 'This channel is not available right now',
      liveFailGeo: 'The broadcaster only allows viewers in Iran.', liveFailHint: 'Up / Down: next channel · OK: channel list',
      liveFailTw: 'IRIB channels need the Telewebion helper on Samsung TVs (see the app’s README).',
      liveTry: 'Trying another stream ({n}/{m})…', liveRecent: 'Recently watched', liveDown: 'did not play recently',
      liveKOk: 'Channel list', liveKFav: 'Favorite', liveKUnfav: 'Unfavorite', liveKSleep: 'Sleep timer', liveKPrev: 'Previous channel',
      livePanelKeys: '◀ ▶ category · OK watch · red favorite', liveSleepOn: 'Sleep timer: {n} minutes', liveSleepOff: 'Sleep timer off',
      liveSleepLeft: 'Off in {n} min', liveSleepEnd: 'Sleep timer: good night', liveStart: 'On start', liveStartHome: 'Home',
      liveStartLive: 'Live TV', liveStartLast: 'Last channel', liveHomeRow: 'Live TV row on Home', liveRefresh: 'Reload channel list', liveRefreshed: 'Channel list updated',
      liveFavOn: 'Added to favorites', liveFavOff: 'Removed from favorites', liveHold: 'Hold OK: add to favorites',
      liveGeo: 'Iran only', liveSrc: 'Channels: iptv-iran (community list)', liveList: 'Channels', liveBadge: 'LIVE',
      lc_news: 'News', lc_sports: 'Sports', lc_kids: 'Kids', lc_music: 'Music', lc_movies: 'Movies', lc_series: 'Series',
      lc_religious: 'Religious', lc_general: 'General', lc_entertainment: 'Entertainment', lc_documentary: 'Documentary',
      lc_culture: 'Culture', lc_education: 'Education', lc_legislative: 'Parliament', lc_business: 'Business',
      lc_lifestyle: 'Lifestyle', lc_family: 'Family', lc_undefined: 'Other'
    },
    fa: {
      live: 'پخش زنده', liveAll: 'همه', liveFav: 'علاقه‌مندی‌ها', liveChN: '{n} شبکه', liveLoading: 'در حال دریافت شبکه‌ها…',
      liveNone: 'هیچ شبکه‌ای پیدا نشد.', liveFailT: 'این شبکه الان در دسترس نیست',
      liveFailGeo: 'این شبکه فقط برای بینندگان داخل ایران پخش می‌شود.', liveFailHint: 'بالا / پایین: شبکهٔ بعدی · OK: فهرست شبکه‌ها',
      liveFailTw: 'شبکه‌های صدا و سیما روی تلویزیون سامسونگ به مبدل تلوبیون نیاز دارند (راهنمای برنامه).',
      liveTry: 'امتحان پخش دیگر ({n}/{m})…', liveRecent: 'اخیراً دیده‌شده', liveDown: 'اخیراً پخش نشد',
      liveKOk: 'فهرست شبکه‌ها', liveKFav: 'علاقه‌مندی', liveKUnfav: 'حذف از علاقه‌مندی', liveKSleep: 'تایمر خواب', liveKPrev: 'شبکهٔ قبلی',
      livePanelKeys: '◀ ▶ دسته · OK تماشا · قرمز علاقه‌مندی', liveSleepOn: 'تایمر خواب: {n} دقیقه', liveSleepOff: 'تایمر خواب خاموش',
      liveSleepLeft: 'خاموشی تا {n} دقیقه', liveSleepEnd: 'تایمر خواب: شب بخیر', liveStart: 'هنگام شروع', liveStartHome: 'خانه',
      liveStartLive: 'پخش زنده', liveStartLast: 'آخرین شبکه', liveHomeRow: 'ردیف پخش زنده در خانه', liveRefresh: 'به‌روزرسانی فهرست شبکه‌ها', liveRefreshed: 'فهرست شبکه‌ها به‌روز شد',
      liveFavOn: 'به علاقه‌مندی‌ها اضافه شد', liveFavOff: 'از علاقه‌مندی‌ها حذف شد', liveHold: 'نگه‌داشتن OK: افزودن به علاقه‌مندی‌ها',
      liveGeo: 'فقط ایران', liveSrc: 'فهرست شبکه‌ها: iptv-iran', liveList: 'شبکه‌ها', liveBadge: 'زنده',
      lc_news: 'خبری', lc_sports: 'ورزشی', lc_kids: 'کودک', lc_music: 'موسیقی', lc_movies: 'فیلم', lc_series: 'سریال',
      lc_religious: 'مذهبی', lc_general: 'عمومی', lc_entertainment: 'سرگرمی', lc_documentary: 'مستند',
      lc_culture: 'فرهنگی', lc_education: 'آموزشی', lc_legislative: 'مجلس', lc_business: 'اقتصادی',
      lc_lifestyle: 'سبک زندگی', lc_family: 'خانواده', lc_undefined: 'سایر'
    }
  });

  /* ================= channel list ================= */
  function trim(x) { return String(x || '').replace(/^\s+|\s+$/g, ''); }
  // "#EXTINF:-1 tvg-id=".." tvg-logo=".." group-title="EN | FA" tvg-quality="FHD",EN name | FA name [IR]" + URL
  // (iptv-org lines look the same with single-language names, "(720p)" and "[Geo-blocked]")
  function parseM3U(txt) {
    var lines = String(txt || '').split(/\r?\n/), out = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var l = trim(lines[i]);
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
      var name = trim(raw.replace(/\s*\(\d{3,4}p\)/g, '').replace(/\s*\[[^\]]*\]/g, '')) || e.attrs['tvg-name'] || 'TV';
      var np = name.split(' | '), gp = String(e.attrs['group-title'] || '').split(' | ');
      var gEn = trim(gp[0]), gFa = trim(gp[1] || ''), fl = flags.join(' ');
      if (gEn.indexOf(';') >= 0) gEn = gEn.split(';')[0];
      return {
        id: e.attrs['tvg-id'] || '', en: trim(np[0]), fa: trim(np[1] || ''), url: e.url, logo: e.attrs['tvg-logo'] || '',
        group: gEn.toLowerCase() || 'undefined', gEn: gEn, gFa: gFa,
        q: e.attrs['tvg-quality'] || (qm ? qm[1] : ''), geo: fl.indexOf('geo') >= 0 || /(^| )ir( |$)/.test(fl),
        part: fl.indexOf('24/7') >= 0, hdr: e.hdr
      };
    });
  }
  function key(c) { return (c.id || c.en || c.name || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, ''); }
  L = N.live = { channels: null, loading: null };
  L.isTw = function (u) { return /^https?:\/\/[^\/]*telewebion\.(ir|net)\//i.test(u); };
  // shayanline lists: main = channel order and the preferred stream; all = alternates; compat = TV-safe streams
  function build3(main, all, compat) {
    var byId = {}, safe = {};
    compat.forEach(function (c) { safe[c.url] = 1; });
    all.forEach(function (c) { var k = key(c); (byId[k] = byId[k] || []).push(c.url); });
    var seen = {};
    return main.filter(function (c) { var k = key(c); if (seen[k]) return false; seen[k] = 1; return true; }).map(function (c) {
      var alts = (byId[key(c)] || []).filter(function (u) { return u !== c.url; });
      alts.sort(function (a, b) { return (safe[b] ? 1 : 0) - (safe[a] ? 1 : 0); });
      c.alts = alts.slice(0, 8); c.safe = !!safe[c.url]; c.tw = L.isTw(c.url);
      return c;
    });
  }
  // iptv-org fallback: merge the two lists, best stream per channel, usable ones first
  function merge(lists) {
    var byKey = {}, order = [];
    lists.forEach(function (l) {
      l.forEach(function (c) {
        var k = key(c), o = byKey[k];
        if (!o) { c.alts = []; byKey[k] = c; order.push(k); return; }
        if (o.url !== c.url && o.alts.indexOf(c.url) < 0) o.alts.push(c.url);
      });
    });
    var all = order.map(function (k) { var c = byKey[k]; c.tw = L.isTw(c.url); return c; });
    all.sort(function (a, b) { return ((a.hdr - b.hdr) || (a.geo - b.geo) || (a.part - b.part)) || a.en.toLowerCase().localeCompare(b.en.toLowerCase()); });
    return all;
  }
  function get(u) {
    return N.fetch(u).then(function (r) { if (!r.ok) throw new Error('m3u ' + r.status); return r.text(); }).then(parseM3U);
  }
  // Instant from the stored list (any age); a list older than CACHE_MS is refreshed in the background for next time.
  L.load = function (force) {
    var c = N.store.get(CACHE_KEY, null);
    if (!force && c && c.list && c.list.length) {
      L.channels = L.channels || c.list;
      if (Date.now() - c.t >= CACHE_MS && !L.loading) L.fetchList(c).catch(function () {});
      return Promise.resolve(L.channels);
    }
    return L.fetchList(c);
  };
  L.fetchList = function (c) {
    var src = N.config.liveSources;
    if (L.loading) return L.loading;
    var soft = function (u) { return get(u).catch(function () { return []; }); };
    L.loading = get(src.main).then(function (main) {
      if (!main.length) throw new Error('empty');
      return Promise.all([soft(src.all), soft(src.compat)]).then(function (r) { return build3(main, r[0], r[1]); });
    }).catch(function () {
      return Promise.all(src.fallback.map(soft)).then(merge);
    }).then(function (all) {
      L.loading = null;
      if (!all.length) { if (c && c.list && c.list.length) { L.channels = c.list; return c.list; } throw new Error('no channels'); }
      L.channels = all; N.store.set(CACHE_KEY, { t: Date.now(), list: all });
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
  L.key = key;
  L.byKey = function (k) { var a = L.channels || []; for (var i = 0; i < a.length; i++) if (key(a[i]) === k) return a[i]; return null; };
  // recently watched (newest first)
  L.recent = function () { return N.store.get('live.recent', []); };
  L.noteRecent = function (ch) {
    var r = L.recent(), k = key(ch), i = r.indexOf(k);
    if (i >= 0) r.splice(i, 1); r.unshift(k); N.store.set('live.recent', r.slice(0, 20));
  };
  // per channel: the stream that played last time (tried first next time) or when it last failed completely
  var HEALTH = N.store.get('live.health', {});
  L.health = function (ch) { return HEALTH[key(ch)] || null; };
  function saveHealth(ch, h) { HEALTH[key(ch)] = h; N.store.set('live.health', HEALTH); }
  L.unstable = function (ch) { var h = L.health(ch); return !!(h && h.f && Date.now() - h.f < 24 * 3600 * 1000); };
  // list -> channel objects for a key list
  L.pick = function (keys) { var out = []; keys.forEach(function (k) { var c = L.byKey(k); if (c) out.push(c); }); return out; };
  // "your channels" for the Home row: recently watched, then favourites, filled up with the first national channels
  L.homeList = function () {
    var out = [], seen = {};
    function add(c) { var k = key(c); if (c && !seen[k]) { seen[k] = 1; out.push(c); } }
    L.pick(L.recent()).forEach(add); L.pick(L.favs()).forEach(add);
    (L.channels || []).slice(0, 12).forEach(function (c) { if (out.length < 12) add(c); });
    return out.slice(0, 16);
  };

  // display name / category in the UI language
  L.nm = function (ch) { return (N.lang === 'fa' ? (ch.fa || ch.en) : (ch.en || ch.fa)) || ch.name || 'TV'; };
  function shortGroup(t) { var i = t.lastIndexOf(' · '); return i >= 0 ? t.slice(i + 3) : t; }
  L.cat = function (ch) {
    if (ch.gFa || /\w \w/.test(ch.gEn || '')) return shortGroup(N.lang === 'fa' ? (ch.gFa || ch.gEn) : (ch.gEn || ch.gFa));
    var t = N.t('lc_' + ch.group); return t === 'lc_' + ch.group ? (ch.gEn || ch.group) : t;
  };
  L.meta = function (ch) { return [L.cat(ch), ch.q || '', ch.geo ? N.t('liveGeo') : '']; };
  // Telewebion URL -> Worker URL (/<channel>/<rendition>)
  L.proxied = function (u) {
    var px = N.store.get('liveProxy', '') || N.config.liveProxy;
    if (!px || !L.isTw(u)) return '';
    var m = /telewebion\.(?:ir|net)\/(?:ek\/)?([a-z0-9_-]+)\/live\/(?:(\d{3,4}p)\/)?/i.exec(u);
    if (!m) return '';
    return px.replace(/\/+$/, '') + '/' + m[1] + (m[2] ? '/' + m[2] : '');
  };

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
    if (num) art.appendChild(el('div', 'chn tab', String(num)));
    if (ch.logo) { var im = el('img', 'im'); im.alt = ''; im.decoding = 'async'; art.appendChild(im); c._im = im; c._src = ch.logo; }
    var ph = el('div', 'ph'); ph.appendChild(ui.txt(el('span'), L.nm(ch))); art.appendChild(ph);
    if (L.isFav(ch)) c.classList.add('fav');
    if (L.unstable(ch)) c.classList.add('down');
    art.appendChild(el('i', 'favdot'));
    art.appendChild(el('i', 'sheen'));
    c.appendChild(art); c._art = art;
    var cap = el('div', 'cap'), ct = el('div', 'ct'), cs = el('div', 'cs');
    ui.txt(ct, L.nm(ch));
    ui.dots(cs, [ch.q || '', ch.geo ? N.t('liveGeo') : L.unstable(ch) ? N.t('liveDown') : '']);
    cap.appendChild(ct); cap.appendChild(cs); c.appendChild(cap);
    return c;
  }
  L.card = chCard;

  // logos: own lazy loader (hides the name placeholder once a logo is there; drops broken logos)
  function chLoad(c) {
    if (!c || c._on || !c._src || !c._im) return; c._on = true;
    var im = c._im;
    im.onload = function () { im.classList.add('in'); c.classList.add('ok'); };
    im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); c._im = null; };
    im.src = c._src;
  }

  S.live = function (root, params, restore) {
    var dead = false, cards = [], pills = [], filter = (restore && restore.f) || N.store.get('live.filter', 'all'), list = [];
    root.classList.add('live-s'); N.stage.neutral(true);
    var box = el('div', 'arch'); root.appendChild(box);
    var head = el('div', 'ah'), ht = el('span', 'ht', N.t('live')), cnt = el('small', 'cnt', '');
    head.appendChild(ht); head.appendChild(cnt); box.appendChild(head);
    var bar = el('div', 'lv-pills'); box.appendChild(bar);
    var grid = el('div', 'ggrid lv-grid'); box.appendChild(grid);
    var foot = el('div', 'lv-foot', N.t('liveHold') + ' · ' + N.t('liveSrc')); root.appendChild(foot);
    var gridTop = 250;
    box.reveal = function (e) { if (pills.indexOf(e) >= 0) { ui.vscroll(box, bar, 150); return; } ui.vscroll(box, e._cell || e, gridTop); };
    var msg = el('div', 'nores', N.t('liveLoading')); box.appendChild(msg);

    function shown() {
      var all = L.channels || [];
      if (filter === 'fav') return L.pick(L.favs());
      if (filter === 'recent') return L.pick(L.recent());
      if (filter === 'all') return all;
      return all.filter(function (c) { return c.group === filter; });
    }
    function curPill() { for (var i = 0; i < pills.length; i++) if (pills[i]._k === filter) return pills[i]; return pills[0]; }
    function buildPills() {
      bar.innerHTML = ''; pills = [];
      var rep = {}, groups = [], all = L.channels || [];
      all.forEach(function (c) { if (c.group !== 'undefined' && !rep[c.group]) { rep[c.group] = c; groups.push(c.group); } });
      if (groups.length > 14) groups = groups.slice(0, 14);
      var keys = ['all'].concat(L.recent().length ? ['recent'] : []).concat(L.favs().length ? ['fav'] : []).concat(groups);
      if (keys.indexOf(filter) < 0) filter = 'all';
      keys.forEach(function (k) {
        var p = ui.pill(k === 'all' ? N.t('liveAll') : k === 'fav' ? N.t('liveFav') : k === 'recent' ? N.t('liveRecent') : L.cat(rep[k]), function () {
          if (filter === k) return; filter = k; N.store.set('live.filter', k); paintPills(); paintGrid(true);
        }, filter === k);
        p._k = k;
        p.onnav = function (dir, cur) {
          // pills may wrap onto a second row: up/down move between rows first, then into the grid
          var r = cur.getBoundingClientRect(), best = null, bd = 1e9;
          for (var i = 0; i < pills.length; i++) {
            var q = pills[i].getBoundingClientRect();
            if (dir === 'down' ? q.top > r.bottom - 4 : q.bottom < r.top + 4) { var dd = Math.abs((q.left + q.right) / 2 - (r.left + r.right) / 2) + Math.abs(q.top - r.top) * 3; if (dd < bd) { bd = dd; best = pills[i]; } }
          }
          if (dir === 'down') return best || cards[0] || true;
          if (dir === 'up') return best || true;
          return false;
        };
        bar.appendChild(p); pills.push(p);
      });
      gridTop = 150 + bar.offsetHeight + 40; grid.style.top = gridTop + 'px';
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
      buildPills();
      var want = restore && restore.idx;
      if (want === undefined) { var lk = N.store.get('live.last', ''); list = shown(); for (var i = 0; i < list.length; i++) if (key(list[i]) === lk) { want = i; break; } }
      paintGrid(true, want);
      if (params && params.playLast) { var lc = L.byKey(N.store.get('live.last', '')); if (lc) { var at = list.indexOf(lc); L.play(at >= 0 ? list : [lc], at >= 0 ? at : 0); } }
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
  var V = { open: false, list: [], idx: 0, prev: -1, be: null, osdT: null, startT: null, numT: null, num: '', panel: false, sel: 0,
    dom: null, paused: false, cats: [], cat: 0, plist: [], sleepAt: 0, sleepT: null };
  var hasAV = function () { return !!(window.webapis && window.webapis.avplay); };
  var PRE_CH = [10190], RED = 403, GREEN = 404, SLEEP = [0, 30, 60, 90, 120];

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
    d.fav = el('div', 'lv-fav'); d.osd.appendChild(d.fav);
    d.clock = el('div', 'lv-clock tab'); d.osd.appendChild(d.clock);
    d.sleep = el('div', 'lv-sleep tab'); d.osd.appendChild(d.sleep);
    d.next = el('div', 'lv-next'); d.osd.appendChild(d.next);
    d.keys = el('div', 'lv-keys'); d.osd.appendChild(d.keys);
    d.root.appendChild(d.osd);
    d.err = el('div', 'lv-err off'); d.root.appendChild(d.err);
    d.tries = el('div', 'lv-tries off'); d.root.appendChild(d.tries);
    d.entry = el('div', 'lv-entry tab off'); d.root.appendChild(d.entry);
    d.panel = el('div', 'lv-panel off'); d.ph = el('div', 'lv-ph'); d.rows = el('div', 'lv-rows'); d.pk = el('div', 'lv-pk');
    d.panel.appendChild(d.ph); d.panel.appendChild(d.rows); d.panel.appendChild(d.pk); d.root.appendChild(d.panel);
    document.body.appendChild(d.root);
    V.dom = d; return d;
  }

  // one backend per tune: AVPlay (Samsung app), else <video> with hls.js and the engine's own HLS as fallback
  function backend(url, how, ok, fail) {
    var d = V.dom, done = false, started = false;
    function good() { if (started) return; started = true; ok(); }
    function bad(m) { if (done) return; done = true; fail(m); }
    if (how === 'av' && hasAV()) {
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
      if (hasAV()) { bad('hls'); return; }   // Samsung: the native player is AVPlay again, already tried
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
  function chAt(i) { var n = V.list.length; return n ? V.list[((i % n) + n) % n] : null; }
  function showOsd(ms) {
    var d = V.dom, ch = V.list[V.idx]; if (!ch) return;
    d.num.textContent = String(V.idx + 1);
    d.name.innerHTML = ''; d.name.appendChild(ui.txt(el('span'), L.nm(ch)));   // dir=ltr only on the inner span (keeps the box on the start side in RTL)
    d.meta.innerHTML = ''; ui.dots(d.meta, L.meta(ch));
    if (ch.logo) { d.logo.style.display = ''; if (d.logo.getAttribute('src') !== ch.logo) d.logo.src = ch.logo; } else d.logo.style.display = 'none';
    d.logo.onerror = function () { d.logo.style.display = 'none'; };
    d.fav.classList.toggle('on', L.isFav(ch));
    d.clock.textContent = clock();
    var left = V.sleepAt ? Math.max(1, Math.round((V.sleepAt - Date.now()) / 60000)) : 0;
    d.sleep.textContent = left ? N.tf('liveSleepLeft', { n: left }) : '';
    // what is around: next / previous channel (Up / Down)
    d.next.innerHTML = '';
    if (V.list.length > 1) {
      var up = el('div', 'nx'), dn = el('div', 'nx');
      up.appendChild(el('b', '', '▲')); up.appendChild(ui.txt(el('span'), L.nm(chAt(V.idx + 1))));
      dn.appendChild(el('b', '', '▼')); dn.appendChild(ui.txt(el('span'), L.nm(chAt(V.idx - 1))));
      d.next.appendChild(up); d.next.appendChild(dn);
    }
    d.keys.innerHTML = '';
    [['ok', N.t('liveKOk')], ['red', N.t(L.isFav(ch) ? 'liveKUnfav' : 'liveKFav')], ['green', N.t('liveKSleep')]].concat(V.prev >= 0 ? [['pre', N.t('liveKPrev')]] : []).forEach(function (k) {
      var x = el('span', 'k'); x.appendChild(el('i', 'kk ' + k[0])); x.appendChild(el('span', '', k[1])); d.keys.appendChild(x);
    });
    d.osd.classList.remove('off'); clearTimeout(V.osdT);
    V.osdT = setTimeout(function () { if (!V.panel) d.osd.classList.add('off'); }, ms || 4500);
  }
  function showErr(ch, m) {
    var d = V.dom; d.spin.classList.remove('on'); d.err.innerHTML = ''; d.tries.classList.add('off');
    d.err.appendChild(ui.icon('warn'));
    d.err.appendChild(el('div', 'et', N.t('liveFailT')));
    if (ch && ch.geo) d.err.appendChild(el('div', 'ed', N.t('liveFailGeo')));
    else if (ch && ch.tw && hasAV() && !L.proxied(ch.url)) d.err.appendChild(el('div', 'ed', N.t('liveFailTw')));
    d.err.appendChild(el('div', 'eh', N.t('liveFailHint')));
    d.err.classList.remove('off');
    try { console.warn('live: ' + (ch && ch.en) + ' failed: ' + m); } catch (e) {}
  }
  // what to try for a channel, in order: the stream that worked last time, then per stream (main, alternates) the best way to play it
  function attempts(ch) {
    var urls = [ch.url].concat(ch.alts || []), out = [], seen = {}, h = L.health(ch);
    function add(u, how) { var k = how + ' ' + u; if (u && !seen[k]) { seen[k] = 1; out.push({ url: u, how: how }); } }
    if (h && h.u && (h.h !== 'av' || hasAV())) add(h.u, h.h);
    urls.forEach(function (u) {
      if (L.isTw(u)) {
        if (hasAV()) add(L.proxied(u), 'av');   // AVPlay only through the rewriting Worker (sequence number)
        add(u, 'hls');                            // hls.js reads the original (if the engine allows the request)
      } else {
        if (hasAV()) add(u, 'av');
        add(u, 'hls');
      }
    });
    return out.slice(0, MAX_TRIES);
  }
  function tune(i) {
    var d = V.dom, n = V.list.length; if (!n) return;
    i = ((i % n) + n) % n;
    if (V.list[V.idx] && i !== V.idx) V.prev = V.idx;
    V.idx = i; L.lastIdx = i; L.lastCh = V.list[i];
    if (V.be) { V.be.stop(); V.be = null; }
    clearTimeout(V.startT); d.err.classList.add('off'); d.tries.classList.add('off'); d.spin.classList.add('on'); V.paused = false; d.root.classList.remove('paused');
    var ch = V.list[i]; N.store.set('live.last', key(ch)); L.noteRecent(ch);
    showOsd();
    var my = {}, list = attempts(ch), t = 0;
    V.cur = my;
    function next(m) {
      if (V.cur !== my) return;
      clearTimeout(V.startT); if (V.be) { V.be.stop(); V.be = null; }
      if (t >= list.length) { saveHealth(ch, { f: Date.now() }); showErr(ch, m); showOsd(8000); return; }
      var a = list[t++];
      if (t > 1) { d.tries.textContent = N.tf('liveTry', { n: t, m: list.length }); d.tries.classList.remove('off'); }
      d.spin.classList.add('on');
      V.be = backend(a.url, a.how, function () {
        if (V.cur !== my) return; clearTimeout(V.startT); d.spin.classList.remove('on'); d.tries.classList.add('off');
        saveHealth(ch, { u: a.url, h: a.how, t: Date.now() });
        try { console.log('live: ' + ch.en + ' plays via ' + a.how + ' ' + a.url); } catch (e) {}
      }, function (e) { next(a.how + ': ' + e); });
      V.startT = setTimeout(function () { next(a.how + ': timeout'); }, TRY_MS);
    }
    next('');
    if (V.panel) renderPanel();
  }

  /* ---------- channel list panel (OK): categories with Left/Right, Red = favourite ---------- */
  function catList() {
    var all = L.channels || V.list, out = [{ k: 'cur', t: N.t('liveList'), l: V.list }], seen = {};
    if (L.recent().length) out.push({ k: 'recent', t: N.t('liveRecent'), l: L.pick(L.recent()) });
    if (L.favs().length) out.push({ k: 'fav', t: N.t('liveFav'), l: L.pick(L.favs()) });
    out.push({ k: 'all', t: N.t('liveAll'), l: all });
    all.forEach(function (c) { if (c.group !== 'undefined' && !seen[c.group]) { seen[c.group] = 1; out.push({ k: c.group, t: L.cat(c), l: all.filter(function (x) { return x.group === c.group; }) }); } });
    return out;
  }
  function renderPanel() {
    var d = V.dom, c = V.cats[V.cat], pl = V.plist; d.rows.innerHTML = '';
    d.ph.innerHTML = '';
    d.ph.appendChild(el('b', 'ar', '‹')); d.ph.appendChild(ui.txt(el('span', 'pt'), c ? c.t : '')); d.ph.appendChild(el('b', 'ar', '›'));
    d.ph.appendChild(el('small', 'pc', N.tf('liveChN', { n: N.fmt.num(pl.length) })));
    var from = Math.max(0, Math.min(V.sel - 5, pl.length - 10)), to = Math.min(pl.length, from + 10), playing = V.list[V.idx];
    for (var i = from; i < to; i++) {
      var ch = pl[i], r = el('div', 'lv-row' + (i === V.sel ? ' sel' : '') + (ch === playing ? ' cur' : '') + (L.unstable(ch) ? ' down' : ''));
      r.appendChild(el('span', 'rn tab', String(i + 1)));
      if (ch.logo) { var im = el('img', 'rl'); im.alt = ''; im.onerror = function () { this.style.visibility = 'hidden'; }; im.src = ch.logo; r.appendChild(im); } else r.appendChild(el('span', 'rl'));
      r.appendChild(ui.txt(el('span', 'rt'), L.nm(ch)));
      if (L.isFav(ch)) r.appendChild(el('i', 'rf'));
      d.rows.appendChild(r);
    }
    if (!pl.length) d.rows.appendChild(el('div', 'lv-empty', N.t('liveNone')));
    d.pk.textContent = N.t('livePanelKeys');
  }
  function setCat(i) {
    V.cat = (i + V.cats.length) % V.cats.length; V.plist = V.cats[V.cat].l || [];
    var playing = V.list[V.idx], at = V.plist.indexOf(playing); V.sel = at >= 0 ? at : 0; renderPanel();
  }
  function panel(on) {
    var d = V.dom; V.panel = on; d.panel.classList.toggle('off', !on);
    if (on) { V.cats = catList(); setCat(0); showOsd(600000); } else showOsd();
  }
  function digit(n) {
    var d = V.dom; V.num = (V.num + n).slice(-3); d.entry.textContent = V.num; d.entry.classList.remove('off');
    clearTimeout(V.numT);
    V.numT = setTimeout(function () {
      var x = parseInt(V.num, 10); V.num = ''; d.entry.classList.add('off');
      if (x >= 1 && x <= V.list.length) tune(x - 1);
    }, 1500);
  }
  function favToggle(ch) { if (!ch) return; L.toggleFav(ch); if (V.panel) renderPanel(); else showOsd(); }
  function sleepCycle() {
    var cur = V.sleepAt ? Math.round((V.sleepAt - Date.now()) / 60000) : 0, i = 0;
    for (var k = 0; k < SLEEP.length; k++) if (SLEEP[k] > cur + 1) { i = k; break; }
    if (cur && i === 0) i = 0; else if (!cur) i = 1;
    var m = SLEEP[i]; clearTimeout(V.sleepT);
    V.sleepAt = m ? Date.now() + m * 60000 : 0;
    if (m) V.sleepT = setTimeout(function () { N.toast(N.t('liveSleepEnd'), 4000); L.close(); setTimeout(function () { N.exitApp(); }, 1500); }, m * 60000);
    N.toast(m ? N.tf('liveSleepOn', { n: m }) : N.t('liveSleepOff'), 2000);
    showOsd();
  }
  function onKey(e) {
    if (!V.open) return false;
    var k = e.keyCode;
    if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) { if (V.panel) panel(false); else L.close(); return true; }
    if (V.panel) {
      if (k === K.UP) { V.sel = Math.max(0, V.sel - 1); renderPanel(); }
      else if (k === K.DOWN) { V.sel = Math.min(V.plist.length - 1, V.sel + 1); renderPanel(); }
      else if (CH_UP.indexOf(k) >= 0) { V.sel = Math.max(0, V.sel - 10); renderPanel(); }
      else if (CH_DOWN.indexOf(k) >= 0) { V.sel = Math.min(V.plist.length - 1, V.sel + 10); renderPanel(); }
      else if (k === K.LEFT || k === K.RIGHT) setCat(V.cat + ui.step(k === K.LEFT ? 'left' : 'right'));
      else if (k === RED) favToggle(V.plist[V.sel]);
      else if (k === K.ENTER && V.plist[V.sel]) {
        var target = V.plist[V.sel], playing = V.list[V.idx]; panel(false);
        if (V.plist !== V.list) {   // zapping now follows the chosen category
          V.list = V.plist; var pi = V.list.indexOf(playing); V.prev = -1; V.idx = pi >= 0 ? pi : V.list.indexOf(target);
        }
        if (target !== playing || !V.be) tune(V.list.indexOf(target));
      }
      return true;
    }
    if (k === K.UP || CH_UP.indexOf(k) >= 0) tune(V.idx + 1);
    else if (k === K.DOWN || CH_DOWN.indexOf(k) >= 0) tune(V.idx - 1);
    else if (PRE_CH.indexOf(k) >= 0 || (k === K.LEFT && V.prev >= 0)) { if (V.prev >= 0 && V.prev < V.list.length) tune(V.prev); }
    else if (k === K.ENTER) panel(true);
    else if (k === RED) favToggle(V.list[V.idx]);
    else if (k === GREEN) sleepCycle();
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
    build(); V.list = list; V.open = true; V.panel = false; V.prev = -1;
    var d = V.dom; d.root.classList.remove('hidden'); d.panel.classList.add('off'); d.entry.classList.add('off');
    document.body.classList.add('playing', 'live-on');
    N.nav.pushHandler(onKey);
    tune(idx || 0);
  };
  // the last channel (start option "last channel", Home row)
  L.playLast = function () {
    return L.load(false).then(function () {
      var c = L.byKey(N.store.get('live.last', '')) || (L.channels || [])[0]; if (!c) return;
      var l = L.channels || [c]; L.play(l, Math.max(0, l.indexOf(c)));
    });
  };
  L.close = function () {
    if (!V.open) return;
    V.open = false; clearTimeout(V.startT); clearTimeout(V.osdT); clearTimeout(V.numT); V.cur = null;
    if (V.be) { V.be.stop(); V.be = null; }
    var d = V.dom; d.root.classList.add('hidden'); d.osd.classList.add('off'); d.err.classList.add('off'); d.spin.classList.remove('on'); d.tries.classList.add('off');
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
