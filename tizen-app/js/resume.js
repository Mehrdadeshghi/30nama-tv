/* Lokale Fortsetzen-Positionen (AmbiSync-Fork).
   Die App merkt sich die Position bisher nur auf dem 30nama-Server. Schlägt das Melden fehl oder passt
   die Datei-ID nicht (andere Qualität), startet ein Film wieder bei 0. Hier wird die Position zusätzlich
   auf dem Fernseher gespeichert: pro Film bzw. pro Staffel/Folge, unabhängig von Qualität und Datei-ID.
   Nur auf dem Gerät (localStorage), nichts wird zusätzlich verschickt. */
(function () {
  var KEY = 'resume', MAX = 300, MIN_SEC = 30, END_SEC = 90;
  var R = N.resume = {};
  function k(postId, info) { info = info || {}; return String(postId) + ':' + (+info.season || 0) + ':' + (+info.episode || 0); }
  R.all = function () { var m = N.store.get(KEY, null); return (m && typeof m === 'object') ? m : {}; };
  /* t, d in Sekunden. Unter 30 s wird nichts gemerkt, in den letzten 90 s gilt der Film als gesehen. */
  R.save = function (postId, info, t, d) {
    if (!postId || !(t > 0)) return;
    var m = R.all(), key = k(postId, info);
    if (d > 0 && t > d - END_SEC) delete m[key];
    else if (t >= MIN_SEC) m[key] = { t: Math.floor(t), d: Math.floor(d || 0), f: String((info && info.file_id) || ''), ts: Date.now() };
    else return;
    var keys = Object.keys(m);
    if (keys.length > MAX) {
      keys.sort(function (a, b) { return m[a].ts - m[b].ts; });
      for (var i = 0; i < keys.length - MAX; i++) delete m[keys[i]];
    }
    N.store.set(KEY, m);
  };
  R.get = function (postId, info) { var e = R.all()[k(postId, info)]; return e && e.t >= MIN_SEC ? e : null; };
  /* zuletzt geschaute Folge/Film eines Titels: {season, episode, time, duration, ts} */
  R.latestFor = function (postId) {
    var m = R.all(), p = String(postId) + ':', best = null, bk = null;
    for (var key in m) if (m.hasOwnProperty(key) && key.indexOf(p) === 0 && (!best || m[key].ts > best.ts)) { best = m[key]; bk = key; }
    if (!best) return null;
    var parts = bk.split(':');
    return { season: +parts[1] || 0, episode: +parts[2] || 0, time: best.t, duration: best.d, ts: best.ts };
  };
  R.clear = function (postId, info) { var m = R.all(); delete m[k(postId, info)]; N.store.set(KEY, m); };
})();
