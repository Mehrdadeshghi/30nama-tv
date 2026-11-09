/* Lokale Fortsetzen-Positionen (AmbiSync-Fork).
   Die App merkt sich die Position bisher nur auf dem 30nama-Server. Schlägt das Melden fehl, hängt der Server
   hinterher oder passt die Datei-ID nicht (andere Qualität), startet ein Film wieder bei 0 bzw. "Weiter schauen"
   zeigt alte Werte. Deshalb wird die Position zusätzlich auf dem Fernseher gespeichert: pro Film bzw. pro
   Staffel/Folge, unabhängig von Qualität und Datei-ID, dazu ein kleiner Steckbrief des Titels, damit
   "Weiter schauen" auch dann stimmt, wenn der Server (noch) nichts weiß.
   Nur auf dem Gerät (localStorage), nichts wird zusätzlich verschickt. */
(function () {
  var KEY = 'resume', PKEY = 'resumePosts', MAX = 300, MAXP = 60, MIN_SEC = 30, END_SEC = 90, KEEP_MS = 60 * 864e5;
  var R = N.resume = {};
  function epNo(info) { return +info.episode_number || +info.episode || 0; }
  function k(postId, info) { info = info || {}; return String(postId) + ':' + (+info.season || 0) + ':' + epNo(info); }
  R.key = k; R.epNo = epNo;
  R.all = function () { var m = N.store.get(KEY, null); return (m && typeof m === 'object') ? m : {}; };
  function trim(m) {
    var keys = Object.keys(m);
    if (keys.length <= MAX) return;
    keys.sort(function (a, b) { return m[a].ts - m[b].ts; });
    for (var i = 0; i < keys.length - MAX; i++) delete m[keys[i]];
  }
  /* t, d in Sekunden. Unter 30 s wird nichts gemerkt, in den letzten 90 s gilt die Folge/der Film als gesehen
     (dann bleibt nur ein "gesehen"-Eintrag mit Zeitstempel, damit die Seite die nächste Folge anbieten kann). */
  R.save = function (postId, info, t, d) {
    if (!postId || !(t > 0)) return false;
    var m = R.all(), key = k(postId, info), now = Date.now();
    if (d > 0 && t > d - END_SEC) m[key] = { t: 0, d: Math.floor(d), f: String((info && info.file_id) || ''), ts: now, done: 1 };
    else if (t >= MIN_SEC) m[key] = { t: Math.floor(t), d: Math.floor(d || 0), f: String((info && info.file_id) || ''), ts: now };
    else return false;
    trim(m);
    N.store.set(KEY, m);
    return true;
  };
  R.get = function (postId, info) { var e = R.all()[k(postId, info)]; return e && !e.done && e.t >= MIN_SEC ? e : null; };
  /* zuletzt geschaute Folge/Film eines Titels: {season, episode, time, duration, ts, done} */
  R.latestFor = function (postId) {
    var m = R.all(), p = String(postId) + ':', best = null, bk = null;
    for (var key in m) if (m.hasOwnProperty(key) && key.indexOf(p) === 0 && (!best || m[key].ts > best.ts)) { best = m[key]; bk = key; }
    if (!best) return null;
    var parts = bk.split(':');
    return { season: +parts[1] || 0, episode: +parts[2] || 0, time: best.t, duration: best.d, ts: best.ts, done: !!best.done };
  };
  /* Stand einer einzelnen Folge/eines Films für Markierungen: {t, d, done, frac} oder null */
  R.forEpisode = function (postId, info) {
    var e = R.all()[k(postId, info)]; if (!e) return null;
    return { t: e.t, d: e.d, done: !!e.done, frac: e.done ? 1 : (e.d > 0 ? Math.min(0.99, e.t / e.d) : 0), ts: e.ts };
  };
  R.clear = function (postId, info) { var m = R.all(); delete m[k(postId, info)]; N.store.set(KEY, m); };
  /* alle Einträge eines Titels löschen (aus "Weiter schauen" entfernt) */
  R.clearPost = function (postId) {
    var m = R.all(), p = String(postId) + ':', ch = false;
    for (var key in m) if (m.hasOwnProperty(key) && key.indexOf(p) === 0) { delete m[key]; ch = true; }
    if (ch) N.store.set(KEY, m);
    var ps = R.posts(); if (ps[String(postId)]) { delete ps[String(postId)]; N.store.set(PKEY, ps); }
  };

  /* ---------- Steckbrief der Titel (für "Weiter schauen" ohne Server) ---------- */
  R.posts = function () { var m = N.store.get(PKEY, null); return (m && typeof m === 'object') ? m : {}; };
  R.notePost = function (post) {
    if (!post || !post.id) return;
    var keep = ['id', 'title', 'image', 'type', 'post_type', 'slug', 'year'], s = {}, i;
    for (i = 0; i < keep.length; i++) if (post[keep[i]] !== undefined) s[keep[i]] = post[keep[i]];
    if (post.options) s.options = { is_series: post.options.is_series };
    if (post.info) s.info = { title: post.info.title, year: post.info.year, time: post.info.time };
    var m = R.posts(); m[String(post.id)] = { p: s, ts: Date.now() };
    var keys = Object.keys(m);
    if (keys.length > MAXP) {
      keys.sort(function (a, b) { return m[a].ts - m[b].ts; });
      for (i = 0; i < keys.length - MAXP; i++) delete m[keys[i]];
    }
    try { N.store.set(PKEY, m); } catch (e) {}
  };

  /* "Weiter schauen" (Server-Liste) mit dem abgleichen, was auf diesem Fernseher zuletzt geschaut wurde:
     - Titel mit lokaler Position bekommen die lokale Folge/Zeit (außer der Server ist bei derselben Folge > 60 s
       weiter oder schon bei einer späteren Folge: dann wurde woanders weitergeschaut),
     - lokal angefangene Titel, die der Server (noch) nicht kennt, kommen dazu,
     - lokal zuletzt geschaute Titel stehen vorn, danach der Rest in Server-Reihenfolge. */
  function later(sa, ea, sb, eb) { return sa > sb || (sa === sb && ea > eb); }
  R.serverWins = function (srv, loc) {
    if (!srv || !loc) return !loc;
    var ss = +srv.season || 0, se = +srv.episode || 0;
    if (ss || se) {
      if (later(ss, se, loc.season, loc.episode)) return true;
      if (ss === loc.season && se === loc.episode && !loc.done && (+srv.time || 0) > loc.time + 60) return true;
      return false;
    }
    return !loc.done && (+srv.time || 0) > loc.time + 60;
  };
  /* DIE eine Entscheidung, wo es weitergeht - Startseite, "Weiter schauen", Detailseite und Player nehmen alle
     diese Funktion, damit überall dieselbe Stelle steht. srv = Stand des Servers {season, episode, time, progress}
     (oder null), loc = R.latestFor(id). Ergebnis {season, episode, time, duration, done, src} oder null. */
  R.resolve = function (postId, srv) {
    var loc = R.latestFor(postId);
    var hasSrv = !!srv && ((+srv.time || 0) > 0 || +srv.season || +srv.episode || (parseFloat(srv.progress) || 0) > 0);
    if (!loc && !hasSrv) return null;
    if (loc && (!hasSrv || !R.serverWins(srv, loc))) return { season: loc.season, episode: loc.episode, time: loc.done ? 0 : loc.time, duration: loc.duration, done: loc.done, src: 'local', ts: loc.ts };
    var pr = parseFloat(srv.progress) || 0, t = +srv.time || 0, d = pr > 0 && t > 0 ? t * 100 / pr : 0;
    return { season: +srv.season || 0, episode: +srv.episode || 0, time: pr >= 95 ? 0 : t, duration: d, done: pr >= 95, src: 'server', ts: 0 };
  };
  R.mergeCw = function (serverPosts) {
    var srv = serverPosts || [], byId = {}, out = [], used = {}, i, now = Date.now();
    srv.forEach(function (p) { if (p && p.id) byId[String(p.id)] = p; });
    var m = R.all(), lat = {};
    for (var key in m) if (m.hasOwnProperty(key)) {
      var id = key.split(':')[0];
      if (!lat[id] || m[key].ts > lat[id].ts) lat[id] = m[key];
    }
    // erst die auf diesem Fernseher zuletzt geschauten Titel (neueste zuerst), dann der Rest in Server-Reihenfolge
    var ids = Object.keys(lat).filter(function (id) { return now - lat[id].ts < KEEP_MS; });
    ids.sort(function (a, b) { return lat[b].ts - lat[a].ts; });
    srv.forEach(function (p) { if (p && p.id && ids.indexOf(String(p.id)) < 0) ids.push(String(p.id)); });
    var snaps = R.posts();
    for (i = 0; i < ids.length; i++) {
      var id2 = ids[i], sp = byId[id2], od = (sp && sp.data) || {};
      var base = sp || (snaps[id2] && snaps[id2].p);
      if (!base || used[id2]) continue;
      var r = R.resolve(id2, sp ? od : null);
      if (!r) { if (sp) { out.push(sp); used[id2] = 1; } continue; }
      var series = !!(r.season || r.episode) || !!(base.options && base.options.is_series);
      if (r.done && !series) { used[id2] = 1; continue; }   // Film zu Ende geschaut: nicht mehr in "Weiter schauen"
      var p = {}, f, dd = {};
      for (f in base) if (base.hasOwnProperty(f)) p[f] = base[f];
      for (f in od) if (od.hasOwnProperty(f)) dd[f] = od[f];
      if (series && (+od.season !== r.season || +od.episode !== r.episode)) dd.episode_title = '';
      if (series) { dd.season = r.season || 1; dd.episode = r.episode || 1; }
      if (r.done) {
        // Folge zu Ende: die Karte zeigt die nächste Folge (ohne Balken); OK spielt sie ab
        dd.episode = (r.episode || 0) + 1; dd.time = 0; dd.progress = '0'; dd.next = 1; dd.episode_title = '';
      } else {
        dd.time = r.time;
        dd.progress = r.duration > 0 ? String(Math.min(99, r.time * 100 / r.duration)) : (od.progress || '0');
        dd.next = 0;
      }
      if (r.src === 'local') p._local = 1;
      p.data = dd; out.push(p); used[id2] = 1;
    }
    return out;
  };
})();
