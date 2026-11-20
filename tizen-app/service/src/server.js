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
    c.push('/opt/usr/home/owner/share/tmp/n30phone');
    for (var i = 0; i < c.length; i++) {
      try { mkdirs(c[i]); var p = path.join(c[i], '.probe'); fs.writeFileSync(p, 'x'); fs.unlinkSync(p); return c[i]; } catch (e) {}
    }
    return null;
  }
  var DIR = pickDir(), items = [], code = '', playReq = { n: 0 }, ctlReq = { n: 0 };
  function idxFile() { return path.join(DIR, 'index.json'); }
  function save() {
    if (!DIR) return;
    var out = items.map(function (it) {
      return { id: it.id, name: it.name, type: it.type, ext: it.ext, size: it.size, recv: it.recv, done: it.done, t: it.t, fast: it.fast,
        tailStart: it.tailStart, tailRecv: it.tailRecv, tailDone: it.tailDone, tailMoov: it.tailMoov, moovOff: it.moovOff, moovSize: it.moovSize,
        metaDone: it.metaDone, rot: it.rot, vw: it.vw, vh: it.vh };
    });
    try { fs.writeFileSync(idxFile(), JSON.stringify({ code: code, items: out })); } catch (e) { log('save ' + e.message); }
  }
  function fileOf(it) { return path.join(DIR, it.id + '.' + it.ext); }
  function load() {
    var j = null;
    try { j = JSON.parse(fs.readFileSync(idxFile(), 'utf8')); } catch (e) {}
    code = j && /^\d{4}$/.test(j.code) ? j.code : String(1000 + Math.floor(Math.random() * 9000));
    items = [];
    ((j && j.items) || []).forEach(function (it) {
      try {
        var st = fs.statSync(fileOf(it));
        // head bytes as saved (the file can be longer: a tail sent first makes it sparse)
        it.recv = it.done ? it.size : Math.min(it.recv || 0, st.size); it.gen = 0;
        if (!it.tailDone) it.tailRecv = 0;
        items.push(it);
      } catch (e) {}
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
      if (type === 'moov') { it.fast = true; it.moovOff = pos; it.moovSize = sz === 1 ? buf.readUInt32BE(pos + 8) * 4294967296 + buf.readUInt32BE(pos + 12) : sz; return; }
      if (type === 'mdat') { it.fast = false; return; }
      if (sz === 1) { if (pos + 16 > len) return; sz = buf.readUInt32BE(pos + 8) * 4294967296 + buf.readUInt32BE(pos + 12); }
      if (sz < 8) { it.fast = false; return; }
      pos += sz;
    }
    if (it.recv >= 4 * 1048576 || it.done) it.fast = false; // index not found near the start: play when complete
  }
  /* The phone sends the index (moov) first when it sits at the END of the file (normal phone/Telegram MP4s): the "tail"
     goes to its place in the file, then the rest from the start. AVPlay then has the index at once and plays while the
     rest arrives, like a fast-start file. */
  function headLimit(it) { return it.tailStart !== undefined && it.tailStart !== null ? it.tailStart : it.size; }
  function checkTail(it) {
    var b = new Buffer(16), fd;
    try { fd = fs.openSync(fileOf(it), 'r'); fs.readSync(fd, b, 0, 16, it.tailStart); } catch (e) { return; } finally { try { if (fd !== undefined) fs.closeSync(fd); } catch (e) {} }
    if (b.toString('ascii', 4, 8) !== 'moov') { it.tailMoov = false; return; }
    var sz = b.readUInt32BE(0); if (sz === 1) sz = b.readUInt32BE(8) * 4294967296 + b.readUInt32BE(12);
    it.tailMoov = true; it.moovOff = it.tailStart; it.moovSize = sz;
  }
  // video size and rotation from the MP4 index: phones store portrait/rotated video as a rotation matrix in the
  // track header (tkhd), which AVPlay does not apply by itself
  function kids(buf, s, e, cb) {
    var p = s;
    while (p + 8 <= e) {
      var sz = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), h = 8;
      if (sz === 1) { if (p + 16 > e) return; sz = buf.readUInt32BE(p + 8) * 4294967296 + buf.readUInt32BE(p + 12); h = 16; }
      else if (sz === 0) sz = e - p;
      if (sz < h || p + sz > e) return;
      cb(t, p + h, p + sz); p += sz;
    }
  }
  function parseMoov(buf) {
    var out = null;
    kids(buf, 0, buf.length, function (t, s, e) {
      if (t !== 'moov') return;
      kids(buf, s, e, function (t2, s2, e2) {
        if (t2 !== 'trak' || out) return;
        kids(buf, s2, e2, function (t3, s3, e3) {
          if (t3 !== 'tkhd' || out) return;
          var base = s3 + 4 + (buf[s3] === 1 ? 32 : 20) + 16;
          if (base + 44 > e3) return;
          var a = buf.readInt32BE(base), b = buf.readInt32BE(base + 4), c = buf.readInt32BE(base + 12), d = buf.readInt32BE(base + 16);
          var w = buf.readUInt32BE(base + 36) / 65536, h = buf.readUInt32BE(base + 40) / 65536;
          if (!(w > 0 && h > 0)) return;                       // audio track
          var r = 0, O = 65536;
          if (a === 0 && b === O && c === -O && d === 0) r = 90;
          else if (a === -O && d === -O && b === 0 && c === 0) r = 180;
          else if (a === 0 && b === -O && c === O && d === 0) r = 270;
          out = { rot: r, w: Math.round(w), h: Math.round(h) };
        });
      });
    });
    return out;
  }
  function meta(it) {
    if (it.metaDone || !/^(mp4|m4v|mov|3gp)$/.test(it.ext)) return;
    if ((it.moovOff === undefined || it.moovOff === null) && it.done) {   // index at the end, no tail sent: look for it
      var fd0, hb = new Buffer(16), p = 0, n = 0;
      try {
        fd0 = fs.openSync(fileOf(it), 'r');
        while (p + 8 <= it.size && n++ < 200) {
          fs.readSync(fd0, hb, 0, 16, p);
          var sz = hb.readUInt32BE(0), t = hb.toString('ascii', 4, 8);
          if (sz === 1) sz = hb.readUInt32BE(8) * 4294967296 + hb.readUInt32BE(12); else if (sz === 0) sz = it.size - p;
          if (t === 'moov') { it.moovOff = p; it.moovSize = sz; break; }
          if (sz < 8) break;
          p += sz;
        }
      } catch (e) {} finally { try { if (fd0 !== undefined) fs.closeSync(fd0); } catch (e) {} }
    }
    if (it.moovOff === undefined || it.moovOff === null) { if (it.done) it.metaDone = true; return; }
    var have = it.done || (it.moovOff + it.moovSize <= it.recv) || (it.tailDone && it.moovOff >= it.tailStart);
    if (!have) return;
    it.metaDone = true;
    if (!(it.moovSize > 0) || it.moovSize > 32 * 1048576) return;
    var buf = new Buffer(it.moovSize), fd;
    try { fd = fs.openSync(fileOf(it), 'r'); fs.readSync(fd, buf, 0, it.moovSize, it.moovOff); } catch (e) { return; } finally { try { if (fd !== undefined) fs.closeSync(fd); } catch (e) {} }
    try { var m = parseMoov(buf); if (m) { it.rot = m.rot; it.vw = m.w; it.vh = m.h; log('video ' + m.w + 'x' + m.h + (m.rot ? ' rotated ' + m.rot : '')); } } catch (e) { log('moov ' + e.message); }
  }
  // ready to play: whole file, or the index plus a few MB from the start (fast start, or index sent first)
  function playable(it) {
    if (it.done) return true;
    if (it.fast === true && it.recv >= Math.min(it.size, 3 * 1048576)) return true;
    return !!(it.tailDone && it.tailMoov && it.recv >= Math.min(it.tailStart, 3 * 1048576));
  }
  function maybeAutoplay(it) {
    if (!it.auto || it.autoSent || !playable(it)) return;
    meta(it);
    it.autoSent = true; requestPlay(it);
  }
  function finishIfComplete(it) {
    if (it.done || !it.size || it.recv < headLimit(it)) return;
    if (it.tailStart !== undefined && it.tailStart !== null && !it.tailDone) return;
    it.done = true; it.rate = 0; checkFast(it); meta(it); maybeAutoplay(it); log('complete ' + it.name);
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
    return { id: it.id, name: it.name, size: it.size, recv: it.done ? it.size : it.recv + (it.tailRecv || 0), done: !!it.done, t: it.t, ext: it.ext,
      rate: it.req ? it.rate || 0 : 0, busy: !!it.req, fast: it.fast === true || !!it.tailMoov, ready: playable(it), err: it.err || '',
      rot: it.rot || 0, w: it.vw || 0, h: it.vh || 0 };
  }

  /* ---------- upload (resumable, raw body) ---------- */
  function upload(req, res, id, q) {
    var off = parseInt(q.off, 10) || 0, size = parseInt(q.size, 10) || 0, it = byId(id), tail = q.part === 'tail';
    if (!it) {
      if (off !== 0 && !tail) return json(res, 409, { recv: 0, err: 'gone' });
      if (!makeRoom(size, null)) return json(res, 507, { err: 'space', free: freeBytes() });
      var name = String(q.name || 'video').slice(0, 160);
      it = { id: id, name: name, type: String(q.type || ''), ext: extOf(name, q.type), size: size, recv: 0, done: false, t: Date.now(), gen: 0, auto: q.auto === '1' };
      items.push(it); save(); log('upload ' + name + ' ' + Math.round(size / 1048576) + ' MB');
    } else if (q.auto === '1') it.auto = true;
    if (it.done) return json(res, 200, { recv: it.recv, done: true, tailDone: !!it.tailDone });
    if (tail) {
      if (!(off > 0 && off < it.size)) return json(res, 400, { err: 'tail' });
      it.tailStart = off; it.tailRecv = 0; it.tailDone = false; it.tailMoov = false;
    } else if (off > it.recv) return json(res, 409, { recv: it.recv, tailDone: !!it.tailDone });
    if (it.req && it.req !== req) { try { it.req.destroy(); } catch (e) {} }   // an older, broken attempt
    var gen = it.gen = (it.gen || 0) + 1, finished = false, gotEnd = false;
    it.req = req; it.err = ''; if (!tail) it.recv = off;
    // r+ keeps what is already there (the tail when it came first); a new file needs w
    var ws = fs.createWriteStream(fileOf(it), { flags: fs.existsSync(fileOf(it)) ? 'r+' : 'w', start: off });
    function got() { return it.recv + (it.tailRecv || 0); }
    var win = { t: Date.now(), b: got() };
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
        if (tail) it.tailRecv += ch.length; else it.recv += ch.length;
        var now = Date.now();
        if (now - win.t >= 1000) { it.rate = Math.round((got() - win.b) * 1000 / (now - win.t)); win.t = now; win.b = got(); }
        if (!tail) {
          if (!it.fast && it.fast !== false) checkFast(it);
          if (!it.metaDone && it.fast && it.moovOff !== undefined && it.recv >= it.moovOff + it.moovSize) meta(it);
          maybeAutoplay(it);
        }
      }));
      if (!ok) { req.pause(); ws.once('drain', function () { req.resume(); }); }
    }));
    req.on('end', safe(function () {
      gotEnd = true;
      ws.end(safe(function () {
        if (it.gen !== gen) return end(200, { recv: it.recv, tailDone: !!it.tailDone });
        if (tail) {
          if (off + it.tailRecv >= it.size) { it.tailDone = true; checkTail(it); meta(it); log('index first: ' + Math.round(it.tailRecv / 1024) + ' KB'); maybeAutoplay(it); }
        } else if (!it.size) it.size = it.recv;
        finishIfComplete(it);
        end(200, { recv: it.recv, done: !!it.done, tailDone: !!it.tailDone });
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
    var pos = start, fd = null, closed = false, waitT = 0, lastGain = Date.now(), lastRecv = -1;
    function close() { closed = true; clearTimeout(waitT); if (fd !== null) { var f = fd; fd = null; fs.close(f, function () {}); } }
    res.on('close', close);
    var step = safe(function () {
      if (closed) return;
      if (pos > end) { close(); return res.end(); }
      if (byId(it.id) !== it) { close(); return res.destroy(); }               // deleted meanwhile
      // bytes on disk: the head from 0, and the tail once complete
      var hl = it.done ? total : it.recv, avail = pos < hl ? hl : (!it.done && it.tailDone && pos >= it.tailStart ? total : pos);
      var gotNow = it.recv + (it.tailRecv || 0);
      if (gotNow !== lastRecv) { lastRecv = gotNow; lastGain = Date.now(); }
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
    if (!DIR && !(parts[0] === 'api' && parts[1] === 'state')) return json(res, 500, { err: 'nostorage' });
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
      var o = { v: VERSION, port: PORT, storage: !!DIR, ip: ip(), items: items.slice().sort(function (a, b) { return b.t - a.t; }).map(pub), play: playReq, ctl: ctlReq, now: Date.now() };
      if (local) { o.code = code; o.dir = DIR; o.log = logs.slice(-20); if (q.free) o.free = freeBytes(); }
      return json(res, 200, o);
    }
    if (!codeOk(req, q, '')) return json(res, 403, { err: 'code' });
    var id = String(parts[2] || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40), it = id ? byId(id) : null;
    if (parts[1] === 'up' && id) {
      if (req.method === 'POST') return upload(req, res, id, q);
      return json(res, 200, it ? { recv: it.recv, size: it.size, done: !!it.done, tailStart: it.tailStart, tailDone: !!it.tailDone } : { recv: 0, gone: true });
    }
    if (req.method !== 'POST') return json(res, 405, { err: 'method' });
    if (parts[1] === 'play') { if (!it) return json(res, 404, { err: 'gone' }); requestPlay(it); return json(res, 200, { ok: true, ready: playable(it) }); }
    if (parts[1] === 'del') { if (it) { remove(it); save(); log('deleted ' + it.name); } return json(res, 200, { ok: true }); }
    if (parts[1] === 'ctl') {
      var a = String(q.a || ''); if (!/^(toggle|back|fwd|stop|rot)$/.test(a)) return json(res, 400, { err: 'a' });
      ctlReq = { n: ctlReq.n + 1, a: a, t: Date.now() }; return json(res, 200, { ok: true });
    }
    if (parts[1] === 'newcode' && local) { code = String(1000 + Math.floor(Math.random() * 9000)); save(); return json(res, 200, { code: code }); }
    json(res, 404, { err: 'route' });
  });

  /* ---------- start ---------- */
  try {
    if (DIR) load();
    var srv = G.server = http.createServer(handle);
    // the port may be taken on some TVs: fall back to the next ones (the app looks on all of them)
    var PORTS = [8030, 8031, 8032, 8034], pi = 0;
    srv.on('error', function (e) {
      log('server error ' + (e.code || e.message) + ' on ' + PORT);
      if (e.code === 'EADDRINUSE' && pi + 1 < PORTS.length) { PORT = PORTS[++pi]; setTimeout(function () { try { srv.listen(PORT, '0.0.0.0'); } catch (x) { log('listen ' + x.message); } }, 200); }
    });
    srv.on('listening', function () { log('listening on ' + PORT + ' (' + (DIR || 'no storage') + ')'); });
    srv.on('clientError', function (e, sock) { try { sock.destroy(); } catch (x) {} });
    srv.timeout = 0;                       // uploads and paused streams may idle for minutes
    srv.listen(PORT, '0.0.0.0');
    G.stop = function () { items.forEach(function (it) { if (it.req) { try { it.req.destroy(); } catch (e) {} } }); };
  } catch (e) { log('start failed ' + (e && e.message)); }
})();
