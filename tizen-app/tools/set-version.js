// Sets the app version everywhere it is shown or declared: js/config.js (appVersion, shown in Settings),
// config.xml (widget version) and the repo-root package.json (TizenBrew module). The release workflow runs it
// with the git tag's version. Usage: node tizen-app/tools/set-version.js 1.2.3   (a leading "v" is accepted)
var fs = require('fs'), path = require('path');
var ver = String(process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(ver)) { console.error('usage: set-version.js X.Y.Z'); process.exit(1); }
var APP = path.join(__dirname, '..'), ROOT = path.join(APP, '..');
function edit(file, re, to) {
  var p = path.join(file), s = fs.readFileSync(p, 'utf8');
  if (!re.test(s)) { console.error('version not found in ' + path.relative(ROOT, p)); process.exit(1); }
  fs.writeFileSync(p, s.replace(re, to));
}
edit(path.join(APP, 'js', 'config.js'), /(appVersion:\s*')[^']*(')/, '$1' + ver + '$2');
edit(path.join(APP, 'config.xml'), /(<widget [^>]*version=")[^"]*(")/, '$1' + ver + '$2');
edit(path.join(ROOT, 'package.json'), /("version":\s*")[^"]*(")/, '$1' + ver + '$2');
console.log('version ' + ver);
// the phone service carries the version too (shown on the phone page)
require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-service.js')], { stdio: 'inherit' });
