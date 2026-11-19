/* 30nama "از گوشی / From phone": a small web server on the TV so a phone can hand over a video file (e.g. one saved from
   Telegram) and the TV plays the ORIGINAL file with its own player – full sound, no screen mirroring.
   Runs inside TizenBrew's service process (package.json "serviceFile"): Node 4.4.3 on 2018 TVs, inside a vm sandbox
   that shares `process` with TizenBrew itself. So: ES5 only, no Buffer.from, and NOTHING may throw out of a callback
   (an uncaught exception would take the whole TizenBrew service down). Built into service/phone.js by
   tools/build-service.js (the phone page is inlined there).

   Phone:  GET /<code>                   upload page (4-digit code from the TV screen; QR carries it)
           POST /api/up/<id>?off=&size=  raw file bytes from offset `off` (resumable: a broken upload continues)
           GET  /api/up/<id>             how many bytes arrived (to resume)
           POST /api/play/<id>, /api/del/<id>, /api/ctl?a=toggle|back|fwd|stop
   TV app (127.0.0.1, no code needed):
           GET  /api/state               items, upload progress, play request, remote-control request
           GET  /v/<id>.<ext>            the file, with Range – also WHILE it is still uploading (waits for bytes),
                                         so a "fast start" MP4 (index first, as Telegram sends them) plays within seconds */
(function () {
  'use strict';
  var http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
  var VERSION = '__VERSION__', PORT = 8030, KEEP = 4, CHUNK = 256 * 1024, STALL_MS = 90000, RESERVE = 300 * 1048576;
  var PAGE = '__PAGE__';

  // one instance per TizenBrew process: a restarted service closes the old server first (else the port is taken)
  var prev = process.__n30phone;
  if (prev && prev.server) { try { prev.server.close(); } catch (e) {} try { prev.stop(); } catch (e) {} }
  var G = process.__n30phone = { server: null, stop: function () {} };

  var logs = [];
  function log(m) {
    var d = new Date(), t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    logs.push(t + ' ' + m); if (logs.length > 60) logs.shift();
    try { console.log('[n30phone] ' + m); } catch (e) {}
  }
  function safe(fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { log('error ' + (e && e.stack || e)); } }; }

  /* ---------- storage ---------- */
  function mkdirs(d) { if (fs.existsSync(d)) return; mkdirs(path.dirname(d)); fs.mkdirSync(d); }
  function pickDir() {
    var c = [];
    if (process.env.N30PHONE_DIR) c.push(process.env.N30PHONE_DIR);
    try { if (typeof tizen !== 'undefined') c.push('/opt/usr/home/owner/apps_rw/' + tizen.application.getAppInfo().packageId + '/data/n30phone'); } catch (e) {}
    c.push('/opt/usr/home/owner/content/Downloads/.n30phone');
    c.push(path.join(os.tmpdir(), 'n30phone'));
    for (var i = 0; i < c.length; i++) {
      try { mkdirs(c[i]); var p = path.join(c[i], '.probe'); fs.writeFileSync(p, 'x'); fs.unlinkSync(p); return c[i]; } catch (e) {}
    }
    return null;
  }
  var DIR = pickDir(), items = [], code = '', playReq = { n: 0 }, ctlReq = { n: 0 };
  function idxFile() { return path.join(DIR, 'index.json'); }
  function save() {
    if (!DIR) return;
    var out = items.map(function (it) { return { id: it.id, name: it.name, type: it.type, ext: it.ext, size: it.size, recv: it.recv, done: it.done, t: it.t, fast: it.fast }; });
    try { fs.writeFileSync(idxFile(), JSON.stringify({ code: code, items: out })); } catch (e) { log('save ' + e.message); }
  }
  function fileOf(it) { return path.join(DIR, it.id + '.' + it.ext); }
  function load() {
    var j = null;
    try { j = JSON.parse(fs.readFileSync(idxFile(), 'utf8')); } catch (e) {}
    code = j && /^\d{4}$/.test(j.code) ? j.code : String(1000 + Math.floor(Math.random() * 9000));
    items = [];
    ((j && j.items) || []).forEach(function (it) {
      try { var st = fs.statSync(fileOf(it)); it.recv = Math.min(st.size, it.size || st.size); it.gen = 0; items.push(it); } catch (e) {}
    });
    // files nobody lists any more (crash between write and save)
    try {
      fs.readdirSync(DIR).forEach(function (f) {
        if (f === 'index.json' || f.charAt(0) === '.') return;
        var known = items.some(function (it) { return f === it.id + '.' + it.ext; });
        if (!known) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {} }
      });
    } catch (e) {}
    save();
  }
  function byId(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }
  function freeBytes() {
    try {
      var out = String(cp.execSync('df -k "' + DIR + '"', { timeout: 3000 })).trim().split('\n');
      var cols = out[out.length - 1].trim().split(/\s+/);
      var kb = parseInt(cols[cols.length - 3], 10);
      return kb >= 0 ? kb * 1024 : null;
    } catch (e) { return null; }
  }
  function remove(it) {
    if (it.req) { try { it.req.destroy(); } catch (e) {} }
    try { fs.unlinkSync(fileOf(it)); } catch (e) {}
    var i = items.indexOf(it); if (i >= 0) items.splice(i, 1);
  }
  // keep the newest few; make space for `need` bytes by dropping the oldest finished ones
  function makeRoom(need, keep) {
    var old = items.filter(function (it) { return it !== keep && !it.req; }).sort(function (a, b) { return a.t - b.t; });
    while (old.length && items.length > KEEP) remove(old.shift());
    var free = freeBytes();
    while (free !== null && free < need + RESERVE && old.length) { var it = old.shift(); free += it.recv || 0; remove(it); }
    return free === null || free >= need + RESERVE;
  }

  /* ---------- "fast start": is the MP4 index (moov) in front of the media data? ---------- */
  function checkFast(it) {
    if (it.fast !== undefined && it.fast !== null) return;
    if (!/^(mp4|m4v|mov|3gp)$/.test(it.ext)) { it.fast = it.ext === 'webm' || it.ext === 'mkv' ? (it.recv > 2 * 1048576) : false; return; }
    var len = Math.min(it.recv, 4 * 1048576); if (len < 4096) return;
    var buf = new Buffer(len), fd;
    try { fd = fs.openSync(fileOf(it), 'r'); fs.readSync(fd, buf, 0, len, 0); } catch (e) { return; } finally { try { if (fd !== undefined) fs.closeSync(fd); } catch (e) {} }
    var pos = 0;
    while (pos + 8 <= len) {
      var sz = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
      if (type === 'moov') { it.fast = true; return; }
      if (type === 'mdat') { it.fast = false; return; }
      if (sz === 1) { if (pos + 16 > len) return; sz = buf.readUInt32BE(pos + 8) * 4294967296 + buf.readUInt32BE(pos + 12); }
      if (sz < 8) { it.fast = false; return; }
      pos += sz;
    }
    if (it.recv >= 4 * 1048576 || it.done) it.fast = false; // index not found near the start: play when complete
  }
  // ready to play: whole file, or a fast-start file with a few MB in hand
  function playable(it) { return it.done || (it.fast === true && it.recv >= Math.min(it.size, 3 * 1048576)); }
  function maybeAutoplay(it) {
    if (!it.auto || it.autoSent || !playable(it)) return;
    it.autoSent = true; requestPlay(it);
  }
  function requestPlay(it) { playReq = { n: playReq.n + 1, id: it.id, t: Date.now() }; log('play ' + it.name); }

  /* ---------- helpers ---------- */
  function isLocal(req) { var a = req.socket && req.socket.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; }
  function query(u) {
    var q = {}, i = u.indexOf('?'); if (i < 0) return q;
    u.slice(i + 1).split('&').forEach(function (kv) {
      var p = kv.split('='); if (!p[0]) return;
      try { q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (e) { q[p[0]] = p[1] || ''; }
    });
    return q;
  }
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,HEAD,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Range', 'Cache-Control': 'no-store' };
  function head(extra) { var h = {}, k; for (k in CORS) h[k] = CORS[k]; for (k in extra || {}) h[k] = extra[k]; return h; }
  function json(res, st, o) {
    if (res.headersSent) { try { res.end(); } catch (e) {} return; }
    var b = new Buffer(JSON.stringify(o), 'utf8');
    res.writeHead(st, head({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length }));
    res.end(b);
  }
  function ip() {
    var nets = os.networkInterfaces(), best = '', names = Object.keys(nets);
    names.sort(function (a, b) { return (/^(wlan|eth)/.test(b) ? 1 : 0) - (/^(wlan|eth)/.test(a) ? 1 : 0); });
    names.forEach(function (n) {
      (nets[n] || []).forEach(function (a) { if (!best && a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) best = a.address; });
    });
    return best;
  }
  var MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', ts: 'video/mp2t', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac' };
  function extOf(name, type) {
    var m = /\.([a-z0-9]{2,4})$/i.exec(name || ''), e = m ? m[1].toLowerCase() : '';
    if (MIME[e]) return e;
    for (var k in MIME) if (MIME[k] === type) return k;
    return 'mp4';
  }
  function pub(it) {
    return { id: it.id, name: it.name, size: it.size, recv: it.recv, done: !!it.done, t: it.t, ext: it.ext, rate: it.req ? it.rate || 0 : 0,
      busy: !!it.req, fast: it.fast === true, ready: playable(it), err: it.err || '' };
  }

  /* ---------- upload (resumable, raw body) ---------- */
  function upload(req, res, id, q) {
    var off = parseInt(q.off, 10) || 0, size = parseInt(q.size, 10) || 0, it = byId(id);
    if (!it) {
      if (off !== 0) return json(res, 409, { recv: 0, err: 'gone' });
      if (!makeRoom(size, null)) return json(res, 507, { err: 'space', free: freeBytes() });
      var name = String(q.name || 'video').slice(0, 160);
      it = { id: id, name: name, type: String(q.type || ''), ext: extOf(name, q.type), size: size, recv: 0, done: false, t: Date.now(), gen: 0, auto: q.auto === '1' };
      items.push(it); save(); log('upload ' + name + ' ' + Math.round(size / 1048576) + ' MB');
    } else if (q.auto === '1') it.auto = true;
    if (it.done) return json(res, 200, { recv: it.recv, done: true });
    if (off > it.recv) return json(res, 409, { recv: it.recv });
    if (it.req && it.req !== req) { try { it.req.destroy(); } catch (e) {} }   // an older, broken attempt
    var gen = it.gen = (it.gen || 0) + 1, finished = false, gotEnd = false;
    it.req = req; it.recv = off; it.err = '';
    var ws = fs.createWriteStream(fileOf(it), { flags: off === 0 ? 'w' : 'r+', start: off });
    var win = { t: Date.now(), b: off };
    function end(st, o) {
      if (finished) return; finished = true;
      if (it.req === req) it.req = null;
      save(); json(res, st, o);
    }
    ws.on('error', safe(function (e) {
      it.err = /ENOSPC/.test(e.code || e.message) ? 'space' : 'write';
      log('write error ' + (e.code || e.message));
      try { req.destroy(); } catch (x) {}
      end(507, { recv: it.recv, err: it.err });
    }));
    req.on('data', safe(function (ch) {
      if (it.gen !== gen) return;
      var ok = ws.write(ch, safe(function () {
        if (it.gen !== gen) return;
        it.recv += ch.length;
        var now = Date.now();
        if (now - win.t >= 1000) { it.rate = Math.round((it.recv - win.b) * 1000 / (now - win.t)); win.t = now; win.b = it.recv; }
        if (!it.fast && it.fast !== false) checkFast(it);
        maybeAutoplay(it);
      }));
      if (!ok) { req.pause(); ws.once('drain', function () { req.resume(); }); }
    }));
    req.on('end', safe(function () {
      gotEnd = true;
      ws.end(safe(function () {
        if (it.gen !== gen) return end(200, { recv: it.recv });
        if (!it.size || it.recv >= it.size) { it.size = it.recv; it.done = true; it.rate = 0; checkFast(it); maybeAutoplay(it); log('complete ' + it.name); }
        end(200, { recv: it.recv, done: it.done });
      }));
    }));
    req.on('close', safe(function () { if (!finished && !gotEnd) { try { ws.end(); } catch (e) {} if (it.req === req) it.req = null; save(); log('upload interrupted at ' + Math.round(it.recv / 1048576) + ' MB'); } }));
  }

  /* ---------- file streaming with Range, while the upload may still be running ---------- */
  function stream(req, res, it) {
    var total = it.size || it.recv, start = 0, end = total - 1, st = 200;
    var r = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
    if (r) {
      if (r[1] === '') { start = Math.max(0, total - (parseInt(r[2], 10) || 0)); }
      else { start = parseInt(r[1], 10); if (r[2] !== '') end = Math.min(parseInt(r[2], 10), total - 1); }
      st = 206;
    }
    if (!(total > 0) || start >= total || start > end) { res.writeHead(416, head({ 'Content-Range': 'bytes */' + total })); return res.end(); }
    var h = { 'Content-Type': MIME[it.ext] || 'application/octet-stream', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' };
    if (st === 206) h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + total;
    res.writeHead(st, head(h));
    if (req.method === 'HEAD') return res.end();
    var pos = start, fd = null, closed = false, waitT = 0, lastGain = Date.now(), lastRecv = it.recv;
    function close() { closed = true; clearTimeout(waitT); if (fd !== null) { var f = fd; fd = null; fs.close(f, function () {}); } }
    res.on('close', close);
    var step = safe(function () {
      if (closed) return;
      if (pos > end) { close(); return res.end(); }
      if (byId(it.id) !== it) { close(); return res.destroy(); }               // deleted meanwhile
      var avail = it.done ? total : it.recv;
      if (it.recv !== lastRecv) { lastRecv = it.recv; lastGain = Date.now(); }
      if (pos >= avail) {
        if (Date.now() - lastGain > STALL_MS) { log('stream gave up waiting at ' + Math.round(pos / 1048576) + ' MB'); close(); return res.destroy(); }
        waitT = setTimeout(step, 250); return;
      }
      var n = Math.min(CHUNK, end + 1 - pos, avail - pos), buf = new Buffer(n);
      fs.read(fd, buf, 0, n, pos, safe(function (err, got) {
        if (closed) return;
        if (err || !got) { close(); return res.destroy(); }
        pos += got;
        if (res.write(got === n ? buf : buf.slice(0, got))) setImmediate(step); else res.once('drain', step);
      }));
    });
    fs.open(fileOf(it), 'r', safe(function (err, f) {
      if (err) { closed = true; return res.destroy(); }
      if (closed) { fs.close(f, function () {}); return; }
      fd = f; step();
    }));
  }

  /* ---------- routes ---------- */
  function codeOk(req, q, seg) { return isLocal(req) || q.k === code || seg === code; }
  var handle = safe(function (req, res) {
    var url = req.url || '/', p = url.split('?')[0], q = query(url), parts = p.split('/').filter(Boolean), local = isLocal(req);
    if (req.method === 'OPTIONS') { res.writeHead(204, head()); return res.end(); }
    if (!DIR) return json(res, 500, { err: 'nostorage' });
    // phone page: /1234 (also / with ?k=); without the right code a small "enter the code" page
    if (req.method === 'GET' && (parts.length === 0 || (parts.length === 1 && /^\d{4}$/.test(parts[0])))) {
      var ok = (parts[0] && parts[0] === code) || q.k === code, body = new Buffer(PAGE.replace(/__CODE__/g, ok ? code : '').replace(/__VER__/g, VERSION), 'utf8');
      res.writeHead(200, head({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length }));
      return res.end(body);
    }
    if (p === '/favicon.ico') { res.writeHead(204, head()); return res.end(); }
    if (parts[0] === 'v' && parts[1]) {
      var it0 = byId(parts[1].split('.')[0]);
      if (!it0) { res.writeHead(404, head()); return res.end(); }
      if (!codeOk(req, q, '')) { res.writeHead(403, head()); return res.end(); }
      return stream(req, res, it0);
    }
    if (parts[0] !== 'api') { res.writeHead(404, head()); return res.end(); }
    if (parts[1] === 'state') {
      if (!codeOk(req, q, '')) return json(res, 403, { err: 'code' });
      var o = { v: VERSION, port: PORT, ip: ip(), items: items.slice().sort(function (a, b) { return b.t - a.t; }).map(pub), play: playReq, ctl: ctlReq, now: Date.now() };
      if (local) { o.code = code; o.dir = DIR; o.log = logs.slice(-20); if (q.free) o.free = freeBytes(); }
      return json(res, 200, o);
    }
    if (!codeOk(req, q, '')) return json(res, 403, { err: 'code' });
    var id = String(parts[2] || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40), it = id ? byId(id) : null;
    if (parts[1] === 'up' && id) {
      if (req.method === 'POST') return upload(req, res, id, q);
      return json(res, 200, it ? { recv: it.recv, size: it.size, done: !!it.done } : { recv: 0, gone: true });
    }
    if (req.method !== 'POST') return json(res, 405, { err: 'method' });
    if (parts[1] === 'play') { if (!it) return json(res, 404, { err: 'gone' }); requestPlay(it); return json(res, 200, { ok: true, ready: playable(it) }); }
    if (parts[1] === 'del') { if (it) { remove(it); save(); log('deleted ' + it.name); } return json(res, 200, { ok: true }); }
    if (parts[1] === 'ctl') {
      var a = String(q.a || ''); if (!/^(toggle|back|fwd|stop)$/.test(a)) return json(res, 400, { err: 'a' });
      ctlReq = { n: ctlReq.n + 1, a: a, t: Date.now() }; return json(res, 200, { ok: true });
    }
    if (parts[1] === 'newcode' && local) { code = String(1000 + Math.floor(Math.random() * 9000)); save(); return json(res, 200, { code: code }); }
    json(res, 404, { err: 'route' });
  });

  /* ---------- start ---------- */
  try {
    if (DIR) load();
    var srv = G.server = http.createServer(handle);
    srv.on('error', function (e) { log('server error ' + (e.code || e.message)); });
    srv.on('clientError', function (e, sock) { try { sock.destroy(); } catch (x) {} });
    srv.timeout = 0;                       // uploads and paused streams may idle for minutes
    srv.listen(PORT, '0.0.0.0', function () { log('listening on ' + PORT + ' (' + (DIR || 'no storage') + ')'); });
    G.stop = function () { items.forEach(function (it) { if (it.req) { try { it.req.destroy(); } catch (e) {} } }); };
  } catch (e) { log('start failed ' + (e && e.message)); }
})();
