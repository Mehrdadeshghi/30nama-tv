#!/usr/bin/env bash
# Baut das LG-webOS-Paket (.ipk) aus tizen-app/ + webos/.
# Voraussetzung: Node 18+ und die webOS-CLI (npm i -g @webos-tools/cli), oder ARES=<pfad zu ares-package>.
# Aufruf (im Repo-Hauptordner):  bash webos/build.sh        -> dist/30nama-webos-<version>.ipk
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARES="${ARES:-ares-package}"
VER="$(node -p "require('$ROOT/package.json').version")"
OUT="$ROOT/build/webos"; rm -rf "$OUT"; mkdir -p "$OUT/app" "$ROOT/dist"

cp -r "$ROOT/tizen-app/." "$OUT/app/"
rm -rf "$OUT/app/tools" "$OUT/app/config.xml" "$OUT/app/js/tmdb-token.example.js" "$OUT/app/README.md" "$OUT/app/icon-512.png"
[[ -f "$ROOT/tizen-app/js/tmdb-token.js" ]] || echo '/* TMDB disabled */' > "$OUT/app/js/tmdb-token.js"
# Samsung-Bibliothek gibt es auf webOS nicht
sed -i.bak '/\$WEBAPIS\/webapis\/webapis.js/d' "$OUT/app/index.html" && rm -f "$OUT/app/index.html.bak"
sed -i.bak '/id="avplayObj"/d' "$OUT/app/index.html" && rm -f "$OUT/app/index.html.bak"
cp "$ROOT/webos/icon-80.png" "$ROOT/webos/icon-130.png" "$OUT/app/"
node -e "
  var fs=require('fs'), a=JSON.parse(fs.readFileSync('$ROOT/webos/appinfo.json','utf8'));
  a.version='$VER'; fs.writeFileSync('$OUT/app/appinfo.json', JSON.stringify(a, null, 2));
"
cp -r "$ROOT/webos/service" "$OUT/service"

"$ARES" --no-minify -o "$OUT/pkg" "$OUT/app" "$OUT/service"
IPK="$(ls "$OUT"/pkg/*.ipk | head -1)"
cp "$IPK" "$ROOT/dist/30nama-webos-$VER.ipk"
echo "Gebaut: dist/30nama-webos-$VER.ipk"
