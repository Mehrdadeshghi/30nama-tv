// Static checks for CI (Node 18+, needs `acorn`): every app script parses as ES5, every file index.html loads exists,
// and the app version agrees across config.js, config.xml and package.json.
// Usage: node tizen-app/tools/check.js   (from the repo root, after `npm i --no-save acorn`)
var fs = require('fs'), path = require('path'), acorn = require('acorn');
var APP = path.join(__dirname, '..'), bad = 0;
function fail(msg) { bad++; console.error('FAIL ' + msg); }

// 1. ES5 only in js/ (vendored js/lib is minified third-party code and excluded)
(function walk(dir) {
  fs.readdirSync(dir).forEach(function (f) {
    var p = path.join(dir, f), rel = path.relative(APP, p);
    if (fs.statSync(p).isDirectory()) { if (rel !== path.join('js', 'lib')) walk(p); return; }
    if (!/\.js$/.test(f)) return;
    try { acorn.parse(fs.readFileSync(p, 'utf8'), { ecmaVersion: 5, sourceType: 'script' }); }
    catch (e) { fail(rel + ':' + (e.loc ? e.loc.line + ':' + e.loc.column : '') + ' not ES5: ' + e.message); }
  });
})(path.join(APP, 'js'));

// 1b. the TizenBrew service (Node 4.4.3 on 2018 TVs) is ES5 too, and service/phone.js is built from service/src/
try { acorn.parse(fs.readFileSync(path.join(APP, 'service', 'phone.js'), 'utf8'), { ecmaVersion: 5, sourceType: 'script' }); }
catch (e) { fail('service/phone.js:' + (e.loc ? e.loc.line + ':' + e.loc.column : '') + ' not ES5: ' + e.message); }
try { require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-service.js'), '--check'], { stdio: 'pipe' }); }
catch (e) { fail(String(e.stderr || e.message).trim()); }
var pkgJ = JSON.parse(fs.readFileSync(path.join(APP, '..', 'package.json'), 'utf8'));
if (pkgJ.serviceFile !== 'tizen-app/service/phone.js') fail('package.json serviceFile must be tizen-app/service/phone.js');

// 2. every local <script src> / stylesheet in index.html exists (tmdb-token.js is optional and generated at build time)
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), re = /(?:src|href)="([^"]+)"/g, m;
while ((m = re.exec(html))) {
  var u = m[1];
  if (/^(https?:|data:|#|\$WEBAPIS)/.test(u) || u === 'js/tmdb-token.js') continue;
  if (!fs.existsSync(path.join(APP, u.split(/[?#]/)[0]))) fail('index.html references missing file ' + u);
}

// 3. config.xml declares a semver version
var ver = /<widget [^>]*version="([^"]*)"/.exec(fs.readFileSync(path.join(APP, 'config.xml'), 'utf8'));
if (!ver || !/^\d+\.\d+\.\d+$/.test(ver[1])) fail('config.xml widget version is not x.y.z');

// 4. the version shown in Settings matches config.xml and package.json (tools/set-version.js keeps them together)
var appVer = /appVersion:\s*'([^']*)'/.exec(fs.readFileSync(path.join(APP, 'js', 'config.js'), 'utf8'));
var pkgVer = JSON.parse(fs.readFileSync(path.join(APP, '..', 'package.json'), 'utf8')).version;
if (!appVer || !ver || appVer[1] !== ver[1] || pkgVer !== ver[1]) fail('version mismatch: config.js ' + (appVer && appVer[1]) + ', config.xml ' + (ver && ver[1]) + ', package.json ' + pkgVer + ' (run tools/set-version.js)');

console.log(bad ? bad + ' problem(s)' : 'all checks passed');
process.exit(bad ? 1 : 0);
