/* Spatial navigation + remote key handling. */
(function () {
  var K = N.keys;
  var nav = N.nav = { cur: null, scopes: [], handlers: [] };

  nav.registerKeys = function () {
    try {
      if (window.tizen && tizen.tvinputdevice) {
        ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'ColorF0Red', 'ColorF1Green', 'ChannelUp', 'ChannelDown', 'PreviousChannel', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (n) {
          try { tizen.tvinputdevice.registerKey(n); } catch (e) {}
        });
      }
    } catch (e) {}
  };

  function visible(el) { return el.offsetWidth > 0 && el.offsetHeight > 0; }
  function root() { return nav.scopes.length ? nav.scopes[nav.scopes.length - 1] : document.body; }
  nav.pushScope = function (el) { nav.scopes.push(el); };
  nav.popScope = function () { nav.scopes.pop(); };
  nav.candidates = function () {
    var list = root().querySelectorAll('.f'), out = [];
    for (var i = 0; i < list.length; i++) if (visible(list[i]) && !list[i].disabled) out.push(list[i]);
    return out;
  };

  nav.focus = function (el, noScroll) {
    if (!el) return;
    if (nav.cur && nav.cur !== el) { nav.cur.classList.remove('focus'); }
    nav.cur = el; el.classList.add('focus');
    // AmbiSync-Fork: Container der ausgewählten Karte markieren (CSS dunkelt die übrigen Cover etwas ab)
    var pc = null;
    if (el.classList.contains('card')) { pc = el.parentNode; if (pc && pc.classList && pc.classList.contains('gcell')) pc = pc.parentNode; }
    if (nav._hf && nav._hf !== pc) nav._hf.classList.remove('has-focus');
    if (pc && pc.classList) pc.classList.add('has-focus');
    nav._hf = pc;
    if (el.tagName === 'INPUT') { try { el.focus(); } catch (e) {} }
    else if (document.activeElement && document.activeElement.tagName === 'INPUT') { document.activeElement.blur(); }
    if (!noScroll) nav.ensureVisible(el);
    if (el.onfocus2) el.onfocus2(el);
  };
  nav.focusFirst = function (container) {
    var c = (container || root()).querySelectorAll('.f'), i;
    for (i = 0; i < c.length; i++) if (visible(c[i])) { nav.focus(c[i]); return c[i]; }
    return null;
  };
  nav.clear = function () { if (nav.cur) nav.cur.classList.remove('focus'); nav.cur = null; if (nav._hf) { nav._hf.classList.remove('has-focus'); nav._hf = null; } };

  nav.ensureVisible = function (el) {
    var p = el.parentNode;
    while (p && p !== document.body) {
      if (p.reveal) { p.reveal(el); return; }
      if (p.classList && p.classList.contains('scroll')) {
        var pr = p.getBoundingClientRect(), r = el.getBoundingClientRect();
        var mv = p.hasAttribute('data-mv') ? Number(p.getAttribute('data-mv')) : 130, mh = 60;
        if (r.bottom > pr.bottom - mv) p.scrollTop += r.bottom - (pr.bottom - mv);
        else if (r.top < pr.top + mv) p.scrollTop -= (pr.top + mv) - r.top;
        pr = p.getBoundingClientRect(); r = el.getBoundingClientRect();
        if (r.right > pr.right - mh) p.scrollLeft += r.right - (pr.right - mh);
        else if (r.left < pr.left + mh) p.scrollLeft -= (pr.left + mh) - r.left;
      }
      p = p.parentNode;
    }
  };

  nav.move = function (dir) {
    var cur = nav.cur;
    if (!cur || !visible(cur) || !root().contains(cur)) { nav.focusFirst(); return; }
    var n = cur;
    while (n && n !== document.body) {
      if (n.onnav) { var r0 = n.onnav(dir, cur); if (r0) { if (r0.nodeType) nav.focus(r0); return true; } }
      n = n.parentNode;
    }
    var cr = cur.getBoundingClientRect(), cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    var best = null, bs = 1e12, c = nav.candidates();
    for (var i = 0; i < c.length; i++) {
      var el = c[i]; if (el === cur) continue;
      var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, prim, sec;
      if (dir === 'right') { if (x <= cx + 2) continue; prim = Math.max(0, r.left - cr.right); sec = Math.abs(y - cy); }
      else if (dir === 'left') { if (x >= cx - 2) continue; prim = Math.max(0, cr.left - r.right); sec = Math.abs(y - cy); }
      else if (dir === 'down') { if (y <= cy + 2) continue; prim = Math.max(0, r.top - cr.bottom); sec = Math.abs(x - cx); }
      else { if (y >= cy - 2) continue; prim = Math.max(0, cr.top - r.bottom); sec = Math.abs(x - cx); }
      var s = prim + sec * (dir === 'left' || dir === 'right' ? 4 : 1.5);
      if (s < bs) { bs = s; best = el; }
    }
    if (best) nav.focus(best);
    else if (nav.onEdge) nav.onEdge(dir, cur);
    return !!best;
  };

  // handlers: functions(e) returning true when handled; the topmost (last) goes first
  nav.pushHandler = function (fn) { nav.handlers.push(fn); };
  nav.popHandler = function (fn) { var i = nav.handlers.indexOf(fn); if (i >= 0) nav.handlers.splice(i, 1); };

  function isInput() { var a = document.activeElement; return a && a.tagName === 'INPUT'; }

  // key-repeat detection: halves move durations and defers heavy swaps (stage / billboard)
  var lastKey = 0, fastT = null, fast = false;
  nav.settleFns = [];
  nav.isFast = function () { return fast; };
  nav.onSettle = function (fn) { nav.settleFns.push(fn); };
  nav.offSettle = function (fn) { var i = nav.settleFns.indexOf(fn); if (i >= 0) nav.settleFns.splice(i, 1); };
  function trackRepeat(e) {
    var k = e.keyCode; if (k < 37 || k > 40) return;
    var now = Date.now();
    if (e.repeat || now - lastKey < 160) { if (!fast) { fast = true; document.body.classList.add('fast'); } }
    lastKey = now; clearTimeout(fastT);
    fastT = setTimeout(function () {
      if (!fast) return; fast = false; document.body.classList.remove('fast');
      for (var i = 0; i < nav.settleFns.length; i++) { try { nav.settleFns[i](); } catch (x) {} }
    }, 220);
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (nav.locked && k !== K.BACK && k !== K.ESC) { e.preventDefault(); return; }
    trackRepeat(e);
    for (var i = nav.handlers.length - 1; i >= 0; i--) {
      if (nav.handlers[i](e) === true) { e.preventDefault(); return; }
    }
    if (k === K.BACK || k === K.ESC || (k === K.BACKSPACE && !isInput())) {
      e.preventDefault(); if (N.onBack) N.onBack(); return;
    }
    if (isInput()) {
      if (k === K.IME_DONE || k === K.ENTER) { if (nav.cur && nav.cur.onenter) nav.cur.onenter(); e.preventDefault(); return; }
      if (k === K.LEFT || k === K.RIGHT) return; // caret movement
    }
    if (k === K.LEFT) { e.preventDefault(); nav.move('left'); }
    else if (k === K.RIGHT) { e.preventDefault(); nav.move('right'); }
    else if (k === K.UP) { e.preventDefault(); nav.move('up'); }
    else if (k === K.DOWN) { e.preventDefault(); nav.move('down'); }
    else if (k === K.ENTER) {
      e.preventDefault();
      if (nav.cur) { if (nav.cur.onenter) nav.cur.onenter(); else nav.cur.click(); }
    }
  });
  // mouse support for desktop testing (only on real pointer movement, so content sliding under a still cursor never steals focus)
  document.addEventListener('mousemove', function (e) {
    if (!e.movementX && !e.movementY) return;
    var t = e.target; while (t && t !== document.body) { if (t.classList && t.classList.contains('f')) { if (t !== nav.cur) nav.focus(t); return; } t = t.parentNode; }
  });
})();
