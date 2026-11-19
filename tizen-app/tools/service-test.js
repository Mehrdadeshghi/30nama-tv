// Tests service/phone.js the way TizenBrew runs it (vm sandbox with the host's globals and require), on a temp folder:
// code check for LAN clients, resumable upload, byte-exact storage, Range streaming WHILE the upload is still running,
// fast-start detection + auto play request, remote-control requests, delete, restart with the saved index.
// Usage: node tizen-app/tools/service-test.js
var vm = require('vm'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
var SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'service', 'phone.js'), 'utf8');
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'n30svc-')), DATA = path.join(TMP, 'data'), bad = 0, PORT = 8030;
process.env.N30PHONE_DIR = DATA;
process.on('warning', function () {});               // new Buffer() deprecation (Node 4 on the TV has no Buffer.from)

function start() {
  var sb = {};
  Object.getOwnPropertyNames(global).forEach(function (k) { if (['module', 'global'].indexOf(k) < 0) sb[k] = global[k]; });
  sb.require = require; sb.module = { exports: {} };
  vm.runInContext(SCRIPT, vm.createContext(sb));
}
function ok(c, m) { if (!c) { bad++; console.error('FAIL ' + m); } else console.log('ok   ' + m); }
// MP4-shaped test files (box headers are all the service looks at): fast start = ftyp, moov, mdat; normal = ftyp, free, mdat, moov
function box(type, len) { var b = Buffer.alloc(len); b.writeUInt32BE(len, 0); b.write(type, 4, 'ascii'); for (var i = 8; i < len; i++) b[i] = (i * 7 + len) & 255; return b; }
function mkvid(name, faststart) {
  var parts = faststart ? [box('ftyp', 32), box('moov', 40000), box('mdat', 7000000)] : [box('ftyp', 32), box('free', 8), box('mdat', 7000000), box('moov', 40000)];
  return Buffer.concat(parts);
}
function rq(method, p, o) {
  o = o || {};
  return new Promise(function (res, rej) {
    var r = http.request({ host: '127.0.0.1', port: PORT, method: method, path: p, headers: o.headers || {}, localAddress: o.lan ? '127.0.0.2' : undefined }, function (s) {
      var bufs = []; s.on('data', function (d) { bufs.push(d); }); s.on('end', function () {
        var b = Buffer.concat(bufs), j = null; try { j = JSON.parse(b.toString()); } catch (e) {}
        res({ st: s.statusCode, h: s.headers, b: b, j: j });
      });
    });
    r.on('error', rej);
    if (o.body && o.slow) {           // trickle the body: o.slow bytes every 50 ms
      var i = 0; (function pump() { if (i >= o.body.length) return r.end(); r.write(o.body.slice(i, i + o.slow)); i += o.slow; setTimeout(pump, 50); })();
    } else r.end(o.body || null);
    if (o.abortAfter) setTimeout(function () { r.destroy(); res({ st: 'aborted' }); }, o.abortAfter);
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  var fast = mkvid('fast.mp4', true), slow = mkvid('slow.mp4', false);
  start(); await sleep(300);

  var s = await rq('GET', '/api/state');
  ok(s.st === 200 && /^\d{4}$/.test(s.j.code), 'state from the TV itself carries the 4-digit code');
  var CODE = s.j.code;
  ok((await rq('GET', '/api/state', { lan: true })).st === 403, 'LAN client without code is refused');
  ok((await rq('GET', '/api/state?k=' + CODE, { lan: true })).j.code === undefined, 'LAN client with code gets state without the code');
  var pg = await rq('GET', '/' + CODE, { lan: true });
  ok(pg.st === 200 && pg.b.toString().indexOf("var CODE = '" + CODE + "'") > 0, 'phone page has the code');
  ok((await rq('GET', '/0000', { lan: true })).b.toString().indexOf("var CODE = ''") > 0, 'wrong code -> code entry page');

  // resumable upload: first 40 %, broken, then the rest from the reported offset
  var q = '?k=' + CODE + '&size=' + slow.length + '&name=' + encodeURIComponent('Telegram Video ویدیو.mp4') + '&type=video%2Fmp4';
  await rq('POST', '/api/up/a1' + q + '&off=0', { lan: true, body: slow.slice(0, Math.floor(slow.length * 0.4)), slow: 64 * 1024, abortAfter: 400 });
  await sleep(200);
  var g = await rq('GET', '/api/up/a1?k=' + CODE, { lan: true });
  ok(g.j && g.j.recv > 0 && g.j.recv < slow.length && !g.j.done, 'interrupted upload keeps ' + (g.j && g.j.recv) + ' bytes');
  ok((await rq('POST', '/api/up/a1' + q + '&off=' + (g.j.recv + 5), { lan: true, body: Buffer.alloc(1) })).st === 409, 'resume past the stored end is refused (409)');
  var fin = await rq('POST', '/api/up/a1' + q + '&off=' + g.j.recv, { lan: true, body: slow.slice(g.j.recv) });
  ok(fin.st === 200 && fin.j.done, 'resumed upload completes');
  ok(Buffer.compare(fs.readFileSync(path.join(DATA, 'a1.mp4')), slow) === 0, 'stored file is byte-identical');
  s = await rq('GET', '/api/state');
  var a1 = s.j.items.filter(function (x) { return x.id === 'a1'; })[0];
  ok(a1 && a1.done && a1.ready && !a1.fast && a1.name === 'Telegram Video ویدیو.mp4', 'normal MP4: done, playable, not fast-start, name kept');
  ok(s.j.play.n === 0, 'no auto play without auto=1');

  // fast-start upload with auto play, streamed by the "TV" while it is still arriving
  var q2 = '?k=' + CODE + '&size=' + fast.length + '&name=fast.mp4&auto=1&off=0';
  var upP = rq('POST', '/api/up/b2' + q2, { lan: true, body: fast, slow: 96 * 1024 });     // ~1.9 MB/s
  var played = null;
  for (var i = 0; i < 60 && !played; i++) { await sleep(100); s = await rq('GET', '/api/state'); if (s.j.play.n > 0) played = s.j; }
  var b2 = played && played.items.filter(function (x) { return x.id === 'b2'; })[0];
  ok(played && played.play.id === 'b2' && b2 && !b2.done && b2.fast, 'fast-start file: play request while still uploading (' + (b2 && Math.round(b2.recv / 1e6)) + ' MB in)');
  var t0 = Date.now(), whole = await rq('GET', '/v/b2.mp4');
  ok(whole.st === 200 && Buffer.compare(whole.b, fast) === 0, 'stream during upload delivers the whole file exactly (waited ' + (Date.now() - t0) + ' ms)');
  var up2 = await upP; ok(up2.j && up2.j.done, 'upload b2 completes');
  var rg = await rq('GET', '/v/b2.mp4', { headers: { Range: 'bytes=1000-1999' } });
  ok(rg.st === 206 && rg.b.length === 1000 && Buffer.compare(rg.b, fast.slice(1000, 2000)) === 0 && rg.h['content-range'] === 'bytes 1000-1999/' + fast.length, 'Range request');
  var sf = await rq('GET', '/v/b2.mp4', { headers: { Range: 'bytes=-500' } });
  ok(sf.st === 206 && Buffer.compare(sf.b, fast.slice(fast.length - 500)) === 0, 'suffix Range request');
  ok((await rq('GET', '/v/b2.mp4', { lan: true })).st === 403, 'LAN client cannot stream without code');

  // play / remote / delete
  var p1 = await rq('POST', '/api/play/a1?k=' + CODE, { lan: true }); s = await rq('GET', '/api/state');
  ok(p1.j.ok && s.j.play.id === 'a1' && s.j.play.n === 2, 'phone asks to play a1');
  await rq('POST', '/api/ctl?a=toggle&k=' + CODE, { lan: true }); s = await rq('GET', '/api/state');
  ok(s.j.ctl.a === 'toggle' && s.j.ctl.n === 1, 'remote-control request');
  ok((await rq('POST', '/api/ctl?a=rm&k=' + CODE, { lan: true })).st === 400, 'unknown remote command refused');

  // restart: index survives, a half upload can still be resumed
  await rq('POST', '/api/up/c3' + '?k=' + CODE + '&size=' + fast.length + '&name=c.mp4&off=0', { lan: true, body: fast.slice(0, 2000000), slow: 256 * 1024, abortAfter: 250 });
  await sleep(200);
  start(); await sleep(300);
  s = await rq('GET', '/api/state');
  var ids = s.j.items.map(function (x) { return x.id; }).sort().join(',');
  ok(ids === 'a1,b2,c3' && s.j.code === CODE, 'after restart: items and code kept (' + ids + ')');
  var c3 = s.j.items.filter(function (x) { return x.id === 'c3'; })[0];
  var r3 = await rq('POST', '/api/up/c3?k=' + CODE + '&size=' + fast.length + '&off=' + c3.recv, { lan: true, body: fast.slice(c3.recv) });
  ok(r3.j && r3.j.done && Buffer.compare(fs.readFileSync(path.join(DATA, 'c3.mp4')), fast) === 0, 'resume after restart is byte-identical');
  await rq('POST', '/api/del/a1?k=' + CODE, { lan: true });
  ok(!fs.existsSync(path.join(DATA, 'a1.mp4')) && (await rq('GET', '/v/a1.mp4')).st === 404, 'delete removes file');

  try { process.__n30phone.server.close(); } catch (e) {}
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(bad ? bad + ' failure(s)' : 'all service tests passed');
  process.exit(bad ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
