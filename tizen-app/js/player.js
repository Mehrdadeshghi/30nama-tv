/* Player: Tizen AVPlay when available, else <video> + hls.js. Own WebVTT overlay. */
(function () {
  var K = N.keys, $ = N.$;
  var P = N.player = {
    open: false, items: [], index: 0, post: null, be: null, paused: false,
    cues: [], subLang: 'off', subCache: {}, hbTimer: null, tickTimer: null, osdTimer: null,
    popOpen: false, panelOpen: false, ctl: -1, btns: [], tbtns: [], ctls: [], qSel: null, chSel: null, curEntry: null, seekAcc: 0, seekTimer: null, skip: null, resume: null,
    popSub: null, subPrev: null
  };
  N.addStrings({
    en: { subStyle: 'Appearance', subLook: 'Subtitle appearance', ssColor: 'Color', ssSize: 'Size', ssBg: 'Background', ssPos: 'Position', ssWeight: 'Font weight',
      cWhite: 'White', cYellow: 'Yellow', cCyan: 'Cyan', cGreen: 'Green', cMagenta: 'Magenta', xlarge: 'Extra large',
      bgShadow: 'Drop shadow', bgOutline: 'Outline', bgBox: 'Translucent box', bgSolid: 'Solid box', posLow: 'Low', posNormal: 'Normal', posHigh: 'High', wRegular: 'Regular', wBold: 'Bold' },
    fa: { subStyle: 'ظاهر', subLook: 'ظاهر زیرنویس', ssColor: 'رنگ', ssSize: 'اندازه', ssBg: 'پس‌زمینه', ssPos: 'جایگاه', ssWeight: 'ضخامت قلم',
      cWhite: 'سفید', cYellow: 'زرد', cCyan: 'فیروزه‌ای', cGreen: 'سبز', cMagenta: 'سرخابی', xlarge: 'خیلی بزرگ',
      bgShadow: 'سایه', bgOutline: 'دورخط', bgBox: 'کادر نیمه‌شفاف', bgSolid: 'کادر تیره', posLow: 'پایین', posNormal: 'معمولی', posHigh: 'بالا', wRegular: 'معمولی', wBold: 'ضخیم' }
  });

  /* ---------- subtitle appearance: one table for the player popover and Settings > Subtitle appearance ---------- */
  // store keys subColor/subSize/subBg/subPos/subWeight; first option = default except where `def` says otherwise.
  // subSize used to hold a px number (38/46/54): mapped to the nearest named size.
  var SS = N.subStyle = {
    keys: ['subColor', 'subSize', 'subBg', 'subPos', 'subWeight'],
    label: { subColor: 'ssColor', subSize: 'ssSize', subBg: 'ssBg', subPos: 'ssPos', subWeight: 'ssWeight' },
    def: { subColor: 'white', subSize: 'm', subBg: 'shadow', subPos: 'normal', subWeight: 'regular' },
    opts: {
      subColor: [{ v: 'white', c: '#FFFFFF', k: 'cWhite' }, { v: 'yellow', c: '#FFD60A', k: 'cYellow' }, { v: 'cyan', c: '#64D2FF', k: 'cCyan' }, { v: 'green', c: '#5EE07A', k: 'cGreen' }, { v: 'magenta', c: '#FF7AE0', k: 'cMagenta' }],
      subSize: [{ v: 's', px: 38, k: 'small' }, { v: 'm', px: 46, k: 'medium' }, { v: 'l', px: 54, k: 'large' }, { v: 'xl', px: 64, k: 'xlarge' }],
      subBg: [{ v: 'shadow', k: 'bgShadow' }, { v: 'outline', k: 'bgOutline' }, { v: 'box', k: 'bgBox' }, { v: 'solid', k: 'bgSolid' }],
      subPos: [{ v: 'low', px: 60, k: 'posLow' }, { v: 'normal', px: 110, k: 'posNormal' }, { v: 'high', px: 210, k: 'posHigh' }],
      subWeight: [{ v: 'regular', w: 500, k: 'wRegular' }, { v: 'bold', w: 700, k: 'wBold' }]
    },
    sample: { fa: 'زیرنویس این‌گونه دیده می‌شود.', en: 'This is how subtitles will look.' }
  };
  SS.opt = function (key, v) {
    var a = SS.opts[key], i, best = null, bd = 1e9;
    if (key === 'subSize' && typeof v === 'number') { for (i = 0; i < a.length; i++) if (Math.abs(a[i].px - v) < bd) { bd = Math.abs(a[i].px - v); best = a[i]; } return best; }
    for (i = 0; i < a.length; i++) if (a[i].v === v) return a[i];
    return SS.opt(key, SS.def[key]);
  };
  SS.get = function (key) { return SS.opt(key, N.store.get(key, SS.def[key])).v; };
  SS.values = function (over) { var o = {}; SS.keys.forEach(function (k) { o[k] = over && over[k] !== undefined ? over[k] : SS.get(k); }); return o; };
  SS.name = function (key, v) { return N.t(SS.opt(key, v).k); };
  // style a subtitle box (default #subtitle, also positioned) from the store, or from `over` ({subColor:'yellow', ...}) for a live preview.
  // Cue text lives in span.cue children (the box backgrounds wrap each line); outlines are text-shadow, never -webkit-text-stroke (Persian joins).
  SS.apply = function (over, e) {
    var o = SS.values(over), main = !e; e = e || $('subtitle'); if (!e) return o;
    e.style.color = SS.opt('subColor', o.subColor).c;
    e.style.fontSize = SS.opt('subSize', o.subSize).px + 'px';
    e.style.fontWeight = SS.opt('subWeight', o.subWeight).w;
    e.className = e.className.replace(/\bsb-\w+/g, '').replace(/\s+$/, '') + ' sb-' + o.subBg;
    if (main) e.style.bottom = SS.opt('subPos', o.subPos).px + 'px';
    return o;
  };
  var hasAV = function () { return !!(window.webapis && window.webapis.avplay); };

  /* ---------- backends ---------- */
  function avBackend() {
    var av = webapis.avplay, state = { dur: 0, cur: 0, url: null };
    var be = {
      name: 'avplay',
      load: function (url, startSec, cb) {
        state.url = url;
        $('avplayObj').style.display = 'block';
        document.body.classList.add('av'); document.documentElement.classList.add('avh');
        try { av.close(); } catch (e) {}
        try { av.open(String(url)); } catch (e) { P.onError('open ' + (e && e.message || e)); return; }
        av.setDisplayRect(0, 0, 1920, 1080);
        try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) {}
        av.setListener({
          onbufferingstart: function () { P.spin(true); },
          onbufferingcomplete: function () { P.spin(false); },
          oncurrentplaytime: function (ms) { state.cur = ms / 1000; },
          onstreamcompleted: function () { P.onEnded(); },
          onevent: function () {},
          onerror: function (err) { P.onError(String(err)); },
          onsubtitlechange: function () {}
        });
        av.prepareAsync(function () {
          try { state.dur = av.getDuration() / 1000; } catch (e) {}
          if (startSec > 5) { try { av.seekTo(Math.floor(startSec * 1000)); state.cur = startSec; } catch (e) {} }
          av.play();
          P.spin(false);
          if (cb) cb();
        }, function (err) { P.onError(String(err)); });
      },
      play: function () { try { av.play(); } catch (e) {} },
      pause: function () { try { av.pause(); } catch (e) {} },
      seek: function (sec) { try { state.cur = sec; av.seekTo(Math.max(0, Math.floor(sec * 1000))); } catch (e) {} },
      time: function () { return state.cur; },
      buffered: function () { return 0; },
      duration: function () { return state.dur; },
      audioTracks: function () {
        var out = [];
        try {
          var info = av.getTotalTrackInfo();
          for (var i = 0; i < info.length; i++) if (info[i].type === 'AUDIO') {
            var lang = ''; try { lang = JSON.parse(info[i].extra_info).language; } catch (e) {}
            out.push({ id: info[i].index, label: langName(lang) || N.tf('track', { n: out.length + 1 }) });
          }
        } catch (e) {}
        return out;
      },
      setAudio: function (id) { try { av.setSelectTrack('AUDIO', id); } catch (e) {} },
      // Samsung requires suspend/restore around the app being hidden (Home, source change, screen off)
      suspend: function () { try { av.suspend(); } catch (e) {} },
      resume: function (paused) {
        try { av.restore(); if (paused) av.pause(); }
        catch (e) { be.load(state.url, state.cur, function () { if (paused) be.pause(); }); } // player was torn down: reopen at the same spot
      },
      stop: function () {
        try { av.stop(); } catch (e) {}
        try { av.close(); } catch (e) {}
        $('avplayObj').style.display = 'none'; document.body.classList.remove('av'); document.documentElement.classList.remove('avh');
      }
    };
    return be;
  }
  function videoBackend() {
    var v = $('video'), hls = null;
    return {
      name: 'video',
      load: function (url, startSec, cb) {
        var started = false;
        var seekFix = startSec > 5;   // AmbiSync-Fork: prüfen, ob die Startzeit wirklich übernommen wurde
        v.ontimeupdate = function () {
          if (!seekFix || !(v.readyState >= 1)) return;
          seekFix = false;
          if (v.currentTime < startSec - 10) { try { v.currentTime = startSec; } catch (e) {} }
        };
        function go() {
          if (started) return; started = true;
          if (startSec > 5 && !hls && v.readyState >= 1) { try { v.currentTime = startSec; } catch (e) {} }
          var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
          P.spin(false); if (cb) cb();
        }
        v.onwaiting = function () { P.spin(true); };
        v.onplaying = function () { P.spin(false); };
        v.onended = function () { P.onEnded(); };
        v.onerror = function () { P.onError('video error'); };
        v.onloadedmetadata = go;
        var src = N.proxied(url);
        if (window.Hls && Hls.isSupported()) {
          // startPosition: hls.js lädt direkt ab der Fortsetzen-Stelle (currentTime vor dem Laden wird ignoriert)
          hls = new Hls({ enableWorker: false, abrEwmaDefaultEstimate: 5000000, startPosition: startSec > 5 ? startSec : -1 }); // open near 1080p instead of 240p
          hls.on(Hls.Events.ERROR, function (ev, d) {
            if (!d || !d.fatal) return;
            // webOS: hls.js loads over XHR and needs CORS on the CDN. If that is refused before playback starts, let
            // the TV's own HLS player take the stream directly (it needs no CORS).
            if (N.platform === 'webos' && !started && d.type === Hls.ErrorTypes.NETWORK_ERROR) {
              try { hls.destroy(); } catch (e) {} hls = null; v.src = url; return;
            }
            P.onError('hls ' + (d.response && d.response.code ? d.response.code + ' ' : '') + d.details);
          });
          hls.on(Hls.Events.MANIFEST_PARSED, function () { setTimeout(go, 0); });
          hls.loadSource(src); hls.attachMedia(v);
        } else { v.src = src; }
      },
      play: function () { v.play(); },
      pause: function () { v.pause(); },
      seek: function (s) { v.currentTime = Math.max(0, s); },
      time: function () { return v.currentTime || 0; },
      buffered: function () { try { var b = v.buffered, t = v.currentTime || 0; for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i); } catch (e) {} return 0; },
      duration: function () { return isFinite(v.duration) ? v.duration : 0; },
      audioTracks: function () {
        if (!hls && v.audioTracks && v.audioTracks.length > 1) {   // native HLS (webOS fallback)
          var nt = []; for (var j = 0; j < v.audioTracks.length; j++) nt.push({ id: j, label: langName(v.audioTracks[j].language) || v.audioTracks[j].label || N.tf('track', { n: j + 1 }) });
          return nt;
        }
        if (!hls || !hls.audioTracks) return [];
        // renditions often share a generic NAME ('audio') and no LANGUAGE: fall back to the channel count, then 'Track N'
        return hls.audioTracks.map(function (t, i) {
          var nm = t.name && !/^(audio|track)?\s*\d*$/i.test(t.name) ? t.name : '', ch = parseInt(t.channels, 10) || 0;
          return { id: i, label: langName(t.lang) || nm || (ch >= 6 ? N.t('ch6') : ch === 2 ? N.t('ch2') : '') || N.tf('track', { n: i + 1 }) };
        });
      },
      setAudio: function (id) {
        if (hls) { hls.audioTrack = id; return; }
        try { for (var j = 0; j < v.audioTracks.length; j++) v.audioTracks[j].enabled = j === id; } catch (e) {}
      },
      suspend: function () { try { v.pause(); } catch (e) {} },
      resume: function (paused) { if (!paused) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } },
      stop: function () {
        try { v.pause(); } catch (e) {}
        if (hls) { hls.destroy(); hls = null; }
        v.removeAttribute('src'); try { v.load(); } catch (e) {}
      }
    };
  }
  // audio track language names (ISO 639-1/-2 codes), in the UI language
  var LANGS = {
    en: { eng: 'English', en: 'English', per: 'Persian', fas: 'Persian', fa: 'Persian', fre: 'French', fra: 'French', ger: 'German', deu: 'German', spa: 'Spanish', es: 'Spanish', jpn: 'Japanese', ja: 'Japanese', kor: 'Korean', ko: 'Korean', tur: 'Turkish', tr: 'Turkish', ara: 'Arabic', ar: 'Arabic', rus: 'Russian', ru: 'Russian' },
    fa: { eng: 'انگلیسی', en: 'انگلیسی', per: 'فارسی', fas: 'فارسی', fa: 'فارسی', fre: 'فرانسوی', fra: 'فرانسوی', ger: 'آلمانی', deu: 'آلمانی', spa: 'اسپانیایی', es: 'اسپانیایی', jpn: 'ژاپنی', ja: 'ژاپنی', kor: 'کره‌ای', ko: 'کره‌ای', tur: 'ترکی', tr: 'ترکی', ara: 'عربی', ar: 'عربی', rus: 'روسی', ru: 'روسی' }
  };
  function langName(l) { if (!l) return ''; var s = String(l).toLowerCase(), t = LANGS[N.lang] || LANGS.en; return t[s] || t[s.slice(0, 3)] || String(l); }

  /* m3u8 may be a string, or an array of quality entries {label, default|6ch|2ch} (original app maps over it, 'Auto' = adaptive). */
  function entryUrl(e) {
    if (!e) return null;
    if (typeof e === 'string') return e;
    if (e instanceof Array) return entryUrl(e[0]);
    return entryUrl(e['default'] || e.file || e.url || e.src || e.link || e.m3u8 || e.path || e.source);
  }
  // o: {q:'max'|'auto'|label, ch:'default'|'6ch'|'2ch'} (defaults: the player's own pick, then the stored settings). Sets P.curEntry.
  P.pickUrl = function (m, o) {
    o = o || { q: P.qSel || N.store.get('quality', 'max'), ch: P.chSel || N.store.get('audioCh', 'default') };
    if (!(m instanceof Array)) { P.curEntry = m && typeof m === 'object' ? m : null; return entryUrl(m); }
    // default 'max': the highest fixed quality (e.g. 2160p); Auto only as fallback
    var best = null, bestH = -1, auto = null, pin = null, i, e, lb, h;
    for (i = 0; i < m.length; i++) {
      e = m[i]; if (!entryUrl(e)) continue; lb = String(e && e.label || '');
      if (lb && lb === o.q) pin = e;
      if (/^(auto|خودکار)$/i.test(lb)) { auto = e; continue; }
      h = parseInt(lb.replace(/\D/g, ''), 10) || 0;
      if (h > bestH) { best = e; bestH = h; }
    }
    e = o.q === 'auto' ? (auto || best) : (pin || best || auto);
    P.curEntry = e && typeof e === 'object' ? e : null;
    if (!e) return null;
    return (o.ch !== 'default' && P.curEntry && P.curEntry[o.ch]) ? P.curEntry[o.ch] : entryUrl(e);
  };
  function isAutoEntry(e) { return !!e && /^(auto|خودکار)$/i.test(String(e.label || '')); }

  /* ---------- subtitles ---------- */
  function subUrl(v) {
    if (!v) return null;
    if (typeof v === 'string') return v.replace(/^link:\/\//i, 'https://'); // some hosts hand out link://subtitle.30nama.com/...
    if (v instanceof Array) return subUrl(v[0]);
    return subUrl(v.url || v.file || v.src || v.link || v.vtt || null);
  }
  function ts(s) {
    var m = /^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/.exec(s.trim()); if (!m) return null;
    return (+m[1] || 0) * 3600 + (+m[2]) * 60 + (+m[3]) + Number('0.' + m[4]);
  }
  P.parseVTT = function (text) {
    var cues = [], blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n\n+/);
    blocks.forEach(function (b) {
      var lines = b.split('\n'), i = 0;
      while (i < lines.length && lines[i].indexOf('-->') < 0) i++;
      if (i >= lines.length) return;
      var parts = lines[i].split('-->'), s = ts(parts[0]), e = ts(parts[1].trim().split(/\s+/)[0]);
      if (s === null || e === null) return;
      var txt = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\{\\an?\d\}/g, '');
      cues.push({ s: s, e: e, t: txt });
    });
    cues.sort(function (a, b) { return a.s - b.s; });
    return cues;
  };
  // direction + font follow the subtitle language, not the UI
  function subDir(lang) { var se = $('subtitle'); se.dir = lang === 'fa' ? 'rtl' : 'ltr'; se.classList.toggle('sub-fa', lang === 'fa'); }
  function subText(txt) {
    var se = $('subtitle'); if (se._t === txt) return; se._t = txt; se.innerHTML = '';
    if (txt) se.appendChild(N.el('span', 'cue', txt));
  }
  P.setSub = function (lang) {
    P.subLang = lang; P.cues = []; subText(''); subDir(P.subPrev ? prevLang() : lang);
    if (lang === 'off') return Promise.resolve();
    var item = P.items[P.index], u = item && item.file && subUrl(item.file.subtitle && item.file.subtitle[lang]);
    if (!u) return Promise.resolve();
    if (P.subCache[u]) { P.cues = P.subCache[u]; return Promise.resolve(); }
    return N.fetch(u).then(function (r) { return r.text(); }).then(function (t) {
      P.subCache[u] = P.parseVTT(t); if (P.subLang === lang) P.cues = P.subCache[u];
    }).catch(function () { N.toast(N.t('subFailed')); });
  };
  function renderSub(t) {
    var cs = P.cues, txt = '';
    if (cs.length) {
      var lo = 0, hi = cs.length - 1, idx = -1;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (cs[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
      for (var j = idx; j >= 0 && j > idx - 4; j--) if (cs[j].e > t) { txt = cs[j].t; break; }
    }
    subText(txt || P.subPrev || ''); // style preview: a sample line while no cue is on screen
  }
  // live style preview (popover): sample in the subtitle language, else the UI language
  function prevLang() { return P.subLang !== 'off' ? P.subLang : (N.lang === 'fa' ? 'fa' : 'en'); }
  function previewOn(over) {
    var l = prevLang(); P.subPrev = SS.sample[l]; subDir(l); SS.apply(over);
    if (!P.be) subText(P.subPrev); else renderSub(P.be.time());
  }
  function previewOff() {
    if (!P.subPrev) return; P.subPrev = null; subDir(P.subLang); SS.apply();
    if (!P.be) subText(''); else renderSub(P.be.time());
  }
  P.cycleSub = function () {
    var opts = ['off'].concat(availableSubs(P.items[P.index]));
    var next = opts[(opts.indexOf(P.subLang) + 1) % opts.length];
    N.store.set('sub', next); P.setSub(next);
    N.toast(N.t('subtitles') + ': ' + (next === 'off' ? N.t('off') : next === 'en' ? N.t('english') : N.t('persian')), 1500);
  };
  function availableSubs(item) {
    var s = item && item.file && item.file.subtitle, out = [];
    if (s) ['en', 'fa'].forEach(function (l) { if (subUrl(s[l])) out.push(l); });
    return out;
  }


  /* ---------- lifecycle ---------- */
  var SCRUB_W = 1740, glyphT = null, unState = null, el = N.el;
  P.spin = function (on) { $('player-spin').classList.toggle('hidden', !on); };
  P.start = function (post, items, index, resume) {
    P.post = post; P.items = items; P.noResume = resume === false; P.resume = resume || null; P.open = true; P.qSel = null; P.chSel = null; P.ctl = -1;
    $('player').classList.remove('hidden');
    P.subPrev = null; SS.apply();
    document.body.classList.add('playing');
    N.nav.pushHandler(P.onKey);
    P.playIndex(index);
    clearInterval(P.tickTimer); P.tickTimer = setInterval(P.tick, 250);
  };
  // drop nav focus when it sits inside the player (glyph button / popover row / panel)
  function dropFocus() { if (N.nav.cur && $('player').contains(N.nav.cur)) N.nav.clear(); }
  // title block: '#osd-sub' = ep text · name, '#osd-title' = show title. ui.txt only on inner spans: dir=ltr on the
  // absolutely positioned box itself would flip its inset-inline-start to the physical left in fa
  function setOsdText(item, i) {
    var info = item.info || {}, s = $('osd-sub'), nm = N.ui.epName(item), ot = $('osd-title');
    ot.innerHTML = ''; ot.appendChild(N.ui.txt(el('span'), N.title(P.post)));
    s.innerHTML = '';
    if (P.items.length > 1 || info.season) s.appendChild(el('span', '', N.fmt.ep(info.season || 1, info.episode || (i + 1))));
    if (nm) { if (s.lastChild) s.appendChild(el('i', 'dot-s')); s.appendChild(N.ui.txt(el('span'), nm)); }
  }
  P.playIndex = function (i) {
    var item = P.items[i]; if (!item) return;
    P.reportNow();
    if (P.be) P.be.stop();
    closePop(true); closePanel(true); P.ctl = -1; dropFocus();
    P.index = i; P.paused = false; P.cues = []; P.subLang = N.store.get('sub', 'off'); P.audioSel = null;
    var pl = $('player'); pl.classList.remove('paused');
    subText(''); P.hideSkip(); P.hideUpNext(true);
    var m3u8 = item.file && P.pickUrl(item.file.m3u8);
    if (typeof m3u8 === 'string') m3u8 = m3u8.replace(/^\s+|\s+$/g, '');
    if (!m3u8 || typeof m3u8 !== 'string') { try { console.warn('no playable m3u8', item.file && item.file.m3u8); } catch (e) {} N.toast(N.t('noStream'), 4000); return P.close(); }
    setOsdText(item, i); buildBtns(item);
    var start = 0, info = item.info || {};
    if (P.resume && String(P.resume.file_id) === String(info.file_id)) start = Number(P.resume.time) || 0;
    // AmbiSync-Fork: lokal gemerkte Position (pro Film/Folge, unabhängig von Qualität und Datei-ID).
    // Sie gewinnt, außer der Server ist mehr als 60 s weiter (dann wurde woanders weitergeschaut).
    if (!P.noResume && !P.reloading) {
      var loc = N.resume && N.resume.get(P.post && P.post.id, info);
      if (loc && !(start > loc.t + 60)) start = loc.t;
    }
    P.noResume = false; P.reloading = false;
    P.resume = null;
    var cv = N.ui.coverUrl(P.post) || N.ui.posterUrl(P.post), pp = $('player-poster');
    if (!cv) pp.removeAttribute('src'); else if (pp.getAttribute('src') !== cv) pp.src = cv;
    pl.classList.add('loading');
    P.be = hasAV() ? avBackend() : videoBackend();
    P.spin(true); P.glyph(false);
    clearTimeout(P.loadT);
    var be0 = P.be;
    P.loadT = setTimeout(function () { if (P.be === be0 && P.loading) P.onError('timeout'); }, 25000);
    P.loading = true;
    try { P.be.load(m3u8, start, function () {
      P.loading = false; clearTimeout(P.loadT); pl.classList.remove('loading');
      var subs = availableSubs(item);
      var want = P.subLang; if (want !== 'off' && subs.indexOf(want) < 0) want = 'off';
      P.setSub(want); P.showOsd();
    }); } catch (e) { P.onError(String(e && e.message || e)); }
    clearInterval(P.hbTimer); P.hbTimer = setInterval(P.report, N.config.heartbeatMs);
    P.seekAcc = 0; clearTimeout(P.seekTimer); $('scrub').classList.remove('seeking', 'nudge'); pl.classList.remove('seeking');
    P.tick();
  };
  P.close = function () {
    if (!P.open) return;
    P.reportNow();
    clearInterval(P.hbTimer); clearInterval(P.tickTimer); clearTimeout(P.osdTimer); clearTimeout(P.seekTimer); clearTimeout(P.loadT);
    if (P.be) P.be.stop();
    P.be = null; P.loading = false;
    closePop(true); closePanel(true); P.hideUpNext(true); P.hideSkip();
    P.ctl = -1; dropFocus();
    P.open = false; $('player').classList.add('hidden'); document.body.classList.remove('playing');
    $('player').classList.remove('osd-on', 'paused', 'panel', 'loading', 'seeking'); $('scrub').classList.remove('seeking', 'nudge'); P.seekAcc = 0; $('osd').classList.add('off');
    P.subPrev = null; subText('');
    N.nav.popHandler(P.onKey);
    if (N.onPlayerClosed) N.onPlayerClosed();
  };
  document.addEventListener('visibilitychange', function () {
    if (!P.open || !P.be) return;
    if (document.hidden) { P.reportNow(); P.be.suspend(); }
    else { P.be.resume(P.paused); P.showOsd(); }
  });
  // raw backend detail -> a localized message (the detail itself never reaches the screen)
  function errKey(m) {
    m = String(m || '');
    if (/403|406/.test(m)) return 'err403';
    if (/404|manifestLoadError/i.test(m)) return 'err404';
    if (/503/.test(m)) return 'err503';
    if (/timeout|network/i.test(m)) return 'errNet';
    return 'playErr';
  }
  P.onError = function (m) { try { console.warn('player error', m); } catch (e) {} P.loading = false; clearTimeout(P.loadT); $('player').classList.remove('loading'); N.toast(N.t(errKey(m)), 6000); P.spin(false); P.showOsd(); };
  P.onEnded = function () { if (P.index + 1 < P.items.length) P.playIndex(P.index + 1); else P.close(); };

  /* ---------- progress reporting (observer) ---------- */
  P.report = function () {
    if (!P.be) return;
    var item0 = P.items[P.index], info0 = (item0 && item0.info) || {};
    try { if (N.resume && !P.loading) N.resume.save(P.post && P.post.id, info0, P.be.time(), P.be.duration()); } catch (e) {}
    if (!N.isLoggedIn()) return;
    var item = P.items[P.index], info = item.info || {}, u = N.session.user || {};
    N.api.call('observer', {
      post_id: info.post_id || (P.post && P.post.id), file_id: info.file_id,
      user_id: u.user_id || u.id || '', time: Math.floor(P.be.time()), duration: Math.floor(P.be.duration()),
      token: (item.options && item.options.token) || ''
    }).catch(function () {});
  };
  P.reportNow = function () { if (P.be && P.be.time() > 1) P.report(); };

  /* ---------- scrubber / OSD ---------- */
  function setT(id, txt) { var e = $(id); if (e._t !== txt) { e._t = txt; e.textContent = txt; } }
  function drawScrub(t, d, buf) {
    var f = d ? Math.max(0, Math.min(1, t / d)) : 0, b = d ? Math.max(0, Math.min(1, buf / d)) : 0, sc = $('scrub');
    sc.querySelector('.fill').style.transform = 'scaleX(' + f.toFixed(4) + ')';
    sc.querySelector('.buf').style.transform = 'scaleX(' + b.toFixed(4) + ')';
    var x = f * SCRUB_W; sc.querySelector('.thumb').style.transform = 'translateX(' + x.toFixed(1) + 'px)';
    return x;
  }
  // seek delta in the bubble: the signed number is an LTR span ('+10'), the unit follows the UI language ('+10s' / '+10 ثانیه')
  function setDelta(n) {
    var e = $('bub-d'), key = N.lang + n; if (e._t === key) return; e._t = key;
    var parts = N.tf('secs', { n: '\u0001' }).split('\u0001'), sp = el('span', '', (n > 0 ? '+' : '-') + Math.abs(n));
    sp.dir = 'ltr'; e.innerHTML = ''; e.dir = N.isRtl() ? 'rtl' : 'ltr';
    if (parts[0]) e.appendChild(document.createTextNode(parts[0]));
    e.appendChild(sp);
    if (parts[1]) e.appendChild(document.createTextNode(parts[1]));
  }
  function clockNow() { var d = new Date(), h = d.getHours(), m = d.getMinutes(); return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
  function tn(v) { if (typeof v === 'string' && v.indexOf(':') > 0) { var p = v.split(':'), r = 0; for (var i = 0; i < p.length; i++) r = r * 60 + (parseFloat(p[i]) || 0); return r; } return Number(v); }
  P.tick = function () {
    if (!P.be) return;
    var t = P.be.time(), d = P.be.duration(), tt = t;
    renderSub(t);
    if (P.seekAcc && d) tt = Math.max(0, Math.min(d, t + P.seekAcc));
    var x = drawScrub(tt, d, P.be.buffered());
    setT('osd-t1', N.fmtTime(tt)); setT('osd-t2', d ? '-' + N.fmtTime(Math.max(0, d - tt)) : '');
    setT('osd-clock', clockNow());
    if (P.seekAcc) {
      setT('bub-t', N.fmtTime(tt)); setDelta(P.seekAcc);
      // CSS centres the inner capsule on x; clamp so it never leaves the screen at the ends
      var bb = $('scrub').querySelector('.bubble'), hw = bb.firstElementChild.offsetWidth / 2;
      bb.style.transform = 'translateX(' + Math.max(hw - 50, Math.min(SCRUB_W - hw + 50, x)).toFixed(1) + 'px)';
    }
    var o = (P.items[P.index] || {}).options || {}, show = null;
    var isS = tn(o.intro_end) > 0 && t >= tn(o.intro_start) && t < tn(o.intro_end) - 1;
    var isP = !isS && tn(o.previously_end) > 0 && t >= tn(o.previously_start) && t < tn(o.previously_end) - 1;
    if (isS) show = { label: N.t('skipIntro'), to: tn(o.intro_end) };
    else if (isP) show = { label: N.t('skipRecap'), to: tn(o.previously_end) };
    P.skip = show;
    if (show) P.showSkip(show.label); else P.hideSkip();
    // up next at credits
    var hasNext = P.index + 1 < P.items.length;
    if (hasNext && tn(o.end) > 0 && t >= tn(o.end) && !unState) P.showUpNext();
    else if (unState && tn(o.end) > 0 && t < tn(o.end) - 3 && !unState.dismissed) P.hideUpNext(true);
  };
  // Skip intro/recap owns OK: appearing pulls focus off the controls row (Up from the row returns to it); dimmed while a control has focus
  P.showSkip = function (label) {
    var b = $('skip-btn'); if (b._l !== label) { b._l = label; b.textContent = label; }
    if (!b.classList.contains('show')) { b.classList.add('show'); if (P.ctl >= 0) unfocusCtl(); }
    syncSkip();
  };
  P.hideSkip = function () { $('skip-btn').classList.remove('show'); P.skip = null; };
  function syncSkip() { $('skip-btn').classList.toggle('idle', P.ctl >= 0); }
  function doSkip() { if (!P.skip || !P.be) return; var to = P.skip.to; P.hideSkip(); P.be.seek(to); P.showOsd(); }
  $('skip-btn').onclick = doSkip;
  // auto-hide after 5 s while playing, also with a control focused (focus is dropped with it); paused / popover / panel keep it up
  P.showOsd = function () {
    $('osd').classList.remove('off'); $('player').classList.add('osd-on'); clearTimeout(P.osdTimer);
    P.osdTimer = setTimeout(function () { if (!(P.paused || P.popOpen || P.panelOpen)) P.hideOsd(); }, 5000);
  };
  P.hideOsd = function () {
    clearTimeout(P.osdTimer);
    if (P.ctl >= 0) { P.ctl = -1; N.nav.clear(); syncSkip(); }
    $('osd').classList.add('off'); $('player').classList.remove('osd-on');
  };
  function osdVisible() { return !$('osd').classList.contains('off'); }
  // Skip / Up next on screen: it sits above the controls row and holds OK while no control is focused
  function cardUp() { return !!P.skip || !!(unState && $('upnext').classList.contains('show')); }
  P.glyph = function (kind) { // kind: 'play' | 'pause' | false
    var g = $('pglyph'); clearTimeout(glyphT);
    g.classList.remove('pulse');
    if (!kind) return;
    N.ui.setIcon(g.firstChild, kind);
    void g.offsetWidth;
    g.classList.add('pulse');
  };
  // quiet: from the transport row (its play/pause glyph is the feedback, no centre pulse)
  P.togglePause = function (quiet) {
    if (!P.be) return;
    P.paused = !P.paused;
    if (P.paused) P.be.pause(); else P.be.play();
    $('player').classList.toggle('paused', P.paused);
    syncPP();
    if (!quiet) P.glyph(P.paused ? 'pause' : 'play');
    P.showOsd();
  };
  // quiet: from the transport row: thumb + time only (the seek bubble would sit on the row, which stays visible)
  P.seekBy = function (sec, quiet) {
    if (!P.be) return;
    P.seekAcc += sec; clearTimeout(P.seekTimer);
    if (quiet) $('scrub').classList.add('nudge'); else { $('scrub').classList.add('seeking'); $('player').classList.add('seeking'); }
    P.showOsd(); P.tick();
    P.seekTimer = setTimeout(function () {
      var d = P.be.duration(), t = P.be.time() + P.seekAcc; P.seekAcc = 0;
      $('scrub').classList.remove('seeking', 'nudge'); $('player').classList.remove('seeking');
      if (d) t = Math.min(t, d - 2);
      P.be.seek(Math.max(0, t));
    }, 700);
  };

  /* ---------- up next ---------- */
  P.showUpNext = function () {
    var next = P.items[P.index + 1]; if (!next) return;
    var u = $('upnext'), auto = N.store.get('autoplay', true);
    var info = next.info || {}, u2 = u.querySelector('.u2'), nm = N.ui.epName(next);
    u.querySelector('.u1').textContent = N.t('nextEpisode');
    u2.innerHTML = ''; u2.appendChild(el('span', '', N.fmt.ep(info.season || 1, info.episode || (P.index + 2))));
    if (nm) { u2.appendChild(el('i', 'dot-s')); u2.appendChild(N.ui.txt(el('span'), nm)); }
    var cv = N.ui.coverUrl(P.post) || N.ui.posterUrl(P.post);
    u.querySelector('.th').style.backgroundImage = cv ? 'url("' + cv + '")' : '';
    $('un-play').textContent = N.t('playNow'); $('un-cred').textContent = N.t('credits');
    unState = { sel: 'play', dismissed: false, auto: auto };
    uSel(); if (P.ctl >= 0) unfocusCtl(); // like Skip: the card takes OK
    u.classList.remove('hold', 'count'); u.classList.add('show');
    if (auto) { void u.offsetWidth; u.classList.add('count'); }
    u.querySelector('.cd').style.display = auto ? '' : 'none';
    u.querySelector('.cd').onanimationend = function () { if (unState && unState.auto) { P.hideUpNext(true); P.playIndex(P.index + 1); } };
  };
  function uSel() {
    $('un-play').classList.toggle('focus', !unState || unState.sel === 'play');
    $('un-cred').classList.toggle('focus', !!unState && unState.sel === 'cred');
  }
  P.hideUpNext = function (force) {
    var u = $('upnext');
    u.classList.remove('show', 'count', 'hold');
    if (force) unState = null; else if (unState) unState.dismissed = true;
  };

  /* ---------- controls row: transport (centred, physical LTR in both languages: media controls are not mirrored)
     + glyph buttons at the inline-end (inline order: subtitles, audio, quality). P.ctls = transport then glyphs; P.ctl indexes it. ---------- */
  function hasNext() { return P.index + 1 < P.items.length; }
  function buildBtns(item) {
    var box = $('osd-btns'), tp = $('osd-tp'), m = item.file && item.file.m3u8, kinds = ['sub', 'audio'];
    if (m instanceof Array && m.length > 1) kinds.push('q');
    box.innerHTML = ''; P.btns = [];
    kinds.forEach(function (k) {
      var fn = function () { focusKind(k); openPop(k); }, b;
      if (k === 'q') { b = el('button', 'btn circle f fl'); b.appendChild(el('span', 'q latin', 'HD')); b.onclick = fn; }
      else b = N.ui.circle(k, fn);
      b._kind = k; box.appendChild(b); P.btns.push(b);
    });
    tp.innerHTML = ''; P.tbtns = [];
    function add(k, icon, fn) { var b = N.ui.circle(icon, fn, 'tp'); b._kind = k; b._tp = true; tp.appendChild(b); P.tbtns.push(b); return b; }
    add('rw', 'back30', function () { P.seekBy(-30, true); });
    add('pp', 'pause', function () { P.togglePause(true); });
    add('ff', 'fwd30', function () { P.seekBy(30, true); });
    if (hasNext()) add('next', 'nextep', function () { P.next(); });
    P.ctls = P.tbtns.concat(P.btns); syncPP();
  }
  function syncPP() { var b = P.tbtns[1]; if (b && b._pp !== P.paused) { b._pp = P.paused; N.ui.setIcon(b.firstChild, P.paused ? 'play' : 'pause'); } }
  function focusCtl(n) { if (!P.ctls[n]) return; P.ctl = n; N.nav.focus(P.ctls[n], true); P.showOsd(); syncSkip(); }
  function focusKind(k) { for (var i = 0; i < P.ctls.length; i++) if (P.ctls[i]._kind === k) return focusCtl(i); focusCtl(1); }
  function unfocusCtl() { P.ctl = -1; N.nav.clear(); P.showOsd(); syncSkip(); }
  // Left/Right follow the on-screen order (transport is LTR, the glyph buttons follow the UI direction)
  function ctlMove(dir) {
    var a = P.ctls.slice().sort(function (x, y) { return x.getBoundingClientRect().left - y.getBoundingClientRect().left; });
    var n = a[a.indexOf(P.ctls[P.ctl]) + (dir === 'right' ? 1 : -1)];
    if (n) focusCtl(P.ctls.indexOf(n));
  }
  // next episode (also across a season boundary: items are sorted season, episode); progress for the current one is reported in playIndex
  P.next = function () {
    if (!hasNext()) return;
    var c = P.ctls[P.ctl], k = c && c._kind;
    P.hideUpNext(true); P.playIndex(P.index + 1);
    if (k && P.open) focusKind(k === 'next' && !hasNext() ? 'pp' : k);
  };

  /* ---------- popover: compact check-list above its button ---------- */
  // rows: Left/Right swallowed; Up/Down skip section headers and stop at the ends
  function rowNav(dir, cur) {
    if (dir === 'left' || dir === 'right') return true;
    var s = cur;
    do { s = dir === 'up' ? s.previousElementSibling : s.nextElementSibling; } while (s && !s.classList.contains('chk'));
    return s || true;
  }
  // nav.ensureVisible hook: scroll the list so the focused row (and its section header) stays inside the popover
  function popReveal(r) {
    var pop = $('pop'), a = r.offsetTop, b = a + r.offsetHeight, pv = r.previousElementSibling, pad = 12;
    if (pv && !pv.classList.contains('chk')) a = pv.offsetTop;
    if (a - pad < pop.scrollTop) pop.scrollTop = Math.max(0, a - pad);
    else if (b + pad > pop.scrollTop + pop.clientHeight) pop.scrollTop = b + pad - pop.clientHeight;
  }
  function openPop(kind) {
    var pop = $('pop'), item = P.items[P.index], bi = -1, i;
    for (i = 0; i < P.btns.length; i++) if (P.btns[i]._kind === kind) bi = i;
    if (bi < 0 || !P.be || !item) return;
    closePop(true);
    pop.innerHTML = ''; pop.scrollTop = 0;
    function head(t) { pop.appendChild(el('div', 'ph', t)); }
    function row(label, sel, fn) {
      var r = el('div', 'chk f fl' + (sel ? ' sel' : ''));
      r.appendChild(N.ui.icon('check')); r.appendChild(N.ui.txt(el('span'), label));
      r.onclick = function () { closePop(); fn(); };
      r.onnav = rowNav; pop.appendChild(r);
    }
    if (kind === 'sub') subList(null);
    else if (kind === 'audio') {
      var ce = P.curEntry || {}, ch = P.chSel || N.store.get('audioCh', 'default'), tracks = P.be.audioTracks();
      if (ch !== 'default' && !ce[ch]) ch = 'default';
      head(N.t('audio'));
      [['default', 'chAuto'], ['6ch', 'ch6'], ['2ch', 'ch2']].forEach(function (c) {
        if (c[0] !== 'default' && !ce[c[0]]) return;
        row(N.t(c[1]), ch === c[0], function () { if (c[0] === ch) return; P.chSel = c[0]; N.store.set('audioCh', c[0]); reloadAt(); });
      });
      if (tracks.length > 1) {
        head(N.t('audioLang'));
        tracks.forEach(function (t, j) {
          row(t.label, P.audioSel === null || P.audioSel === undefined ? j === 0 : P.audioSel === t.id, function () { P.audioSel = t.id; P.be.setAudio(t.id); });
        });
      }
    } else {
      var m = (item.file && item.file.m3u8) || [], curAuto = isAutoEntry(P.curEntry);
      head(N.t('quality'));
      row(N.t('qAuto'), curAuto, function () { if (!curAuto) { P.qSel = 'auto'; reloadAt(); } });
      m.forEach(function (e) {
        if (!e || !e.label || isAutoEntry(e) || !entryUrl(e)) return;
        var lb = String(e.label), on = P.curEntry === e;
        row(lb, on, function () { if (!on) { P.qSel = lb; reloadAt(); } });
      });
    }
    // inline-end aligned with the button's inline-end: quality 90, audio 182, subtitles 274
    pop.style.left = ''; pop.style.right = '';
    pop.style[N.isRtl() ? 'left' : 'right'] = (90 + 92 * (P.btns.length - 1 - bi)) + 'px';
    pop.classList.add('open'); N.nav.pushScope(pop); P.popOpen = true; pop.reveal = popReveal;
    var r0 = pop.querySelector('.chk.sel') || pop.querySelector('.chk');
    N.nav.focus(r0, true); if (r0) popReveal(r0);
    P.showOsd();
  }
  // subtitles popover: languages, then an Appearance section whose rows drill down into a style list (focus previews live on
  // the current cue or a sample line, OK commits and returns, Back returns without committing). Returns the row for focusKey.
  function subList(focusKey) {
    var pop = $('pop'), subs = availableSubs(P.items[P.index]), r0 = null;
    P.popSub = null; pop.innerHTML = ''; pop.scrollTop = 0;
    pop.appendChild(el('div', 'ph', N.t('subtitles')));
    function lang(l, label) {
      var r = el('div', 'chk f fl' + (P.subLang === l ? ' sel' : ''));
      r.appendChild(N.ui.icon('check')); r.appendChild(N.ui.txt(el('span'), label));
      r.onclick = function () { closePop(); N.store.set('sub', l); P.setSub(l); };
      r.onfocus2 = previewOff; r.onnav = rowNav; pop.appendChild(r);
    }
    lang('off', N.t('subOff'));
    if (subs.indexOf('fa') >= 0) lang('fa', N.t('persian'));
    if (subs.indexOf('en') >= 0) lang('en', N.t('english'));
    pop.appendChild(el('div', 'ph', N.t('subStyle')));
    SS.keys.forEach(function (k) {
      var r = el('div', 'chk opt f fl'), v = el('span', 'v'), o = SS.opt(k, SS.get(k));
      r.appendChild(N.ui.txt(el('span'), N.t(SS.label[k])));
      if (o.c) v.appendChild(swatch(o.c));
      v.appendChild(el('b', '', N.t(o.k))); r.appendChild(v); r.appendChild(N.ui.icon('chev', 'mirror chev'));
      r.onclick = function () { styleList(k); };
      r.onfocus2 = function () { previewOn(); };
      r.onnav = rowNav; pop.appendChild(r); if (k === focusKey) r0 = r;
    });
    return r0;
  }
  function swatch(c) { var w = el('i', 'sw'); w.style.background = c; return w; }
  function styleList(key) {
    var pop = $('pop'), cur = SS.get(key), r0 = null, h = el('div', 'ph');
    P.popSub = key; pop.innerHTML = ''; pop.scrollTop = 0;
    h.appendChild(N.ui.icon('chev', 'bk')); h.appendChild(el('span', '', N.t(SS.label[key]))); pop.appendChild(h);
    SS.opts[key].forEach(function (o) {
      var r = el('div', 'chk f fl' + (o.v === cur ? ' sel' : ''));
      r.appendChild(N.ui.icon('check')); r.appendChild(N.ui.txt(el('span'), N.t(o.k)));
      if (o.c) r.appendChild(swatch(o.c));
      r.onfocus2 = function () { var ov = {}; ov[key] = o.v; previewOn(ov); };
      r.onclick = function () { N.store.set(key, o.v); popBack(); };
      r.onnav = rowNav; pop.appendChild(r); if (o.v === cur) r0 = r;
    });
    r0 = r0 || pop.querySelector('.chk'); N.nav.focus(r0, true); popReveal(r0); P.showOsd();
  }
  function popBack() { var r = subList(P.popSub); SS.apply(); N.nav.focus(r, true); popReveal(r); P.showOsd(); }
  function closePop(silent) {
    if (!P.popOpen) return;
    previewOff(); P.popSub = null;
    $('pop').classList.remove('open'); N.nav.popScope(); P.popOpen = false;
    if (silent) return;
    if (P.ctls[P.ctl]) N.nav.focus(P.ctls[P.ctl], true); else N.nav.clear();
    P.showOsd();
  }
  // quality / channel change: reopen the same episode at the current position, keeping the button focused
  function reloadAt() {
    if (!P.be) return;
    var c = P.ctls[P.ctl], k = c && c._kind;
    P.resume = { file_id: (P.items[P.index].info || {}).file_id, time: P.be.time() };
    P.reloading = true;
    P.playIndex(P.index);
    if (k && P.open) focusKind(k);
  }

  /* ---------- bottom panel: Episodes (series) / Info ---------- */
  function ppBody() { return $('player-panel').querySelector('.pp-body'); }
  function tabEl(k) { for (var i = 0; i < P.tabs.length; i++) if (P.tabs[i]._key === k) return P.tabs[i]; return P.tabs[0]; }
  function mkTab(key, label) {
    var t = N.ui.pill(label, null, false); t._key = key;
    t.onfocus2 = function () { showTab(key); };
    t.onnav = function (dir) {
      if (dir === 'up') { closePanel(); return true; }
      if (dir === 'left' || dir === 'right') return P.tabs[P.tabs.indexOf(t) + N.ui.step(dir)] || true;
      // Down: finish a pending switch first so the tile we return is in the DOM
      if (P.tabT) { clearTimeout(P.tabT); P.tabT = null; buildBody(P.curTab); ppBody().classList.remove('sw'); }
      return P.curTab === 'eps' ? (P.curTile || P.epTiles[0] || true) : true;
    };
    return t;
  }
  function showTab(key, now) {
    var body = ppBody();
    P.tabs.forEach(function (t) { t.classList.toggle('cur', t._key === key); });
    if (key === P.curTab) return;
    P.curTab = key; clearTimeout(P.tabT); P.tabT = null;
    if (now) { buildBody(key); body.classList.remove('sw'); return; }
    body.classList.add('sw');
    P.tabT = setTimeout(function () { P.tabT = null; buildBody(key); body.classList.remove('sw'); }, 120);
  }
  function buildBody(key) {
    var body = ppBody(), ui = N.ui;
    body.innerHTML = ''; P.epTiles = []; P.curTile = null;
    if (key === 'eps') {
      var tr = el('div', 'pp-track'), cur = P.items[P.index], season = String((cur.info && cur.info.season) || 1), tiles = P.epTiles;
      var frac = P.be && P.be.duration() ? P.be.time() / P.be.duration() : 0;
      P.items.forEach(function (it, i) {
        if (String((it.info && it.info.season) || 1) !== season) return;
        var t = ui.epCard(it, i, P.post, { progress: i === P.index ? frac : 0 });
        t.onclick = function () { closePanel(); P.playIndex(i); };
        t.onfocus2 = function () { ui.slideTo(tr, ui.keepX(tr, t, 404, 1)); };
        t.onnav = function (dir) {
          if (dir === 'up') return tabEl(P.curTab);
          if (dir === 'down') return true;
          var nt = tiles[tiles.indexOf(t) + ui.step(dir)]; if (!nt) ui.bump(t, dir);
          return nt || true;
        };
        tr.appendChild(t); tiles.push(t); if (i === P.index) P.curTile = t;
      });
      body.appendChild(tr);
      ui.layoutTrack(tr, tiles, tiles.map(function () { return 404; }), 40, 50, 1790);
      if (P.curTile) ui.slideTo(tr, ui.keepX(tr, P.curTile, 404, 1));
      tiles.forEach(function (t) { ui.load(t); });
    } else {
      var po = el('img', 'pi-po'), src = ui.posterUrl(P.post), tx = el('div', 'pi-tx');
      po.alt = ''; if (src) po.src = src;
      tx.appendChild(ui.txt(el('div', 'pi-t'), N.title(P.post)));
      tx.appendChild(ui.meta(P.post, { genres: 3 }));
      tx.appendChild(ui.txt(el('div', 'pi-pl'), N.plot(P.post)));
      body.appendChild(po); body.appendChild(tx);
    }
  }
  function openPanel(tab) {
    if (P.panelOpen) return;
    var pn = $('player-panel'), tb = pn.querySelector('.pp-tabs');
    if (tab === 'eps' && P.items.length < 2) tab = 'info';
    tb.innerHTML = ''; P.tabs = []; P.curTab = null; clearTimeout(P.tabT); P.tabT = null;
    if (P.items.length > 1) P.tabs.push(mkTab('eps', N.t('episodes')));
    P.tabs.push(mkTab('info', N.t('info')));
    P.tabs.forEach(function (t) { tb.appendChild(t); });
    showTab(tab, true); // synchronous: the body exists before any key can reach it
    $('player').classList.add('panel'); pn.classList.add('open'); N.nav.pushScope(pn);
    P.panelOpen = true; clearTimeout(P.osdTimer);
    N.nav.focus(tabEl(tab), true);
  }
  function closePanel(silent) {
    if (!P.panelOpen) return;
    clearTimeout(P.tabT); P.tabT = null;
    $('player').classList.remove('panel'); $('player-panel').classList.remove('open');
    N.nav.popScope(); N.nav.clear(); P.panelOpen = false;
    if (!silent) P.showOsd();
  }

  /* ---------- keys ---------- */
  // transport keys that work everywhere in the player (also over the popover / panel, where nav.js would drop them)
  function mediaKey(k) {
    if (k === K.PLAYPAUSE) P.togglePause();
    else if (k === K.PLAY) { if (P.paused) P.togglePause(); }
    else if (k === K.PAUSE) { if (!P.paused) P.togglePause(); }
    else if (k === K.STOP) P.close();
    else return false;
    return true;
  }
  P.onKey = function (e) {
    if (!P.open) return false;
    var k = e.keyCode, back = k === K.BACK || k === K.ESC || k === K.BACKSPACE, vis = osdVisible();
    if (P.popOpen) { if (back) { if (P.popSub) popBack(); else closePop(); return true; } return mediaKey(k); } // spatial nav runs inside the popover scope
    if (P.panelOpen) { if (back) { closePanel(); return true; } return mediaKey(k); }
    if (P.ctl >= 0) { // controls row focused; other keys (media, FF/RW) fall through
      P.showOsd();
      if (k === K.LEFT || k === K.RIGHT) { ctlMove(k === K.LEFT ? 'left' : 'right'); return true; }
      if (k === K.ENTER) { var c = P.ctls[P.ctl]; if (c._tp) c.onclick(); else openPop(c._kind); return true; }
      // Up: to Skip / Up next above the row, else past the top hides the chrome; Back hides it too
      if (k === K.UP) { if (cardUp()) unfocusCtl(); else P.hideOsd(); return true; }
      if (back) { P.hideOsd(); return true; }
      if (k === K.DOWN) { P.ctl = -1; syncSkip(); openPanel(P.items.length > 1 ? 'eps' : 'info'); return true; }
    }
    if (back && vis && !P.loading) { P.hideOsd(); return true; } // YouTube-style: Back hides the chrome first, a second Back exits
    if (back || k === K.STOP) { P.close(); return true; }
    P.showOsd();
    if (unState && $('upnext').classList.contains('show')) {
      if (k === K.ENTER) {
        var sel = unState.sel; P.hideUpNext(sel !== 'cred');
        if (sel === 'play') P.playIndex(P.index + 1);
        return true;
      }
      if (k !== K.PLAYPAUSE) $('upnext').classList.add('hold');
      if (k === K.LEFT || k === K.RIGHT) { unState.sel = unState.sel === 'play' ? 'cred' : 'play'; uSel(); return true; }
    }
    if (k === K.PLAYPAUSE) { P.togglePause(); return true; }
    if (k === K.PLAY) { if (P.paused) P.togglePause(); return true; }
    if (k === K.PAUSE) { if (!P.paused) P.togglePause(); return true; }
    if (k === K.ENTER) {
      if (P.skip) { doSkip(); return true; }
      P.togglePause(); return true;
    }
    if (k === K.LEFT) { P.seekBy(-10); return true; }
    if (k === K.RIGHT) { P.seekBy(10); return true; }
    if (k === K.RW) { P.seekBy(-30); return true; }
    if (k === K.FF) { P.seekBy(30); return true; }
    // Skip / Up next holding focus with the chrome up: Up goes past the top (hides), Down steps to the row below it
    if (vis && cardUp() && (k === K.UP || k === K.DOWN)) { if (k === K.UP) P.hideOsd(); else focusKind('pp'); return true; }
    if (k === K.UP) { focusKind('pp'); return true; } // also from hidden: one press reaches Play/Pause
    if (k === K.GREEN) { focusKind('sub'); openPop('sub'); return true; }
    if (k === K.RED) { P.cycleSub(); return true; }
    if (k === K.DOWN) { openPanel(P.items.length > 1 ? 'eps' : 'info'); return true; }
    return true;
  };
})();
