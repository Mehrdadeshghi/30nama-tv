/* 30nama webOS service: does an HTTP(S) request on behalf of the app (Node on the TV, so no CORS) and returns
   status, headers and the body as text. Called from js/platform.js via luna://<appId>.service/fetch.
   Only http(s) URLs, at most 5 redirects, 20 s timeout, 8 MB body. Node 8+ compatible (old webOS). */
var http = require('http'), https = require('https'), zlib = require('zlib'), urlm = require('url');

var MAX_BODY = 8 * 1024 * 1024, TIMEOUT = 20000;

function request(target, method, headers, body, hops, cb) {
  var u;
  try { u = urlm.parse(target); } catch (e) { return cb(new Error('bad url')); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return cb(new Error('only http(s)'));
  var lib = u.protocol === 'https:' ? https : http, h = {}, k;
  for (k in headers) if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
  h['accept-encoding'] = 'gzip, deflate';
  if (body) h['content-length'] = Buffer.byteLength(body);
  var done = false;
  function finish(err, res) { if (done) return; done = true; cb(err, res); }
  var req = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, method: method, headers: h }, function (res) {
    var loc = res.headers.location;
    if (res.statusCode >= 300 && res.statusCode < 400 && loc && hops < 5) {
      res.resume();
      var next = urlm.resolve(target, loc), m = res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST') ? 'GET' : method;
      return request(next, m, headers, m === 'GET' ? '' : body, hops + 1, finish);
    }
    var stream = res, enc = String(res.headers['content-encoding'] || '').toLowerCase();
    if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
    else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
    var chunks = [], size = 0;
    stream.on('data', function (c) { size += c.length; if (size > MAX_BODY) { req.abort(); finish(new Error('body too large')); return; } chunks.push(c); });
    stream.on('end', function () {
      var out = {};
      ['content-type', 'cache-control', 'last-modified', 'etag'].forEach(function (n) { if (res.headers[n]) out[n] = String(res.headers[n]); });
      finish(null, { status: res.statusCode, statusText: res.statusMessage || '', headers: out, body: Buffer.concat(chunks).toString('utf8'), url: target });
    });
    stream.on('error', function (e) { finish(e); });
  });
  req.on('error', function (e) { finish(e); });
  req.setTimeout(TIMEOUT, function () { req.abort(); finish(new Error('timeout')); });
  if (body) req.write(body);
  req.end();
}

function handleFetch(msg) {
  var p = msg.payload || {};
  var url = String(p.url || ''), method = String(p.method || 'GET').toUpperCase(), headers = p.headers || {}, body = p.body ? String(p.body) : '';
  if (!/^https?:\/\//i.test(url)) return msg.respond({ returnValue: false, errorText: 'only http(s) urls' });
  if (['GET', 'POST', 'HEAD'].indexOf(method) < 0) return msg.respond({ returnValue: false, errorText: 'method not allowed' });
  request(url, method, headers, body, 0, function (err, res) {
    if (err) return msg.respond({ returnValue: false, errorText: String(err.message || err) });
    res.returnValue = true;
    msg.respond(res);
  });
}

module.exports = { request: request, handleFetch: handleFetch };

// On the TV `webos-service` exists and the service registers itself; in a test (plain Node) it does not.
var Service = null;
try { Service = require('webos-service'); } catch (e) {}
if (Service) new Service('com.mehrdad.nama30.service').register('fetch', handleFetch);
