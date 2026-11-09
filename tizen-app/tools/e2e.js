// End-to-end test of the TV app in headless Chromium with a fake 30nama API and a fake Samsung AVPlay.
// Drives the app with remote keys (arrows, OK, Back = Escape) and checks the things that used to break:
// start-up, dead remote while loading, continue watching (same spot everywhere, next episode, dismiss),
// resume on a player that ignores a seek before play(), filters, paging, search, player retry.
// Usage: node tizen-app/tools/e2e.js [filter]   (needs `playwright`; starts tools/devserver.js itself)
var pw = require('playwright'), path = require('path'), cp = require('child_process');
var PORT = 8093, BASE = 'http://localhost:' + PORT + '/', API = 'https://world.hana-api.com/api/v2/action/';
var only = process.argv[2] || '';

/* ---------------- fake data ---------------- */
var PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
function img(id) { var u = 'https://cdn.example/p/' + id + '.png'; return { poster: { webp: { large: u, medium: u }, jpg: { large: u } }, cover: { webp: u, jpg: u } }; }
function title(id, kind, name) {
  var series = kind !== 'movie';
  return { id: id, post_type: 'title', options: { title_type: kind, stream: true, is_series: series, free_stream: false },
    info: { seasons: series ? 2 : null, year: 2020 + (id % 6), age: 'PG-13', time: { default: series ? 45 : 120 } },
    title: { english: name || ((series ? 'Series ' : 'Movie ') + id), local: null }, plot: { english: 'Plot of ' + id, local: '' },
    image: img(id), genre: [{ name: 'Drama', slug: 'drama' }], score: { imdb: { score: 7.5, votes: 1000 } }, air: {} };
}
function posts(from, n, kind) { var a = []; for (var i = 0; i < n; i++) a.push(title(from + i, kind)); return a; }
var MOVIE = 101, SERIES = 201;
function streamFor(id) {
  var t = title(id, id >= 200 && id < 300 ? 'series' : 'movie'), hls = [];
  if (!t.options.is_series) hls.push({ info: { file_id: id * 10 }, file: { m3u8: [{ label: '1080p', 'default': 'https://cdn.example/v/' + id + '.m3u8' }] }, options: { token: 'x', end: '7000' } });
  else for (var s = 1; s <= 2; s++) for (var e = 1; e <= 4; e++)
    hls.push({ info: { file_id: id * 100 + s * 10 + e, season: s, episode: String(e), episode_number: e }, file: { m3u8: [{ label: '1080p', 'default': 'https://cdn.example/v/' + id + '-' + s + '-' + e + '.m3u8' }] }, options: { token: 'x', end: '2600' } });
  var st = { info: { post_id: id, title: t.title }, image: t.image, hls: hls };
  if (FAKE.cwStream[id]) st.continue_watching = FAKE.cwStream[id];
  return st;
}
var FAKE = {};
function resetFake() {
  FAKE = { calls: [], delay: {}, fail: {}, hang: {}, cw: [], cwStream: {}, dismissed: {}, archiveFailPage: 0 };
}
resetFake();
function respond(name, p) {
  FAKE.calls.push({ name: name, p: p });
  switch (name) {
    case 'test': return { success: true, result: { platform: 'WebTV' } };
    case 'user': return { success: true, result: { user_id: 7, user_name: 'Tester', user_session: 'tok', user_type: 'vip', user_expire: { days: 30 } } };
    case 'home_stream': return { success: true, result: { hero_header: { posts: posts(MOVIE, 3, 'movie') }, suggested: { posts: posts(MOVIE, 6, 'movie') }, movies: { posts: posts(MOVIE, 8, 'movie') }, series: { posts: posts(SERIES, 4, 'series') } } };
    case 'continue_watching': return { success: true, result: { posts: FAKE.cw } };
    case 'continue_watching_dismiss': FAKE.dismissed[p.id] = 1; return { success: true, result: null };
    case 'observer': return { success: true, result: null };
    case 'single': { var id = +p.post_id; var t = title(id, id >= 200 && id < 300 ? 'series' : 'movie'); t.cast = []; t.crew = {}; t.country = []; t.language = {}; t.note = {}; return { success: true, result: t }; }
    case 'stream': return { success: true, result: streamFor(+p.post_id) };
    case 'menu': return { success: true, result: { categories: [{ id: 1, name: 'Movies', slug: 'movies', image: {} }], genres: [{ id: 2, name: 'Action', slug: 'action', image: {} }, { id: 3, name: 'Drama', slug: 'drama', image: {} }] } };
    case 'user_mylist': return { success: true, result: { watchlist: [], favorite: [], notify: [] } };
    case 'advanced_search_parameters': return { success: true, result: { genre: [{ name: 'Action', value: 'action' }, { name: 'Drama', value: 'drama' }, { name: 'Comedy', value: 'comedy' }], type: [], imdb_rate: [{ name: 'Above 8.0', value: 8 }, { name: 'Above 7.0', value: 7 }], country: [{ name: 'United States', value: 'US' }, { name: 'South Korea', value: 'KR' }], language: [{ name: 'English', value: 'en' }, { name: 'Persian', value: 'fa' }], min_year: 1890, max_year: 2026, stream: [] } };
    case 'advanced_search': {
      var q = JSON.parse(p.parameters || '{}'), pg = +p.page || 1, n = q.genre ? 30 : 60, start = 1000 + (q.genre ? 500 : 0) + (pg - 1) * 24;
      var left = Math.max(0, Math.min(24, n - (pg - 1) * 24));
      return { success: true, result: { posts: posts(start, left, q.type && q.type[0] === 'series' ? 'series' : 'movie'), page: pg, pages: Math.ceil(n / 24), total: n } };
    }
    case 'archive': {
      var ap = +p.page || 1;
      if (FAKE.archiveFailPage === ap) { FAKE.archiveFailPage = 0; return '__500'; }
      return { success: true, result: { posts: posts(3000 + (ap - 1) * 24, 24, 'movie'), page: ap, pages: 3, total: 72 } };
    }
    case 'search': { var sp = +p.page || 1; return { success: true, result: { posts: posts(5000 + (sp - 1) * 24, 24, 'movie'), page: sp, pages: 2, total: 48 } }; }
    default: return { success: true, result: null };
  }
}

/* ---------------- fake Samsung AVPlay (time runs; seek before play() can be ignored like on some TVs) ---------------- */
var AVPLAY = function () {
  var A = window.__av = { mode: { ignoreSeekBeforePlay: true, ignoreFirstSeek: false, failPrepare: false }, cur: 0, dur: 3600000, playing: false, speed: 1, log: [], state: 'NONE', l: null, opened: [] };
  window.webapis = { avplay: {
    open: function (u) { A.url = u; A.cur = 0; A.playing = false; A.state = 'IDLE'; A.opened.push(u); A.firstSeekDone = false; },
    close: function () { A.state = 'NONE'; A.playing = false; },
    setDisplayRect: function () {}, setDisplayMethod: function () {},
    setListener: function (l) { A.l = l; },
    prepareAsync: function (ok, err) { setTimeout(function () { if (A.mode.failPrepare) { if (err) err('PLAYER_ERROR_CONNECTION_FAILED'); return; } A.state = 'READY'; if (ok) ok(); }, 150); },
    getDuration: function () { return A.dur; },
    play: function () { A.playing = true; A.state = 'PLAYING'; },
    pause: function () { A.playing = false; A.state = 'PAUSED'; },
    seekTo: function (ms, ok) {
      A.log.push([ms, A.state]);
      var ignore = (A.mode.ignoreSeekBeforePlay && A.state === 'READY') || (A.mode.ignoreFirstSeek && !A.firstSeekDone);
      A.firstSeekDone = true;
      if (!ignore) A.cur = ms;
      if (ok) setTimeout(ok, 30);
    },
    stop: function () { A.playing = false; A.state = 'IDLE'; }, suspend: function () {}, restore: function () {},
    getTotalTrackInfo: function () { return []; }, setSelectTrack: function () {}
  } };
  setInterval(function () {
    if (!A.playing) return;
    A.cur += 250 * A.speed;
    if (A.cur >= A.dur) { A.cur = A.dur; A.playing = false; if (A.l && A.l.onstreamcompleted) A.l.onstreamcompleted(); return; }
    if (A.l && A.l.oncurrentplaytime) A.l.oncurrentplaytime(A.cur);
  }, 250);
};

/* ---------------- runner ---------------- */
var results = [], browser, server;
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function newPage(o) {
  o = o || {};
  var ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  var page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', function (e) { page._errors.push(e.message); });
  await page.addInitScript(AVPLAY);
  var store = o.store || {};
  if (o.session !== false) store['n30.session'] = JSON.stringify({ token: 'tok', user: { user_id: 7, user_name: 'Tester', user_session: 'tok' } });
  store['n30.lang'] = JSON.stringify(o.lang || 'en');
  await page.addInitScript(function (st) { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', '1'); for (var k in st) localStorage.setItem(k, st[k]); } }, store);
  await page.route('**/proxy?url=**', async function (route) {
    var u = decodeURIComponent(new URL(route.request().url()).searchParams.get('url'));
    if (u.indexOf(API) === 0) {
      var name = u.slice(API.length), p = {};
      (route.request().postData() || '').split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
      if (FAKE.hang[name]) return; // never answers (the app must time out and recover)
      var d = FAKE.delay[name]; if (d) await sleep(d);
      if (FAKE.fail[name]) return route.fulfill({ status: 500, body: 'err' });
      var r = respond(name, p);
      if (r === '__500') return route.fulfill({ status: 500, body: 'err' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r), headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (/sdk-endpoint\.json/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ location: 'WORLD', host: 'https://world.hana-api.com/api/v2' }]) });
    if (/\.png$|\.jpg$|\.webp$/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (/\.m3u$/.test(u)) return route.fulfill({ status: 200, contentType: 'text/plain', body: '#EXTM3U\n#EXTINF:-1 tvg-id="a" group-title="News",Test News\nhttps://cdn.example/live/a.m3u8\n' });
    return route.fulfill({ status: 404, body: '' });
  });
  page.key = async function (k, n) { for (var i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await sleep(o.keyGap || 260); } };
  page.state = function () { return page.evaluate(function () {
    var c = N.nav.cur, s = document.querySelector('#content .screen');
    return { screen: s ? s.className : '', focus: c ? (c.className + ' | ' + (c.textContent || '').replace(/\s+/g, ' ').slice(0, 80)) : null, railOpen: !!(N.rail && N.rail.open), player: !!(N.player && N.player.open) };
  }); };
  return page;
}
async function test(name, fn) {
  if (only && name.toLowerCase().indexOf(only.toLowerCase()) < 0) return;
  resetFake();
  var page = null;
  try { page = await fn(function (o) { return newPage(o).then(function (p) { page = p; return p; }); }); var errs = page && page._errors.filter(function (e) { return !/webapis|hls/i.test(e); }); if (errs && errs.length) throw new Error('page errors: ' + errs.join(' | ')); results.push([name, true]); console.log('PASS ' + name); }
  catch (e) { results.push([name, false, e.message]); console.log('FAIL ' + name + '\n     ' + e.message); if (page) { try { console.log('     state: ' + JSON.stringify(await page.state())); await page.screenshot({ path: path.join(__dirname, '..', '..', 'e2e-fail-' + name.replace(/\W+/g, '_') + '.png') }); } catch (x) {} } }
  finally { if (page) await page.context().close(); }
}
function ok(c, m) { if (!c) throw new Error(m); }
async function waitFor(page, fn, ms, what) {
  var t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { try { if (await page.evaluate(fn)) return; } catch (e) {} await sleep(100); }
  throw new Error('timeout waiting for ' + (what || fn.toString().slice(0, 80)));
}
async function closePlayer(page) {
  for (var i = 0; i < 3 && await page.evaluate(function () { return N.player.open; }); i++) await page.key('Escape');
  await waitFor(page, function () { return !N.player.open; }, 3000, 'player closed');
}
function cwPost(id, kind, data) { var t = title(id, kind); t.data = data; return t; }

(async function main() {
  server = cp.spawn(process.execPath, [path.join(__dirname, 'devserver.js'), String(PORT)], { stdio: 'ignore' });
  await sleep(600);
  browser = await pw.chromium.launch();

  if (process.env.SHOTS) {
    for (var lang of ['fa', 'en']) {
      var pg = await newPage({ lang: lang }); await pg.goto(BASE);
      await waitFor(pg, function () { return N.nav.cur; }, 8000);
      FAKE.cw = [cwPost(SERIES, 'series', { season: 1, episode: '3', time: 600, progress: '22' })];
      await pg.evaluate(function () { N.go('browse', { type: 'movie', nameKey: 'movies' }, { reset: true }); });
      await waitFor(pg, function () { return document.querySelectorAll('.browse .gcell .card').length >= 24; }, 8000);
      await pg.evaluate(function () { var c = [].filter.call(document.querySelectorAll('.bchip'), function (x) { return x._key === 'genre'; })[0]; N.nav.focus(c); });
      await pg.key('Enter'); await pg.key('ArrowDown'); await sleep(900);
      await pg.screenshot({ path: process.env.SHOTS + '/browse-' + lang + '.png' });
      await pg.key('Enter'); await sleep(800);
      await pg.screenshot({ path: process.env.SHOTS + '/browse2-' + lang + '.png' });
      await pg.evaluate(function () { N.go('details', { id: 201 }); });
      await waitFor(pg, function () { return document.querySelector('.d-btns .btn'); }, 8000);
      await pg.evaluate(function () { N.resume.save(201, { season: 1, episode: '1', episode_number: 1 }, 2690, 2700); N.resume.save(201, { season: 1, episode: '2', episode_number: 2 }, 900, 2700); N.rerender(); });
      await sleep(800); await pg.key('ArrowDown'); await pg.key('ArrowDown'); await sleep(800);
      await pg.screenshot({ path: process.env.SHOTS + '/details-' + lang + '.png' });
      await pg.evaluate(function () { window.__av.mode.failPrepare = true; N.go('details', { id: 103, autoplay: 1 }); });
      await sleep(2500);
      await pg.screenshot({ path: process.env.SHOTS + '/err-' + lang + '.png' });
      await pg.context().close();
    }
    await browser.close(); server.kill(); process.exit(0);
  }

  await test('persian: all main screens build without script errors', async function (np) {
    var page = await np({ lang: 'fa' });
    FAKE.cw = [cwPost(SERIES, 'series', { season: 1, episode: '2', time: 600, progress: '22' })];
    await page.goto(BASE);
    await waitFor(page, function () { return document.querySelector('.k-cw') && N.nav.cur; }, 8000, 'home');
    var screens = [['browse', { type: 'series', nameKey: 'series' }], ['archive', {}], ['archive', { slug: 'movies', name: 'x' }], ['search', { q: 'abc' }], ['progress', {}], ['settings', {}], ['details', { id: 201 }], ['live', {}]];
    for (var i = 0; i < screens.length; i++) {
      await page.evaluate(function (a) { N.go(a[0], a[1], { reset: true }); }, screens[i]);
      await sleep(1500);
      var st = await page.state();
      ok(st.focus, 'no focus on ' + screens[i][0]);
      await page.key('ArrowDown'); await page.key('ArrowRight'); await page.key('ArrowLeft');
    }
    return page;
  });

  await test('boot reaches home with focus', async function (np) {
    var page = await np(); await page.goto(BASE);
    await waitFor(page, function () { return document.querySelector('.screen.home') && N.nav.cur; }, 8000, 'home with focus');
    return page;
  });

  await test('start-up with a dead API host shows Retry within 25 s', async function (np) {
    var page = await np({ store: { 'n30.host': JSON.stringify('https://world.hana-api.com/api/v2') } });
    FAKE.hang.test = 1;
    var t0 = Date.now(); await page.goto(BASE);
    await waitFor(page, function () { var c = N.nav.cur; return c && /Retry/.test(c.textContent); }, 26000, 'Retry button');
    ok(Date.now() - t0 < 25000, 'took ' + (Date.now() - t0) + ' ms');
    return page;
  });

  await test('remote works while a screen is loading (opens sidebar)', async function (np) {
    var page = await np(); FAKE.delay.home_stream = 4000;
    await page.goto(BASE);
    await waitFor(page, function () { return document.querySelector('.screen.home'); }, 8000);
    await page.key('ArrowDown');
    var s = await page.state(); ok(s.railOpen && s.focus && /ri/.test(s.focus), 'sidebar did not open: ' + JSON.stringify(s));
    return page;
  });

  await test('continue watching: card, details and player agree (resume seek on AVPlay)', async function (np) {
    var page = await np({ store: {} });
    FAKE.cw = [cwPost(MOVIE, 'movie', { time: 1800, progress: '25', display_time: '30:00' })];
    FAKE.cwStream[MOVIE] = { post_id: MOVIE, file_id: MOVIE * 10, time: 1800, progress: 25 };
    await page.goto(BASE);
    await waitFor(page, function () { return document.querySelector('.k-cw'); }, 8000, 'cw card');
    var cap = await page.evaluate(function () { return document.querySelector('.k-cw .cap').textContent; });
    ok(/90 min left/.test(cap), 'card caption: ' + cap);
    // OK on the card plays straight away at 30:00
    await page.evaluate(function () { N.nav.focus(document.querySelector('.k-cw')); });
    await page.key('Enter');
    await waitFor(page, function () { return N.player.open && window.__av.playing; }, 8000, 'player playing');
    await sleep(3500);
    var t = await page.evaluate(function () { return window.__av.cur / 1000; });
    ok(t >= 1795 && t < 1815, 'player position ' + t + ' (expected ~1800)');
    return page;
  });

  await test('resume survives a TV that ignores the first seek', async function (np) {
    var page = await np();
    FAKE.cwStream[MOVIE] = { post_id: MOVIE, file_id: MOVIE * 10, time: 1200, progress: 20 };
    await page.goto(BASE + '#');
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    await page.evaluate(function () { window.__av.mode.ignoreFirstSeek = true; window.__av.mode.ignoreSeekBeforePlay = false; N.go('details', { id: 101, autoplay: 1 }); });
    await waitFor(page, function () { return N.player.open && window.__av.playing; }, 8000);
    await sleep(6000);
    var t = await page.evaluate(function () { return window.__av.cur / 1000; });
    var dbg = await page.evaluate(function () { return JSON.stringify({ startAt: N.player.startAt, ok: N.player.startOk, re: N.player.reseeked, log: window.__av.log, opened: window.__av.opened.length, diag: N.diagLines() }); });
    ok(t >= 1195 && t < 1215, 'position after re-seek: ' + t + ' ' + dbg);
    // and nothing near 0 was saved over it
    var saved = await page.evaluate(function () { var m = N.resume.all(); return m['101:0:0'] && m['101:0:0'].t; });
    ok(!saved || saved >= 1190, 'saved ' + saved);
    return page;
  });

  await test('after watching, details and home show the same new spot', async function (np) {
    var page = await np();
    await page.goto(BASE);
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    await page.evaluate(function () { N.go('details', { id: 102 }); });
    await waitFor(page, function () { return document.querySelector('.d-btns .btn'); }, 8000);
    await page.key('Enter');
    await waitFor(page, function () { return N.player.open && window.__av.playing; }, 8000);
    await page.evaluate(function () { window.__av.cur = 3000 * 1000; });   // jump to 50:00
    await sleep(6000);
    await closePlayer(page);
    var det = await page.evaluate(function () { return document.querySelector('.d-resume') && document.querySelector('.d-resume').textContent; });
    ok(det && /10 min left/.test(det), 'details caption: ' + det);   // fake duration 60 min, stopped at 50:00
    await page.evaluate(function () { N.go('home', {}, { reset: true }); });
    await waitFor(page, function () { return document.querySelector('.k-cw'); }, 8000, 'cw row');
    var cap = await page.evaluate(function () { return document.querySelector('.k-cw .cap').textContent; });
    ok(/10 min left/.test(cap), 'home caption: ' + cap);
    return page;
  });

  await test('series: finished episode -> next episode everywhere, watched mark', async function (np) {
    var page = await np();
    await page.goto(BASE);
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    await page.evaluate(function () { window.__av.dur = 2700 * 1000; N.go('details', { id: 201 }); });
    await waitFor(page, function () { return document.querySelector('.d-btns .btn'); }, 8000);
    await page.key('Enter');
    await waitFor(page, function () { return N.player.open && window.__av.playing; }, 8000);
    await page.evaluate(function () { N.store.set('autoplay', false); window.__av.cur = 2650 * 1000; window.__av.speed = 10; });
    await waitFor(page, function () { return !N.player.open || window.__av.cur >= window.__av.dur; }, 20000, 'episode end');
    await sleep(800);
    await closePlayer(page);
    var det = await page.evaluate(function () { return { cap: (document.querySelector('.d-resume') || {}).textContent, watched: document.querySelectorAll('.k-ep.is-watched').length }; });
    ok(det.cap && /E2/.test(det.cap), 'details caption: ' + det.cap);
    ok(det.watched >= 1, 'watched marks: ' + det.watched);
    await page.evaluate(function () { N.go('home', {}, { reset: true }); });
    await waitFor(page, function () { return document.querySelector('.k-cw'); }, 8000, 'cw row');
    var cap = await page.evaluate(function () { return document.querySelector('.k-cw .cap').textContent; });
    ok(/E2/.test(cap) && /Next episode/.test(cap), 'home caption: ' + cap);
    return page;
  });

  await test('server is at a later episode: home, details and player all continue there', async function (np) {
    var page = await np({ store: { 'n30.resume': JSON.stringify({ '201:1:2': { t: 1200, d: 2700, f: '', ts: Date.now() - 3600e3 } }) } });
    FAKE.cw = [cwPost(SERIES, 'series', { season: 1, episode: '3', time: 600, progress: '22' })];
    FAKE.cwStream[SERIES] = { post_id: SERIES, file_id: SERIES * 100 + 13, time: 600, progress: 22 };
    await page.goto(BASE);
    await waitFor(page, function () { return document.querySelector('.k-cw'); }, 8000, 'cw card');
    var cap = await page.evaluate(function () { return document.querySelector('.k-cw .cap').textContent; });
    ok(/E3/.test(cap), 'home caption: ' + cap);
    await page.evaluate(function () { N.go('details', { id: 201 }); });
    await waitFor(page, function () { return document.querySelector('.d-resume'); }, 8000, 'details');
    var det = await page.evaluate(function () { return document.querySelector('.d-resume').textContent; });
    ok(/E3/.test(det), 'details caption: ' + det);
    await page.key('Enter');
    await waitFor(page, function () { return N.player.open && window.__av.playing; }, 8000);
    await sleep(3000);
    var r = await page.evaluate(function () { return { url: window.__av.url, t: window.__av.cur / 1000 }; });
    ok(/201-1-3/.test(r.url) && r.t >= 595 && r.t < 615, 'player ' + JSON.stringify(r));
    return page;
  });

  await test('a request that never answers does not freeze the app', async function (np) {
    var page = await np();
    await page.goto(BASE);
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    FAKE.hang.single = 1;
    await page.evaluate(function () { N.go('details', { id: 105 }); });
    await sleep(1000);
    await page.key('Escape');   // Back still works while it hangs
    await waitFor(page, function () { return document.querySelector('.screen.home') && N.nav.cur; }, 4000, 'back to home');
    await page.evaluate(function () { N.go('details', { id: 106 }); });
    await waitFor(page, function () { var c = N.nav.cur; return c && /Retry/.test(c.textContent); }, 20000, 'retry after timeout');
    FAKE.hang.single = 0;
    await page.key('Enter');
    await waitFor(page, function () { return document.querySelector('.d-btns .btn'); }, 8000, 'details after retry');
    return page;
  });

  await test('live tv: channel list loads and a channel plays', async function (np) {
    var page = await np();
    await page.goto(BASE);
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    await page.evaluate(function () { N.go('live', {}, { reset: true }); });
    await waitFor(page, function () { return document.querySelector('.screen.live .card'); }, 10000, 'channel card');
    await page.evaluate(function () { N.nav.focus(document.querySelector('.screen.live .card')); });
    await page.key('Enter');
    await waitFor(page, function () { return window.__av.playing; }, 8000, 'live playing');
    return page;
  });

  await test('dismissed continue-watching title stays hidden', async function (np) {
    var page = await np();
    FAKE.cw = [cwPost(MOVIE + 1, 'movie', { time: 600, progress: '10' }), cwPost(MOVIE + 2, 'movie', { time: 900, progress: '12' })];
    await page.goto(BASE);
    await waitFor(page, function () { return document.querySelectorAll('.k-cw').length === 2; }, 8000, '2 cw cards');
    await page.evaluate(function () { var p = N.cwData; N.cwDismiss({ id: 102, data: p[102] }); });
    FAKE.cw[0].data.time = 650;   // the server still lists it, with a newer time
    await page.evaluate(function () { N.dropHome(); N.go('home', {}, { reset: true }); });
    await sleep(1500);
    var n = await page.evaluate(function () { return document.querySelectorAll('.k-cw').length; });
    ok(n === 1, 'cw cards after dismiss: ' + n);
    return page;
  });

  await test('browse: filters apply at once, live count, paging', async function (np) {
    var page = await np();
    await page.goto(BASE);
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    await page.evaluate(function () { N.go('browse', { type: 'movie', nameKey: 'movies' }, { reset: true }); });
    await waitFor(page, function () { return document.querySelectorAll('.browse .gcell .card').length >= 24; }, 8000, 'grid');
    // focus the Genre chip and open it
    await page.evaluate(function () { var c = [].filter.call(document.querySelectorAll('.bchip'), function (x) { return x._key === 'genre'; })[0]; N.nav.focus(c); });
    await page.key('Enter');
    await waitFor(page, function () { return document.querySelector('.bpop .chk.focus'); }, 3000, 'popover');
    await page.key('ArrowDown');
    await waitFor(page, function () { return /30 titles/.test(document.querySelector('.bpop .bp-c').textContent); }, 4000, 'live count');
    await page.key('Enter');
    await waitFor(page, function () { return !document.querySelector('.bpop') && /30 titles/.test(document.querySelector('.ah .cnt').textContent); }, 5000, 'filtered grid');
    var last = FAKE.calls.filter(function (c) { return c.name === 'advanced_search'; }).pop();
    var q = JSON.parse(last.p.parameters);
    ok(q.genre && q.genre[0] === 'action' && q.type[0] === 'movie' && q.stream === 'true', 'query ' + last.p.parameters);
    // paging: go down to the end, page 2 arrives
    await page.evaluate(function () { N.nav.focus(document.querySelector('.browse .gcell .card')); });
    await page.key('ArrowDown', 4);
    await waitFor(page, function () { return document.querySelectorAll('.browse .gcell .card').length === 30; }, 5000, 'page 2');
    return page;
  });

  await test('archive: a failed page is fetched again, not skipped', async function (np) {
    var page = await np();
    await page.goto(BASE);
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    FAKE.archiveFailPage = 2;
    await page.evaluate(function () { N.go('archive', { slug: 'movies', name: 'Movies' }, { reset: true }); });
    await waitFor(page, function () { return document.querySelectorAll('.ggrid .gcell .card').length === 24; }, 8000, 'page 1');
    await page.evaluate(function () { N.nav.focus(document.querySelector('.ggrid .gcell .card')); });
    await page.key('ArrowDown', 3); await sleep(800); await page.key('ArrowUp'); await page.key('ArrowDown');
    await waitFor(page, function () { return document.querySelectorAll('.ggrid .gcell .card').length === 48; }, 6000, 'page 2 after retry');
    var pages = FAKE.calls.filter(function (c) { return c.name === 'archive'; }).map(function (c) { return c.p.page; });
    ok(pages.join(',').indexOf('1,2,2') === 0, 'pages requested: ' + pages.join(','));
    return page;
  });

  await test('search: results while typing, more pages', async function (np) {
    var page = await np();
    await page.goto(BASE);
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    await page.evaluate(function () { N.go('search', { q: 'dune' }, { reset: true }); });
    await waitFor(page, function () { return document.querySelectorAll('.rgrid .gcell').length === 24; }, 8000, 'results');
    await page.evaluate(function () { var c = document.querySelectorAll('.rgrid .gcell .card'); N.nav.focus(c[20]); });
    await waitFor(page, function () { return document.querySelectorAll('.rgrid .gcell').length === 48; }, 5000, 'page 2');
    return page;
  });

  await test('player error offers retry with OK', async function (np) {
    var page = await np();
    await page.goto(BASE);
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    await page.evaluate(function () { window.__av.mode.failPrepare = true; N.go('details', { id: 103, autoplay: 1 }); });
    await waitFor(page, function () { var b = document.getElementById('player-err'); return b && b.classList.contains('show'); }, 8000, 'error box');
    await page.evaluate(function () { window.__av.mode.failPrepare = false; });
    await page.key('Enter');
    await waitFor(page, function () { return window.__av.playing && !document.getElementById('player-err').classList.contains('show'); }, 6000, 'playing after retry');
    return page;
  });

  await test('Back with sidebar open on a sub-page closes the sidebar', async function (np) {
    var page = await np();
    await page.goto(BASE);
    await waitFor(page, function () { return N.nav.cur; }, 8000);
    await page.evaluate(function () { N.go('details', { id: 104 }); });
    await waitFor(page, function () { return document.querySelector('.d-btns .btn'); }, 8000);
    await page.evaluate(function () { N.rail.enter(); });
    await page.key('Escape');
    var s = await page.state(), modal = await page.evaluate(function () { return !!document.querySelector('.modal'); });
    ok(!s.railOpen && !modal, 'rail open ' + s.railOpen + ', exit dialog ' + modal);
    return page;
  });

  await browser.close(); server.kill();
  var bad = results.filter(function (r) { return !r[1]; });
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' passed');
  process.exit(bad.length ? 1 : 0);
})().catch(function (e) { console.error(e); if (server) server.kill(); process.exit(1); });
