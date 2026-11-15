/* Operation: Falcon Frost — app logic. You shouldn't need to edit this file. */
(function () {
  'use strict';

  const BASE = window.GAME;
  const params = new URLSearchParams(location.search);
  const PRACTICE = params.has('practice');
  const PREVIEW = params.has('preview');
  const EMBED = PREVIEW && params.has('embed');
  const ROOT = PREVIEW ? 'falconfrost-preview' + (EMBED ? '-embed' : '') : 'falconfrost' + (PRACTICE ? '-practice' : '');
  const CONTENT_ROOT = 'falconfrost-content';
  const ONLINE_MS = 35000;

  /* ---------------- content ----------------
     content.js is the starting point and the backup. Anything saved in the
     game builder is stored in the database and takes priority. */
  let G, CAP, STEPS, FINAL_IDX, FINALE_IDX, LAST_PLAYABLE, teamById = {}, hrByRoom = {};
  let contentFrozen = false, pendingContent = null;
  const contentListeners = [];
  const toArr = v => Array.isArray(v) ? v.filter(x => x != null) : (v && typeof v === 'object' ? Object.keys(v).sort((a, b) => a - b).map(k => v[k]).filter(x => x != null) : []);
  function normalizeContent(c) {
    if (!c || !c.steps) return null;
    const steps = toArr(c.steps).map(st => {
      const o = Object.assign({}, st);
      if (o.type !== 'video') o.hints = toArr(o.hints).filter(h => h && typeof h === 'object');
      if (o.type === 'mission') o.code = Object.assign({ answers: [] }, o.code || {}, { answers: toArr(o.code && o.code.answers) });
      return o;
    });
    return { settings: c.settings || {}, steps };
  }
  function buildGame(dbc) {
    const g = JSON.parse(JSON.stringify(BASE));
    if (dbc) {
      const st = dbc.settings || {};
      ['title', 'capMinutes', 'defaultHintPenaltyMinutes', 'startCountdownSeconds'].forEach(k => { if (st[k] != null && st[k] !== '') g[k] = st[k]; });
      if (st.pins) g.pins = Object.assign({}, g.pins, st.pins);
      if (dbc.steps && dbc.steps.length) g.steps = dbc.steps;
    }
    if (PREVIEW) g.homerooms = g.homerooms.concat([{ room: 'P', teacher: 'Preview room', team: g.teams[0].id }]);
    return g;
  }
  function applyContent(g) {
    G = g; CAP = Number(G.capMinutes) * 60000; STEPS = G.steps;
    FINAL_IDX = STEPS.findIndex(s => s.type === 'final');
    FINALE_IDX = STEPS.findIndex(s => s.finale);
    LAST_PLAYABLE = FINAL_IDX >= 0 ? FINAL_IDX : STEPS.length - 1;
    teamById = Object.fromEntries(G.teams.map(t => [t.id, t]));
    hrByRoom = Object.fromEntries(G.homerooms.map(h => [h.room, h]));
  }
  function setFrozen(f) {
    contentFrozen = f;
    if (!f && pendingContent) { applyContent(pendingContent); pendingContent = null; contentListeners.forEach(fn => fn()); }
  }
  function codeMatches(step, input) {
    let n = norm(input);
    const pre = norm((step.code && step.code.prefix) || '');
    if (pre && n.startsWith(pre) && n !== pre) n = n.slice(pre.length);
    return !!n && ((step.code && step.code.answers) || []).some(a => norm(a) === n);
  }

  /* ---------------- helpers ---------------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  function fmt(ms) {
    ms = Math.max(0, Math.floor((ms || 0) / 1000));
    return Math.floor(ms / 60) + ':' + String(ms % 60).padStart(2, '0');
  }
  function parseTime(str) {
    const p = String(str || '').trim().split(':').map(Number);
    if (!p.length || p.some(isNaN)) return null;
    let s = 0; for (const n of p) s = s * 60 + n;
    return s * 1000;
  }
  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const roomName = id => { const h = hrByRoom[id]; return h ? 'Room ' + h.room + ' – ' + h.teacher : 'Room ' + id; };
  const sortedRooms = () => G.homerooms.slice().sort((a, b) => Number(a.room) - Number(b.room) || a.room.localeCompare(b.room));
  const CLIENT = store.get('ff-client') || (() => { const c = newId(); store.set('ff-client', c); return c; })();

  /* ---------------- database adapters ---------------- */
  function makeFirebaseDB(ROOT) {
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    const db = firebase.database();
    let offset = 0, connected = false;
    const connCbs = [];
    db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
    db.ref('.info/connected').on('value', s => { connected = !!s.val(); connCbs.forEach(f => f(connected)); });
    const r = p => db.ref(ROOT + (p ? '/' + p : ''));
    const safe = pr => { if (pr && pr.catch) pr.catch(e => console.error(e)); return pr; };
    return {
      mode: 'firebase',
      now: () => Date.now() + offset,
      on(p, cb) { const ref = r(p); const h = ref.on('value', s => cb(s.val())); return () => ref.off('value', h); },
      once(p) { return r(p).once('value').then(s => s.val()); },
      set: (p, v) => safe(r(p).set(v)),
      update: (p, v) => safe(r(p).update(v)),
      remove: p => safe(r(p).remove()),
      push: (p, v) => safe(r(p).push(v)),
      onConnection(cb) { connCbs.push(cb); cb(connected); }
    };
  }

  function makeLocalDB(ROOT) {
    const KEY = 'ff-demo-db-' + ROOT;
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    let tree = load();
    const listeners = [];
    const bc = ('BroadcastChannel' in window) ? new BroadcastChannel(KEY) : null;
    const parts = p => String(p || '').split('/').filter(Boolean);
    const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
    function getAt(p) { let n = tree; for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : clone(n); }
    function setAt(p, v) {
      const ks = parts(p);
      if (!ks.length) { tree = clone(v) || {}; return; }
      let n = tree;
      for (let i = 0; i < ks.length - 1; i++) { if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') n[ks[i]] = {}; n = n[ks[i]]; }
      if (v == null) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = clone(v);
    }
    function notify() { listeners.forEach(l => { const v = getAt(l.p); const s = JSON.stringify(v); if (s !== l.last) { l.last = s; l.cb(v); } }); }
    function commit() { try { localStorage.setItem(KEY, JSON.stringify(tree)); } catch (e) { } if (bc) bc.postMessage(1); notify(); }
    window.addEventListener('storage', e => { if (e.key === KEY) { tree = load(); notify(); } });
    if (bc) bc.onmessage = () => { tree = load(); notify(); };
    return {
      mode: 'demo',
      now: () => Date.now(),
      on(p, cb) { const l = { p, cb, last: undefined }; listeners.push(l); setTimeout(() => { const v = getAt(p); l.last = JSON.stringify(v); cb(v); }, 0); return () => listeners.splice(listeners.indexOf(l), 1); },
      once(p) { return Promise.resolve(getAt(p)); },
      set(p, v) { setAt(p, v); commit(); return Promise.resolve(); },
      update(p, obj) { for (const k in obj) setAt(p + '/' + k, obj[k]); commit(); return Promise.resolve(); },
      remove(p) { setAt(p, null); commit(); return Promise.resolve(); },
      push(p, v) { setAt(p + '/' + Date.now().toString(36) + newId(), v); commit(); return Promise.resolve(); },
      onConnection(cb) { cb(true); }
    };
  }

  /* ---------------- game math ---------------- */
  function gameElapsed(game, now) {
    if (!game || !game.startAt) return 0;
    const end = (game.status === 'paused' && game.pausedAt) ? game.pausedAt : now;
    return Math.max(0, end - game.startAt - (game.pausedTotal || 0));
  }
  const isStarted = (game, now) => !!(game && game.startAt && now >= game.startAt);
  const creditsOf = room => Object.values((room && room.credits) || {}).reduce((a, c) => a + (Number(c.ms) || 0), 0);
  const penaltyOf = room => (room && room.progress && room.progress.penaltyMs) || 0;
  const stepOf = room => {
    const s = room && room.progress && room.progress.step;
    return Number.isInteger(s) ? Math.min(Math.max(s, 0), LAST_PLAYABLE) : 0;
  };
  function roomScore(room, game, now) {
    const pen = penaltyOf(room), cred = creditsOf(room);
    if (room && room.finish) {
      const s = room.finish.elapsed + pen - cred;
      return { done: true, finished: true, raw: room.finish.elapsed, pen, cred, score: Math.min(CAP, Math.max(0, s)), capped: s >= CAP };
    }
    const el = gameElapsed(game, now);
    if (isStarted(game, now) && el >= CAP) return { done: true, finished: false, timeout: true, raw: CAP, pen, cred, score: CAP, capped: true };
    return { done: false, raw: el, pen, cred, score: Math.min(CAP, Math.max(0, el + pen - cred)) };
  }
  function standings(rooms, game, now) {
    rooms = rooms || {};
    const teams = G.teams.map(t => {
      const members = G.homerooms.filter(h => h.team === t.id).map(h => ({ h, sc: roomScore(rooms[h.room], game, now), room: rooms[h.room] }));
      const avg = members.reduce((a, m) => a + m.sc.score, 0) / (members.length || 1);
      return { t, members, avg, doneCount: members.filter(m => m.sc.done).length, finCount: members.filter(m => m.sc.finished).length };
    });
    teams.sort((a, b) => a.avg - b.avg);
    const finishers = G.homerooms.map(h => ({ h, sc: roomScore(rooms[h.room], game, now), room: rooms[h.room] }))
      .filter(x => x.sc.done).sort((a, b) => a.sc.score - b.sc.score || a.sc.raw - b.sc.raw);
    return { teams, finishers };
  }

  /* ---------------- shared UI ---------------- */
  const overlayRoot = () => $('#overlay-root');
  function openModal(html, { onOpen, dismissable = true } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'overlay';
    wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
    overlayRoot().appendChild(wrap);
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape' && dismissable) close(); };
    document.addEventListener('keydown', onKey);
    if (dismissable) wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    if (onOpen) onOpen(wrap, close);
    return close;
  }
  function confirmBox({ title, text = '', ok = 'Confirm', cancel = 'Cancel', danger = false }) {
    return new Promise(res => {
      openModal(
        '<h2>' + esc(title) + '</h2>' + (text ? '<p>' + text + '</p>' : '') +
        '<div class="row"><button class="btn" data-x>' + esc(cancel) + '</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-ok>' + esc(ok) + '</button></div>',
        {
          onOpen(w, close) {
            let done = false;
            const fin = v => { if (!done) { done = true; close(); res(v); } };
            $('[data-x]', w).onclick = () => fin(false);
            $('[data-ok]', w).onclick = () => fin(true);
            w.addEventListener('mousedown', e => { if (e.target === w) fin(false); });
            document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', k); fin(false); } });
            setTimeout(() => $('[data-ok]', w).focus(), 30);
          }
        });
    });
  }
  function promptBox({ title, text = '', fields, ok = 'Save' }) {
    return new Promise(res => {
      const f = fields.map((fd, i) => '<div style="margin-top:1rem"><label for="pf' + i + '">' + esc(fd.label) + '</label><input id="pf' + i + '" type="text" placeholder="' + esc(fd.placeholder || '') + '" value="' + esc(fd.value || '') + '"></div>').join('');
      openModal('<h2>' + esc(title) + '</h2>' + (text ? '<p class="muted">' + text + '</p>' : '') + f +
        '<div class="feedback" data-fb></div><div class="row"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>' + esc(ok) + '</button></div>', {
        onOpen(w, close) {
          let done = false;
          const fin = v => { if (!done) { done = true; close(); res(v); } };
          $('[data-x]', w).onclick = () => fin(null);
          const submit = () => {
            const vals = fields.map((fd, i) => $('#pf' + i, w).value.trim());
            for (let i = 0; i < fields.length; i++) {
              if (fields[i].validate) { const err = fields[i].validate(vals[i]); if (err) { $('[data-fb]', w).textContent = err; return; } }
            }
            fin(vals);
          };
          $('[data-ok]', w).onclick = submit;
          $$('input', w).forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
          w.addEventListener('mousedown', e => { if (e.target === w) fin(null); });
          setTimeout(() => { const i = $('input', w); if (i) i.focus(); }, 30);
        }
      });
    });
  }
  function modeBanner() {
    if (EMBED) return;
    const txt = PREVIEW ? 'Preview: nothing here affects the real game'
      : (DB.mode === 'demo' ? 'Demo mode: syncs between tabs in this browser only' : '') + (PRACTICE ? (DB.mode === 'demo' ? '. ' : '') + 'Practice run' : '');
    if (!txt) return;
    const b = document.createElement('div'); b.className = 'mode-banner'; b.textContent = txt; document.body.appendChild(b);
  }
  function pinGate(key, pin, title, onPass) {
    if (store.get(key) === pin) return onPass();
    const app = $('#app');
    app.innerHTML = '<div class="center-screen"><div class="narrow stack"><div class="mark"><small>' + esc(G.title) + '</small>' + esc(title) + '</div>' +
      '<div class="panel stack"><label for="pin">PIN</label><input id="pin" type="password" autocomplete="off"><div class="feedback" id="pinfb"></div><button class="btn primary big" id="go" style="width:100%">Open</button></div></div></div>';
    const go = () => {
      if ($('#pin').value.trim() === pin) { store.set(key, pin); onPass(); }
      else { $('#pinfb').textContent = 'That PIN doesn\'t match. Try again.'; $('#pin').select(); }
    };
    $('#go').onclick = go;
    $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    $('#pin').focus();
  }
  function log(text, room) { DB.push('log', { at: DB.now(), text, room: room || null }); }

  /* ---------------- YouTube helpers ---------------- */
  function whenYT(timeoutMs) {
    return new Promise(res => {
      if (window.__ytReady && window.YT && YT.Player) return res(true);
      const t = setTimeout(() => res(false), timeoutMs);
      document.addEventListener('yt-ready', () => { clearTimeout(t); res(true); }, { once: true });
    });
  }
  async function checkVideos() {
    const vids = STEPS.filter(s => s.type === 'video');
    const withId = vids.filter(v => v.youtubeId);
    const result = { total: vids.length, placeholders: vids.length - withId.length, ok: 0, failed: [], api: false, at: DB.now() };
    if (!withId.length) return result;
    const api = await whenYT(12000);
    result.api = api;
    if (!api) return result;
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:180px;overflow:hidden';
    document.body.appendChild(holder);
    await Promise.all(withId.map(v => new Promise(res => {
      const d = document.createElement('div'); holder.appendChild(d);
      let settled = false, p;
      const finish = ok => { if (settled) return; settled = true; ok ? result.ok++ : result.failed.push(v.label); try { p.destroy(); } catch (e) { } res(); };
      try {
        p = new YT.Player(d, {
          videoId: v.youtubeId, width: 320, height: 180, playerVars: { rel: 0 },
          events: { onReady: () => setTimeout(() => finish(true), 4000), onError: () => finish(false) }
        });
      } catch (e) { finish(false); }
      setTimeout(() => finish(false), 20000);
    })));
    holder.remove();
    return result;
  }

  let player = null;
  function destroyPlayer() { if (player) { try { player.destroy(); } catch (e) { } player = null; } }
  function mountVideo(box, step, { onEnded, onError }) {
    destroyPlayer();
    box.innerHTML = '';
    if (!step.youtubeId) {
      box.innerHTML = '<div class="video-placeholder"><div><h2>' + esc(step.label) + '</h2><p class="muted">This video hasn\'t been added yet. Read the recap below, then continue.</p></div></div>';
      return 'placeholder';
    }
    if (window.__ytReady && window.YT && YT.Player) {
      const d = document.createElement('div'); box.appendChild(d);
      player = new YT.Player(d, {
        videoId: step.youtubeId, width: '100%', height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onStateChange: e => { if (e.data === 0) onEnded(); },
          onError: () => onError()
        }
      });
      return 'api';
    }
    box.innerHTML = '<iframe src="https://www.youtube.com/embed/' + encodeURIComponent(step.youtubeId) + '?rel=0&playsinline=1" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen title="' + esc(step.label) + '"></iframe>';
    return 'iframe';
  }

  /* =====================================================================
     TEACHER VIEW
     ===================================================================== */
  function teacherApp() {
    let game = null, rooms = {}, room = null, roomId = store.get('ff-room-' + ROOT), connected = true;
    let unsubRoom = null, viewKey = '', videoEnded = false, videoMode = '', hb = null, checkRunning = false;
    const app = $('#app');

    DB.on('game', v => { game = v; store.set('ff-cache-game-' + ROOT, v); });
    DB.on('rooms', v => { rooms = v || {}; });
    DB.onConnection(c => { connected = c; updateTopbar(); });
    game = store.get('ff-cache-game-' + ROOT);

    const pinOk = () => store.get('ff-tpin') === G.pins.teacher;
    contentListeners.push(() => { viewKey = ''; if (PREVIEW && !EMBED) drawPreviewTools(); });
    if (PREVIEW) previewBoot();
    else if (roomId && hrByRoom[roomId] && pinOk()) startSession(roomId); else { roomId = null; render(true); }

    /* ---- preview mode: a private copy of the game for testing ---- */
    function previewSet(n, upd, game0) {
      const now = DB.now();
      n = Math.max(0, Math.min(n, STEPS.length - 1));
      if (n === FINALE_IDX) {
        const runId = (upd.game && upd.game.runId) || (game0 && game0.runId) || '';
        const start = (upd.game && upd.game.startAt) || (game0 && game0.startAt) || now;
        const el = Math.max(1000, now - start);
        upd['rooms/P/finish'] = { elapsed: el, by: 'preview', at: now };
        store.set('ff-done-' + ROOT + '-P', { sig: runId + '|' + now, stage: 'finale' });
      } else {
        upd['rooms/P/finish'] = null;
        upd['rooms/P/progress/step'] = Math.min(n, LAST_PLAYABLE);
        upd['rooms/P/progress/stepAt'] = now;
      }
    }
    async function previewBoot() {
      const now = DB.now();
      const g = await DB.once('game');
      const upd = { 'rooms/P/claim': { client: CLIENT, at: now } };
      if (!g || !g.startAt || (EMBED && params.get('step') != null)) upd.game = { status: 'running', startAt: now - 1000, pausedTotal: 0, runId: newId() };
      const sp = params.get('step');
      if (sp != null && !isNaN(Number(sp))) previewSet(Number(sp), upd, g);
      await DB.update('', upd);
      startSession('P');
      if (!EMBED) drawPreviewTools();
    }
    let pvHidden = false, pvKey = '';
    function drawPreviewTools(force) {
      let el = $('#pv-tools');
      if (!el) { el = document.createElement('div'); el.id = 'pv-tools'; document.body.appendChild(el); force = true; }
      const i = (room && room.finish) ? FINALE_IDX : stepOf(room);
      const st = STEPS[i] || {};
      const key = pvHidden + '|' + i + '|' + !!(room && room.finish) + '|' + JSON.stringify(st.code || '') + STEPS.length;
      if (!force && key === pvKey) return;
      pvKey = key;
      if (pvHidden) { el.className = 'pv-tools mini'; el.innerHTML = '<button class="btn sm" data-pv="show">Preview tools</button>'; }
      else {
        const code = st.type === 'mission' ? ((st.code && st.code.answers && st.code.answers.length) ? esc(st.code.answers.join('  or  ')) : '<span style="color:#ffb4ac">No codeword set</span>') : '<span class="muted">None on this step</span>';
        el.className = 'pv-tools';
        el.innerHTML = '<div class="pv-head"><strong>Preview tools</strong><button class="btn ghost sm" data-pv="hide">Hide</button></div>' +
          '<label for="pv-step">Jump to</label><select id="pv-step" data-pv-step>' + STEPS.map((s2, n) => '<option value="' + n + '"' + (n === i ? ' selected' : '') + '>' + esc(s2.label) + '</option>').join('') + '</select>' +
          '<div class="pv-code">Codeword: <strong>' + code + '</strong></div>' +
          '<div class="pv-btns">' + (room && room.finish ? '<button class="btn sm" data-pv="unlib">Undo library check-in</button>' : '<button class="btn sm" data-pv="lib">Simulate library check-in</button>') +
          '<button class="btn sm" data-pv="timeup">Test time\'s up</button><button class="btn sm" data-pv="restart">Restart preview</button></div>';
      }
      el.onclick = async e => {
        const b = e.target.closest('[data-pv]'); if (!b) return;
        const a = b.dataset.pv, now = DB.now();
        if (a === 'hide') pvHidden = true;
        if (a === 'show') pvHidden = false;
        if (a === 'lib') DB.set('rooms/P/finish', { elapsed: gameElapsed(game, now), by: 'preview', at: now });
        if (a === 'unlib') DB.remove('rooms/P/finish');
        if (a === 'timeup') DB.update('game', { status: 'running', startAt: now - CAP - 1000, pausedTotal: 0, pausedAt: null });
        if (a === 'restart') {
          store.del('ff-done-' + ROOT + '-P');
          DB.update('', { game: { status: 'running', startAt: now - 1000, pausedTotal: 0, runId: newId() }, 'rooms/P/progress': null, 'rooms/P/finish': null, 'rooms/P/credits': null });
        }
        setTimeout(() => drawPreviewTools(true), 50);
      };
      const sel = $('[data-pv-step]', el);
      if (sel) sel.onchange = () => { const upd = {}; previewSet(Number(sel.value), upd, game); DB.update('', upd); setTimeout(() => drawPreviewTools(true), 50); };
    }

    function startSession(id) {
      roomId = id;
      store.set('ff-room-' + ROOT, id);
      room = store.get('ff-cache-room-' + ROOT + '-' + id);
      if (unsubRoom) unsubRoom();
      unsubRoom = DB.on('rooms/' + id, v => { room = v; store.set('ff-cache-room-' + ROOT + '-' + id, v); });
      const beat = () => DB.update('rooms/' + id + '/presence', { lastSeen: DB.now(), client: CLIENT });
      beat(); clearInterval(hb); hb = setInterval(beat, 10000);
      if (!EMBED) runVideoCheck();
      render(true);
    }
    async function runVideoCheck() {
      if (checkRunning) return; checkRunning = true;
      const r = await checkVideos();
      checkRunning = false;
      if (roomId) DB.set('rooms/' + roomId + '/check', r);
    }
    function leaveRoom() {
      if (unsubRoom) unsubRoom(); unsubRoom = null;
      clearInterval(hb);
      const id = roomId;
      store.del('ff-room-' + ROOT);
      roomId = null; room = null; destroyPlayer();
      if (id) DB.update('rooms/' + id, { claim: null, presence: null });
      render(true);
    }

    function writeProgress(patch) {
      const cur = (room && room.progress) || {};
      const p = Object.assign({ step: 0, hints: {}, penaltyMs: 0, attempts: {} }, cur, patch, { at: DB.now() });
      room = Object.assign({}, room, { progress: p });
      DB.set('rooms/' + roomId + '/progress', p);
      viewKey = ''; tick();
    }

    /* ---- mode resolution ---- */
    function currentMode() {
      if (!roomId) return 'pick';
      if (room && room.claim && room.claim.client && room.claim.client !== CLIENT) return 'kicked';
      if (room && !room.claim) return 'released';
      const now = DB.now();
      if (!game || !game.startAt) return 'lobby';
      if (now < game.startAt) return 'countdown';
      const sc = roomScore(room, game, now);
      if (sc.done) return 'done';
      return 'play';
    }
    function doneState() {
      const k = 'ff-done-' + ROOT + '-' + roomId;
      const st = store.get(k) || {};
      const sig = (game && game.runId || '') + '|' + ((room && room.finish && room.finish.at) || 'timeout');
      if (st.sig !== sig) return { sig, stage: 'summary', k };
      return Object.assign(st, { k });
    }
    function setDoneStage(stage) { const d = doneState(); store.set(d.k, { sig: d.sig, stage }); viewKey = ''; tick(); }

    function computeKey() {
      const m = currentMode();
      if (m === 'pick' || m === 'kicked' || m === 'released' || m === 'countdown') return m;
      if (m === 'lobby') return m + JSON.stringify((room && room.check) || null) + connected;
      if (m === 'done') return m + doneState().stage + doneState().sig;
      const i = stepOf(room);
      return 'play' + i + '|' + ((room && room.progress && room.progress.hints && room.progress.hints[STEPS[i].id]) || 0);
    }

    /* ---- render ---- */
    function render(force) {
      const k = computeKey();
      if (!force && k === viewKey) return;
      viewKey = k;
      const m = currentMode();
      document.body.classList.toggle('with-actionbar', m === 'play');
      if (m !== 'play' && !(m === 'done' && doneState().stage === 'finale')) destroyPlayer();
      if (m === 'pick') return renderPick();
      if (m === 'kicked' || m === 'released') return renderKicked(m === 'released');
      if (m === 'lobby') return renderLobby();
      if (m === 'countdown') return renderCountdown();
      if (m === 'done') return renderDone();
      return renderStep();
    }

    function topbarHTML() {
      const h = hrByRoom[roomId], t = teamById[h.team];
      return '<header class="topbar"><div class="who"><strong>Room ' + esc(h.room) + '</strong><span>' + esc(h.teacher) + '</span>' +
        '<span class="chip" style="color:' + t.color + '">' + esc(t.name) + '</span></div>' +
        '<div class="clock-wrap"><div class="clock" data-clock>0:00</div><div class="clock-sub" data-clocksub></div></div>' +
        '<div class="status"><span class="dot" data-conn></span><span data-conntxt></span><button class="btn ghost sm" data-menu aria-label="Room menu">Room menu</button></div></header>';
    }
    function bindTopbar() {
      const b = $('[data-menu]');
      if (b) b.onclick = () => openModal(
        '<h2>' + esc(roomName(roomId)) + '</h2><p class="muted">Leaving frees this room so it can be opened on another computer. Progress is saved.</p>' +
        '<div class="row"><button class="btn" data-x>Close</button><button class="btn danger" data-leave>Leave this room</button></div>',
        { onOpen(w, close) { $('[data-x]', w).onclick = close; $('[data-leave]', w).onclick = () => { close(); leaveRoom(); }; } });
      updateTopbar();
    }
    function updateTopbar() {
      const d = $('[data-conn]'), t = $('[data-conntxt]');
      if (!d) return;
      d.className = 'dot' + (connected ? '' : ' off');
      t.textContent = DB.mode === 'demo' ? 'Demo' : (connected ? 'Online' : 'Reconnecting…');
    }

    function renderPick() {
      const groups = G.teams.map(t => '<optgroup label="' + esc(t.name) + '">' +
        G.homerooms.filter(h => h.team === t.id).sort((a, b) => a.room - b.room).map(h => {
          const r = rooms[h.room];
          const busy = r && r.presence && r.presence.client !== CLIENT && (DB.now() - (r.presence.lastSeen || 0) < ONLINE_MS);
          return '<option value="' + esc(h.room) + '">Room ' + esc(h.room) + ' – ' + esc(h.teacher) + (busy ? ' (open elsewhere)' : '') + '</option>';
        }).join('') + '</optgroup>').join('');
      app.innerHTML = '<div class="center-screen"><div class="narrow stack">' +
        '<div class="mark"><small>Teacher check-in</small>' + esc(G.title) + '</div>' +
        '<div class="panel stack">' +
        '<div><label for="rm">Your homeroom</label><select id="rm"><option value="">Choose your room</option>' + groups + '</select></div>' +
        '<div><label for="tp">Teacher PIN</label><input id="tp" type="password" autocomplete="off" value="' + (pinOk() ? esc(G.pins.teacher) : '') + '"></div>' +
        '<div class="feedback" id="fb"></div>' +
        '<button class="btn primary big" id="go" style="width:100%">Check in</button></div>' +
        '<p class="muted small" style="text-align:center">Check in before school. Your screen will wait for the start signal.</p></div></div>';
      const go = async () => {
        const id = $('#rm').value, pin = $('#tp').value.trim();
        if (!id) { $('#fb').textContent = 'Choose your homeroom first.'; return; }
        if (pin !== G.pins.teacher) { $('#fb').textContent = 'That PIN doesn\'t match. Check with the event coordinator.'; return; }
        store.set('ff-tpin', pin);
        const r = rooms[id];
        const busy = r && r.presence && r.presence.client !== CLIENT && (DB.now() - (r.presence.lastSeen || 0) < ONLINE_MS);
        if (busy) {
          const yes = await confirmBox({ title: 'Room ' + id + ' is open on another computer', text: 'If you take over, that computer will stop running the game. Progress is kept.', ok: 'Take over here' });
          if (!yes) return;
        }
        await DB.update('rooms/' + id, { claim: { client: CLIENT, at: DB.now() } });
        if (!(r && r.progress)) log(roomName(id) + ' checked in', id); else log(roomName(id) + ' reopened on a new computer', id);
        startSession(id);
      };
      $('#go').onclick = go;
      $('#tp').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    }

    function renderKicked(released) {
      app.innerHTML = '<div class="center-screen"><div class="narrow stack" style="text-align:center"><div class="mark">' + (released ? 'Room released' : 'Opened elsewhere') + '</div>' +
        '<p>' + esc(roomName(roomId)) + (released ? ' was released from the control panel. Progress is saved.' : ' was opened on another computer, so this screen stopped.') + '</p>' +
        '<div class="row" style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap"><button class="btn primary big" id="take">Use this computer instead</button><button class="btn big" id="lv">Choose a different room</button></div></div></div>';
      $('#take').onclick = () => DB.update('rooms/' + roomId, { claim: { client: CLIENT, at: DB.now() } });
      $('#lv').onclick = () => { if (unsubRoom) unsubRoom(); unsubRoom = null; clearInterval(hb); store.del('ff-room-' + ROOT); roomId = null; render(true); };
    }

    function renderLobby() {
      const c = room && room.check;
      let vidLine;
      if (!c) vidLine = '<li><span class="dot warn"></span><span>Checking videos…</span></li>';
      else {
        const parts = [];
        if (c.total - c.placeholders === 0) parts.push('<li><span class="dot warn"></span><span>Videos haven\'t been added yet. Each video screen will show a written recap instead.</span></li>');
        else if (!c.api) parts.push('<li><span class="dot warn"></span><span>The YouTube player didn\'t load. Videos will use a simple player, and you\'ll press Continue yourself after each one.</span></li>');
        else if ((c.failed || []).length) parts.push('<li><span class="dot off"></span><span>' + c.failed.length + ' video(s) won\'t play here: ' + esc(c.failed.join(', ')) + '. The event coordinator can see this.</span></li>');
        else parts.push('<li><span class="dot"></span><span>All ' + c.ok + ' videos are ready to play.</span></li>');
        vidLine = parts.join('');
      }
      app.innerHTML = topbarHTML() + '<div class="center-screen"><div class="stack" style="width:min(900px,100%)">' +
        '<div class="mark"><small>Stand by, Falcon Frost Agents</small>' + esc(G.title) + '</div>' +
        '<p style="text-align:center;font-size:1.2em">The timer starts on every screen at the same moment, right after the announcement.</p>' +
        '<div class="panel"><ul class="checklist">' +
        '<li><span class="dot"></span><span>Checked in as ' + esc(roomName(roomId)) + '.</span></li>' +
        '<li><span class="dot ' + (connected ? '' : 'off') + '"></span><span>' + (connected ? 'Connected to the game server.' : 'Not connected yet. Check the Wi-Fi, then reload this page.') + '</span></li>' +
        vidLine + '</ul></div>' +
        '<p class="muted small" style="text-align:center">Teachers: leave this screen up on the TV. You don\'t need to press anything to start.</p></div></div>';
      bindTopbar();
    }

    function renderCountdown() {
      app.innerHTML = topbarHTML() + '<div class="center-screen" style="text-align:center"><div><div class="mark" style="font-size:clamp(2rem,5vw,5rem)">Mission begins in</div><div class="countdown" data-countdown></div></div></div>';
      bindTopbar();
    }

    function stepHeader(i) {
      const missions = STEPS.filter(s => s.type !== 'video');
      const st = STEPS[i];
      const n = missions.indexOf(st);
      return n >= 0 ? '<div class="step-count">Mission ' + (n + 1) + ' of ' + missions.length + '</div>' : '';
    }

    function renderStep() {
      const i = stepOf(room), st = STEPS[i];
      if (st.type === 'video') return renderVideoStep(i, st);
      const hintsAvail = (st.hints || []).filter(h => h && h.text).length;
      const used = (room && room.progress && room.progress.hints && room.progress.hints[st.id]) || 0;
      const prevIsVideo = i > 0 && STEPS[i - 1].type === 'video';
      app.innerHTML = topbarHTML() + '<main class="stage"><h1>' + esc(st.title) + '</h1><div class="mission-body">' + st.body + '</div></main>' +
        '<div class="actionbar"><div class="left">' +
        '<button class="btn big" data-hints>' + (hintsAvail ? 'Get a hint' + (used ? ' (' + used + ' of ' + hintsAvail + ' used)' : '') : 'Hints') + '</button>' +
        (prevIsVideo ? '<button class="btn ghost" data-replay>Replay the video</button>' : '') +
        '</div><div class="right">' +
        (st.type === 'final'
          ? '<div class="waiting"><span class="pulse"></span>Your clock stops when Mrs. Vu checks your runners in at the library.</div>'
          : '<button class="btn primary big" data-code>Enter codeword</button>') +
        '</div></div>';
      bindTopbar();
      const hb = $('[data-hints]'); if (hb) hb.onclick = () => openHints(i);
      const cb = $('[data-code]'); if (cb) cb.onclick = () => openCode(i);
      const rb = $('[data-replay]'); if (rb) rb.onclick = () => writeProgress({ step: i - 1 });
    }

    function renderVideoStep(i, st, isFinale) {
      videoEnded = false;
      app.innerHTML = topbarHTML() + '<main class="stage">' +
        '<h1 class="video-title">' + esc(st.title) + '</h1><div class="video-box" data-vbox></div>' +
        (st.recap ? '<div class="recap ' + (st.youtubeId ? 'hidden' : '') + '" data-recap><h3>Recap</h3><p style="margin:0">' + esc(st.recap) + '</p></div>' : '') +
        '</main><div class="actionbar"><div class="left">' +
        (st.recap && st.youtubeId ? '<button class="btn ghost" data-showrecap>Show recap</button>' : '') +
        (st.youtubeId ? '<a class="btn ghost" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=' + encodeURIComponent(st.youtubeId) + '">Open on YouTube</a>' : '') +
        '</div><div class="right" data-vact></div></div>';
      document.body.classList.add('with-actionbar');
      bindTopbar();
      const sr = $('[data-showrecap]');
      if (sr) sr.onclick = () => { $('[data-recap]').classList.toggle('hidden'); sr.textContent = $('[data-recap]').classList.contains('hidden') ? 'Show recap' : 'Hide recap'; };
      videoMode = mountVideo($('[data-vbox]'), st, {
        onEnded: () => { videoEnded = true; drawVideoActions(i, isFinale); },
        onError: () => {
          videoMode = 'error';
          const r = $('[data-recap]'); if (r) r.classList.remove('hidden');
          drawVideoActions(i, isFinale);
        }
      });
      drawVideoActions(i, isFinale);
    }
    function drawVideoActions(i, isFinale) {
      const box = $('[data-vact]'); if (!box) return;
      const free = videoEnded || videoMode !== 'api';
      const label = isFinale ? 'Finish' : 'Continue to the mission';
      box.innerHTML = (videoMode === 'error' ? '<span class="waiting" style="color:#ffb4ac">This video won\'t play. Read the recap, then continue.</span>' : '') +
        (free ? '<button class="btn primary big" data-next>' + label + '</button>'
              : '<button class="btn" data-skip>Skip video</button>');
      const n = $('[data-next]', box), s = $('[data-skip]', box);
      const go = () => { if (isFinale) setDoneStage('closed'); else writeProgress({ step: i + 1, stepAt: DB.now() }); };
      if (n) n.onclick = go;
      if (s) s.onclick = async () => {
        if (await confirmBox({ title: 'Skip the rest of this video?', text: 'Use this if the video won\'t play or you\'ve already watched it.', ok: 'Skip video' })) {
          if (player) try { player.pauseVideo(); } catch (e) { }
          go();
        }
      };
    }

    function renderDone() {
      const d = doneState();
      if (d.stage === 'finale' && FINALE_IDX >= 0) return renderVideoStep(FINALE_IDX, STEPS[FINALE_IDX], true);
      const now = DB.now(), sc = roomScore(room, game, now);
      if (d.stage === 'closed') {
        app.innerHTML = topbarHTML() + '<div data-board></div>' +
          '<div class="actionbar"><div class="left"><span class="muted">Final time: <strong style="color:var(--tinsel)">' + fmt(sc.score) + '</strong></span></div><div class="right">' +
          (FINALE_IDX >= 0 ? '<button class="btn" data-replay>Replay final video</button>' : '') + '</div></div>';
        document.body.classList.add('with-actionbar');
        bindTopbar();
        const rb = $('[data-replay]'); if (rb) rb.onclick = () => setDoneStage('finale');
        drawBoard($('[data-board]'), rooms, game, roomId);
        return;
      }
      const headline = sc.finished ? 'Case cracked!' : 'Time\'s up, agents';
      const sub = sc.finished ? 'Mrs. Vu checked your runners in at the library.' : 'The 70-minute mission window has closed. Your time counts as ' + fmt(CAP) + '.';
      app.innerHTML = topbarHTML() + '<div class="center-screen"><div style="width:min(1000px,100%);text-align:center">' +
        '<div class="mark">' + headline + '</div><p style="font-size:1.2em">' + sub + '</p>' +
        '<div class="result-grid">' +
        (sc.finished ? '<div class="panel"><div class="num">' + fmt(sc.raw) + '</div><div class="muted small">Mission clock</div></div>' +
        '<div class="panel"><div class="num" style="color:#ffb4ac">+' + fmt(sc.pen) + '</div><div class="muted small">Hint penalties</div></div>' : '') +
        (sc.cred && sc.finished ? '<div class="panel"><div class="num" style="color:var(--ok)">−' + fmt(sc.cred) + '</div><div class="muted small">Time credits</div></div>' : '') +
        '<div class="panel final"><div class="num">' + fmt(sc.score) + '</div><div class="muted small">Final time' + (sc.capped && sc.finished ? ' (capped)' : '') + '</div></div>' +
        '</div>' +
        (FINALE_IDX >= 0 ? '<button class="btn primary big" data-finale>Play the final video</button>' : '<button class="btn primary big" data-closed>See the standings</button>') +
        '</div></div>';
      bindTopbar();
      const f = $('[data-finale]'); if (f) f.onclick = () => setDoneStage('finale');
      const c = $('[data-closed]'); if (c) c.onclick = () => setDoneStage('closed');
    }

    /* ---- code entry ---- */
    function openCode(i) {
      const st = STEPS[i];
      const prefix = st.code && st.code.prefix;
      openModal('<h2>Enter the codeword</h2>' +
        (prefix ? '<div class="prefix">' + esc(prefix) + ' …</div>' : '') +
        '<input class="code-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Codeword">' +
        '<div class="feedback" data-fb></div>' +
        '<div class="row"><button class="btn" data-x>Cancel</button><button class="btn primary big" data-ok>Check codeword</button></div>', {
        onOpen(w, close) {
          const inp = $('input', w), fb = $('[data-fb]', w), modal = $('.modal', w);
          setTimeout(() => inp.focus(), 30);
          $('[data-x]', w).onclick = close;
          const check = () => {
            const val = inp.value;
            if (!norm(val)) { fb.textContent = 'Type the codeword first.'; return; }
            const ok = codeMatches(st, val);
            const attempts = Object.assign({}, room && room.progress && room.progress.attempts);
            if (!ok) {
              attempts[st.id] = (attempts[st.id] || 0) + 1;
              writeProgress({ attempts });
              fb.textContent = 'Not quite. Check the spelling and try again.';
              modal.classList.remove('shake'); void modal.offsetWidth; modal.classList.add('shake');
              inp.select();
              return;
            }
            close();
            stamp();
            log(roomName(roomId) + ' cracked ' + st.label, roomId);
            setTimeout(() => writeProgress({ step: i + 1, stepAt: DB.now() }), 1500);
          };
          $('[data-ok]', w).onclick = check;
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
        }
      });
    }
    function stamp() {
      const s = document.createElement('div');
      s.className = 'stamp-wrap';
      s.innerHTML = '<div class="stamp">Access<br>granted<small>Next file unlocked</small></div>';
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1500);
    }

    /* ---- hints ---- */
    function openHints(i) {
      const st = STEPS[i];
      const hints = (st.hints || []).filter(h => h && h.text);
      let close = () => {};
      openModal('<div data-hbody></div>', { onOpen: (w, c) => { close = c; draw(w); } });
      function draw(w) {
        const used = (room && room.progress && room.progress.hints && room.progress.hints[st.id]) || 0;
        const body = $('[data-hbody]', w);
        if (!hints.length) {
          body.innerHTML = '<h2>Hints</h2><p>There are no hints for this mission. Ask an ASB helper if your squad is stuck.</p><div class="row"><button class="btn primary" data-x>Close</button></div>';
        } else {
          const items = hints.map((h, n) => {
            const pen = (h.penaltyMinutes != null ? h.penaltyMinutes : G.defaultHintPenaltyMinutes);
            if (n < used) return '<li><div class="hint-head">Hint ' + (n + 1) + ' (+' + pen + ' min)</div>' + esc(h.text) + '</li>';
            if (n === used) return '<li class="locked"><div class="hint-head">Hint ' + (n + 1) + '</div><button class="btn primary" data-reveal="' + n + '">Reveal hint ' + (n + 1) + ' (adds ' + pen + ' min)</button></li>';
            return '<li class="locked"><div class="hint-head">Hint ' + (n + 1) + '</div>Unlocks after hint ' + n + '.</li>';
          }).join('');
          body.innerHTML = '<h2>Hints for this mission</h2><p class="muted">Each hint adds time to your final score.</p><ul class="hint-list">' + items + '</ul><div class="row"><button class="btn" data-x>Close</button></div>';
        }
        $('[data-x]', w).onclick = close;
        const rv = $('[data-reveal]', w);
        if (rv) rv.onclick = async () => {
          const n = Number(rv.dataset.reveal), h = hints[n];
          const pen = (h.penaltyMinutes != null ? h.penaltyMinutes : G.defaultHintPenaltyMinutes);
          const yes = await confirmBox({ title: 'Use hint ' + (n + 1) + '?', text: 'This adds <strong>' + pen + ' minute' + (pen === 1 ? '' : 's') + '</strong> to your final time.', ok: 'Use hint (+' + pen + ' min)' });
          if (!yes) return;
          const hs = Object.assign({}, room && room.progress && room.progress.hints);
          hs[st.id] = n + 1;
          writeProgress({ hints: hs, penaltyMs: penaltyOf(room) + pen * 60000 });
          log(roomName(roomId) + ' used hint ' + (n + 1) + ' on ' + st.label + ' (+' + pen + ' min)', roomId);
          draw(w);
        };
      }
    }

    /* ---- tick ---- */
    let pauseEl = null, lastBoard = 0;
    function tick() {
      render(false);
      const md = currentMode();
      if (!PREVIEW) setFrozen(md === 'countdown' || md === 'play' || md === 'done');
      else if (!EMBED && roomId) drawPreviewTools();
      const now = DB.now();
      const clock = $('[data-clock]');
      if (clock) {
        const sc = roomScore(room, game, now);
        const started = isStarted(game, now);
        clock.textContent = started ? fmt(sc.done ? sc.raw : gameElapsed(game, now)) : fmt(0);
        const sub = $('[data-clocksub]');
        if (sub) sub.innerHTML = (sc.pen ? '<span class="pen">+' + fmt(sc.pen) + ' hints</span>' : '') + (sc.pen && sc.cred ? '&nbsp;&nbsp;' : '') + (sc.cred ? '<span class="cred">−' + fmt(sc.cred) + ' credit</span>' : '') + (sc.done ? '&nbsp;&nbsp;stopped' : '');
      }
      const bd = $('[data-board]');
      if (bd && now - lastBoard > 1000) { lastBoard = now; drawBoard(bd, rooms, game, roomId); }
      const cd = $('[data-countdown]');
      if (cd && game && game.startAt) cd.textContent = Math.max(1, Math.ceil((game.startAt - now) / 1000));
      const paused = roomId && game && game.status === 'paused' && currentMode() === 'play';
      if (paused && !pauseEl) {
        pauseEl = document.createElement('div'); pauseEl.className = 'pause-layer';
        pauseEl.innerHTML = '<div><div class="mark">Mission paused</div><p style="font-size:1.3em">Freeze, agents. The clock is stopped on every screen.</p></div>';
        document.body.appendChild(pauseEl);
        if (player) try { player.pauseVideo(); } catch (e) { }
      } else if (!paused && pauseEl) { pauseEl.remove(); pauseEl = null; }
    }
    setInterval(tick, 250);
  }

  /* =====================================================================
     LEADERBOARD (also used inside the teacher's closing screen)
     ===================================================================== */
  function drawBoard(el, rooms, game, highlightRoom) {
    const now = DB.now();
    const { teams, finishers } = standings(rooms, game, now);
    const allDone = teams.every(t => t.doneCount === t.members.length);
    const started = isStarted(game, now);
    const teamRows = teams.map((t, i) => {
      const chips = t.members.slice().sort((a, b) => Number(a.h.room) - Number(b.h.room)).map(m => {
        const cls = m.sc.done ? (m.sc.finished ? 'done' : 'capped') : '';
        const val = m.sc.done ? fmt(m.sc.score) : (started ? 'in play' : 'ready');
        const me = m.h.room === highlightRoom ? ' style="outline:3px solid var(--tinsel);outline-offset:2px"' : '';
        return '<span class="room-chip ' + cls + '"' + me + '>' + esc(m.h.room) + ' ' + esc(m.h.teacher) + ': ' + val + '</span>';
      }).join('');
      return '<div class="team-row" style="--tc:' + t.t.color + '"><div class="rank">' + (started ? i + 1 : '–') + '</div>' +
        '<div><div class="team-name">' + esc(t.t.name) + '</div><div class="team-meta">' + t.finCount + ' of ' + t.members.length + ' homerooms finished' + (t.doneCount > t.finCount ? ', ' + (t.doneCount - t.finCount) + ' ran out of time' : '') + '</div><div class="room-chips">' + chips + '</div></div>' +
        '<div class="team-avg"><div class="num">' + (started ? fmt(t.avg) : '–') + '</div><div class="lbl">' + (t.doneCount === t.members.length ? 'Final average' : 'Average so far') + '</div></div></div>';
    }).join('');
    const rows = finishers.map((f, i) => {
      const t = teamById[f.h.team];
      return '<tr' + (f.h.room === highlightRoom ? ' style="background:rgba(244,197,74,.12)"' : '') + '><td class="t">' + ordinal(i + 1) + '</td><td>Room ' + esc(f.h.room) + ' – ' + esc(f.h.teacher) + '</td>' +
        '<td style="color:' + t.color + '">' + esc(t.name) + '</td><td class="t">' + fmt(f.sc.score) + '</td><td>' + (f.sc.finished ? (f.sc.pen ? '+' + fmt(f.sc.pen) + ' hints' : 'No hints') : 'Time ran out') + '</td></tr>';
    }).join('');
    el.innerHTML = '<div class="board"><div class="board-head"><div><h1>' + (allDone && started ? 'Final standings' : 'Falcon team standings') + '</h1>' +
      (allDone && started ? '<div class="leader-badge" style="font-size:1.4em">' + winnerLine(teams) + '</div>' : '') + '</div>' +
      '<div class="clock-wrap"><div class="clock">' + fmt(started ? Math.min(gameElapsed(game, now), CAP) : 0) + '</div><div class="clock-sub">Mission clock</div></div></div>' +
      '<div class="teams">' + teamRows + '</div>' +
      '<div class="finish-list"><h2>Finish order</h2>' + (rows ? '<div style="overflow-x:auto"><table class="finish-table"><thead><tr><th>Place</th><th>Homeroom</th><th>Team</th><th>Final time</th><th>Penalties</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="muted">No homerooms have reached the library yet.</p>') + '</div>' +
      '<p class="board-note">Team score is the average final time of all six homerooms, lowest wins. Rooms still playing count their current time until they finish. Any time over ' + G.capMinutes + ':00 counts as ' + G.capMinutes + ':00.</p></div>';
  }

  function winnerLine(teams) {
    const top = teams.filter(t => Math.abs(t.avg - teams[0].avg) < 1000);
    if (top.length > 1) return esc(top.map(t => t.t.name).join(' and ')) + ' are tied for first!';
    return esc(teams[0].t.name) + ' win Operation: Falcon Frost!';
  }
  function boardApp() {
    let game = null, rooms = {};
    DB.on('game', v => { game = v; });
    DB.on('rooms', v => { rooms = v || {}; });
    const el = $('#app');
    const draw = () => drawBoard(el, rooms, game, null);
    setInterval(draw, 1000); draw();
  }

  /* =====================================================================
     LIBRARY VIEW
     ===================================================================== */
  function libraryApp() {
    let game = null, rooms = {};
    const app = $('#app');
    app.innerHTML = '<div class="lib"><div class="lib-head"><div><h1>Library check-in</h1><p class="muted" style="max-width:60ch;margin:.3em 0 0">Tap a room the moment its runners arrive. If their chain isn\'t right, tap the room again to undo, then send them back. Their clock keeps counting as if it never stopped.</p></div>' +
      '<div class="clock-wrap"><div class="clock" data-clock>0:00</div><div class="clock-sub">Mission clock</div></div></div>' +
      '<div class="lib-grid" data-grid></div><p class="muted small" style="margin-top:1.5rem">Backup: if this screen stops working, write down each room and the clock time on the paper log.</p></div>';
    const grid = $('[data-grid]');
    let lastSig = '';
    function draw() {
      const now = DB.now(), started = isStarted(game, now);
      const sig = JSON.stringify(Object.fromEntries(Object.entries(rooms).map(([k, r]) => [k, r && r.finish]))) + started;
      if (sig === lastSig) return; lastSig = sig;
      grid.innerHTML = sortedRooms().map(h => {
        const r = rooms[h.room], t = teamById[h.team];
        const done = r && r.finish;
        return '<button class="lib-btn ' + (done ? 'done' : '') + '" style="--tc:' + t.color + '" data-room="' + esc(h.room) + '"' + (!started && !done ? ' aria-disabled="true"' : '') + '>' +
          '<span class="rm">' + esc(h.room) + '</span><span class="tn">' + esc(h.teacher) + '</span><span class="muted small">' + esc(t.name) + '</span>' +
          '<span class="act">' + (done ? 'Checked in at ' + fmt(done.elapsed) + '. Tap to undo.' : (started ? 'Tap when runners arrive' : 'Waiting for start')) + '</span></button>';
      }).join('');
    }
    grid.addEventListener('click', async e => {
      const b = e.target.closest('[data-room]'); if (!b) return;
      const id = b.dataset.room, r = rooms[id];
      const now = DB.now();
      if (r && r.finish) {
        if (await confirmBox({ title: 'Undo check-in for ' + roomName(id) + '?', text: 'Their clock will pick back up as if it never stopped.', ok: 'Undo check-in', danger: true })) {
          DB.remove('rooms/' + id + '/finish');
          log('Library undid check-in for ' + roomName(id), id);
        }
        return;
      }
      if (!isStarted(game, now)) return;
      const el = gameElapsed(game, now);
      if (await confirmBox({ title: 'Stop the clock for ' + roomName(id) + '?', text: 'Their time will be recorded as <strong>' + fmt(el) + '</strong> plus any hint penalties.', ok: 'Stop their clock' })) {
        DB.set('rooms/' + id + '/finish', { elapsed: el, by: 'library', at: now });
        log('Library checked in ' + roomName(id) + ' at ' + fmt(el), id);
      }
    });
    DB.on('game', v => { game = v; lastSig = ''; draw(); });
    DB.on('rooms', v => { rooms = v || {}; draw(); });
    setInterval(() => {
      draw();
      const c = $('[data-clock]'); if (c) c.textContent = fmt(isStarted(game, DB.now()) ? Math.min(CAP, gameElapsed(game, DB.now())) : 0);
    }, 500);
  }

  /* =====================================================================
     CONTROL PANEL
     ===================================================================== */
  function controlApp() {
    let game = null, rooms = {}, logs = {}, connected = true;
    const app = $('#app');
    app.innerHTML = '<div class="ctl"><div class="ctl-head"><div><h1>' + esc(G.title) + ': control</h1><div class="muted" data-gstatus></div></div>' +
      '<div class="clock-wrap"><div class="clock" data-clock>0:00</div><div class="clock-sub">Mission clock</div></div>' +
      '<div class="ctl-actions" data-actions></div></div>' +
      '<div class="stats" data-stats></div><div class="ctl-grid"><div data-teams></div><div class="log"><h2>Activity</h2><div data-log></div></div></div></div>';

    function draw() {
      const now = DB.now();
      const status = !game || !game.startAt ? 'lobby' : (now < game.startAt ? 'countdown' : game.status);
      $('[data-gstatus]').textContent = {
        lobby: 'Waiting to start. Teachers are checking in.', countdown: 'Countdown running on every screen.',
        running: 'Game running.', paused: 'Paused on every screen.'
      }[status] + (DB.mode === 'demo' ? ' (Demo mode)' : (connected ? '' : ' Reconnecting to the server…'));

      $('[data-actions]').innerHTML =
        (status === 'lobby' ? '<button class="btn primary big" data-a="start">Start all rooms</button>' : '') +
        (status === 'running' ? '<button class="btn big" data-a="pause">Pause all</button>' : '') +
        (status === 'paused' ? '<button class="btn primary big" data-a="resume">Resume all</button>' : '') +
        '<a class="btn" href="#builder">Game builder</a>' +
        '<a class="btn" href="?preview" target="_blank" rel="noopener">Preview</a>' +
        '<a class="btn" href="#board" target="_blank" rel="noopener">Open leaderboard</a>' +
        '<a class="btn" href="#library" target="_blank" rel="noopener">Library screen</a>' +
        '<button class="btn danger" data-a="reset">Reset game</button>';

      const list = G.homerooms;
      const checked = list.filter(h => rooms[h.room] && rooms[h.room].claim).length;
      const online = list.filter(h => isOnline(rooms[h.room], now)).length;
      const vidIssues = list.filter(h => { const c = rooms[h.room] && rooms[h.room].check; return c && (c.failed && c.failed.length || (!c.api && c.total > c.placeholders)); }).length;
      const done = list.filter(h => roomScore(rooms[h.room], game, now).done).length;
      $('[data-stats]').innerHTML =
        stat(checked + '/' + list.length, 'checked in') + stat(online + '/' + list.length, 'online now', online < checked) +
        stat(vidIssues, 'with video problems', vidIssues > 0) + stat(done + '/' + list.length, 'finished');

      $('[data-teams]').innerHTML = G.teams.map(t => '<section class="team-block" style="--tc:' + t.color + '"><h2>' + esc(t.name) + '</h2><div class="cards">' +
        list.filter(h => h.team === t.id).sort((a, b) => a.room - b.room).map(h => card(h, now)).join('') + '</div></section>').join('');

      const entries = Object.values(logs || {}).sort((a, b) => b.at - a.at).slice(0, 80);
      $('[data-log]').innerHTML = entries.length ? entries.map(l => '<div><time>' + new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + '</time>' + esc(l.text) + '</div>').join('') : '<p class="muted">Nothing yet.</p>';
    }
    const stat = (n, l, alert) => '<div class="stat' + (alert ? ' alert' : '') + '"><b>' + n + '</b>' + l + '</div>';
    const isOnline = (r, now) => !!(r && r.presence && now - (r.presence.lastSeen || 0) < ONLINE_MS);
    function card(h, now) {
      const r = rooms[h.room];
      const on = isOnline(r, now);
      const i = stepOf(r), st = STEPS[i];
      const sc = roomScore(r, game, now);
      const c = r && r.check;
      const started = isStarted(game, now);
      const stepAt = r && r.progress && r.progress.stepAt;
      const onStep = started && stepAt ? Math.max(0, now - Math.max(stepAt, game.startAt)) : 0;
      const stuck = started && !sc.done && onStep > 12 * 60000;
      const attempts = (r && r.progress && r.progress.attempts && r.progress.attempts[st.id]) || 0;
      const hintsUsed = Object.values((r && r.progress && r.progress.hints) || {}).reduce((a, b) => a + b, 0);
      const warns = [];
      if (c && c.failed && c.failed.length) warns.push('Videos failing: ' + esc(c.failed.join(', ')));
      if (c && !c.api && c.total > c.placeholders) warns.push('YouTube player didn\'t load');
      if (r && r.claim && !on) warns.push('Offline');
      return '<div class="card' + (stuck ? ' stuck' : '') + (r && r.claim && !on ? ' offline' : '') + '">' +
        '<div class="top"><span class="rm">' + esc(h.room) + '</span><span>' + esc(h.teacher) + '</span><span class="dot ' + (on ? '' : (r && r.claim ? 'off' : 'warn')) + '" title="' + (on ? 'Online' : 'Offline') + '"></span></div>' +
        (sc.done ? '<div class="done-line">' + (sc.finished ? 'Finished ' + fmt(sc.score) : 'Capped ' + fmt(CAP)) + '</div>'
          : '<div class="step">' + (r && r.claim ? esc(st.label) : '<span class="muted">Not checked in</span>') + '</div>') +
        '<div class="meta">' + (started && !sc.done && r && r.claim ? '<span>' + fmt(onStep) + ' on this step</span>' : '') +
        (hintsUsed ? '<span>' + hintsUsed + ' hint' + (hintsUsed > 1 ? 's' : '') + ' (+' + fmt(sc.pen) + ')</span>' : '') +
        (sc.cred ? '<span>Credit −' + fmt(sc.cred) + '</span>' : '') +
        (attempts && !sc.done ? '<span>' + attempts + ' wrong code' + (attempts > 1 ? 's' : '') + '</span>' : '') + '</div>' +
        (warns.length ? '<div class="warnline">' + warns.join('<br>') + '</div>' : '') +
        '<div><button class="btn sm" data-manage="' + esc(h.room) + '">Manage</button></div></div>';
    }

    app.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]');
      if (a) {
        const now = DB.now();
        if (a.dataset.a === 'start') {
          if (!await confirmBox({ title: 'Start all rooms?', text: 'Every checked-in screen shows a ' + G.startCountdownSeconds + '-second countdown, then the clock starts.', ok: 'Start the countdown' })) return;
          DB.update('game', { status: 'running', startAt: DB.now() + G.startCountdownSeconds * 1000, pausedTotal: 0, pausedAt: null, runId: (game && game.runId) || newId() });
          log('Game started');
        } else if (a.dataset.a === 'pause') {
          DB.update('game', { status: 'paused', pausedAt: now }); log('Game paused');
        } else if (a.dataset.a === 'resume') {
          DB.update('game', { status: 'running', pausedTotal: (game.pausedTotal || 0) + (now - game.pausedAt), pausedAt: null }); log('Game resumed');
        } else if (a.dataset.a === 'reset') {
          const v = await promptBox({ title: 'Reset the whole game?', text: 'This clears every room\'s progress, times, hints and the activity log. Check-ins are kept. Type RESET to confirm.', fields: [{ label: 'Confirm', placeholder: 'RESET' }], ok: 'Reset game' });
          if (!v || v[0].toUpperCase() !== 'RESET') return;
          const upd = { game: { status: 'lobby', runId: newId() }, log: null };
          G.homerooms.forEach(h => { const p = 'rooms/' + h.room + '/'; upd[p + 'progress'] = null; upd[p + 'finish'] = null; upd[p + 'credits'] = null; });
          DB.update('', upd);
          log('Game reset');
        }
        return;
      }
      const m = e.target.closest('[data-manage]');
      if (m) manage(m.dataset.manage);
    });

    function manage(id) {
      const r = rooms[id] || {};
      const i = stepOf(r);
      const opts = STEPS.slice(0, LAST_PLAYABLE + 1).map((s, n) => '<option value="' + n + '"' + (n === i ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('');
      openModal('<h2>' + esc(roomName(id)) + '</h2>' +
        '<p class="muted">Now on: <strong style="color:var(--frost)">' + esc(STEPS[i].label) + '</strong>' + (r.finish ? '. Finished at ' + fmt(r.finish.elapsed) + ' (' + esc(r.finish.by) + ')' : '') + '</p>' +
        '<div class="action-list">' +
        (i < LAST_PLAYABLE ? '<button class="btn" data-m="next">Advance to the next step (' + esc(STEPS[i + 1].label) + ')</button>' : '') +
        (i > 0 ? '<button class="btn" data-m="back">Go back one step</button>' : '') +
        '<div style="display:flex;gap:.6rem"><select data-jumpto>' + opts + '</select><button class="btn" data-m="jump">Jump</button></div>' +
        '<button class="btn" data-m="credit">Give a time credit (tech problem)</button>' +
        (r.finish ? '<button class="btn danger" data-m="unfinish">Clear finish time</button>' : '<button class="btn" data-m="finish">Record finish time by hand (from paper log)</button>') +
        (r.claim ? '<button class="btn danger" data-m="release">Release this room from its computer</button>' : '') +
        '</div><div class="row"><button class="btn primary" data-x>Done</button></div>', {
        onOpen(w, close) {
          $('[data-x]', w).onclick = close;
          w.addEventListener('click', async e => {
            const b = e.target.closest('[data-m]'); if (!b) return;
            const act = b.dataset.m;
            const setStep = (n, why) => {
              DB.update('rooms/' + id + '/progress', { step: n, stepAt: DB.now(), at: DB.now() });
              log('Control moved ' + roomName(id) + ' to ' + STEPS[n].label + (why ? ' (' + why + ')' : ''), id);
              close();
            };
            if (act === 'next') setStep(i + 1, 'advanced');
            if (act === 'back') setStep(i - 1, 'back one step');
            if (act === 'jump') setStep(Number($('[data-jumpto]', w).value), 'jump');
            if (act === 'credit') {
              close();
              const v = await promptBox({ title: 'Time credit for ' + roomName(id), text: 'Minutes to subtract from their final time.', fields: [
                { label: 'Minutes', placeholder: '2', validate: x => (isNaN(Number(x)) || Number(x) <= 0) ? 'Enter a number of minutes, like 2 or 1.5.' : '' },
                { label: 'Reason', placeholder: 'Video 3 wouldn\'t play' }] , ok: 'Give credit' });
              if (!v) return;
              DB.push('rooms/' + id + '/credits', { ms: Math.round(Number(v[0]) * 60000), reason: v[1] || '', at: DB.now() });
              log('Control gave ' + roomName(id) + ' a ' + v[0] + '-minute credit' + (v[1] ? ': ' + v[1] : ''), id);
            }
            if (act === 'finish') {
              close();
              const v = await promptBox({ title: 'Record finish for ' + roomName(id), text: 'Enter the mission clock time from the library\'s paper log, as minutes:seconds.', fields: [
                { label: 'Mission clock time', placeholder: '48:30', validate: x => parseTime(x) == null ? 'Use minutes:seconds, like 48:30.' : '' }], ok: 'Record finish' });
              if (!v) return;
              DB.set('rooms/' + id + '/finish', { elapsed: parseTime(v[0]), by: 'control', at: DB.now() });
              log('Control recorded ' + roomName(id) + ' finishing at ' + fmt(parseTime(v[0])), id);
            }
            if (act === 'unfinish') {
              close();
              if (await confirmBox({ title: 'Clear the finish time?', text: 'Their clock resumes as if it never stopped.', ok: 'Clear finish', danger: true })) {
                DB.remove('rooms/' + id + '/finish'); log('Control cleared the finish for ' + roomName(id), id);
              }
            }
            if (act === 'release') {
              close();
              if (await confirmBox({ title: 'Release ' + roomName(id) + '?', text: 'The computer showing this room returns to check-in. Progress is kept.', ok: 'Release room', danger: true })) {
                DB.update('rooms/' + id, { claim: null, presence: null }); log('Control released ' + roomName(id), id);
              }
            }
          });
        }
      });
    }

    let drawQueued = false;
    const queue = () => { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; draw(); }); } };
    DB.on('game', v => { game = v; queue(); });
    DB.on('rooms', v => { rooms = v || {}; queue(); });
    DB.on('log', v => { logs = v || {}; queue(); });
    DB.onConnection(c => { connected = c; queue(); });
    setInterval(() => {
      const c = $('[data-clock]'), now = DB.now();
      if (c) c.textContent = (game && game.startAt && now < game.startAt) ? '−' + Math.ceil((game.startAt - now) / 1000) + 's' : fmt(isStarted(game, now) ? Math.min(CAP, gameElapsed(game, now)) : 0);
    }, 250);
    setInterval(queue, 5000); // refresh "time on step" and online dots
  }

  /* =====================================================================
     GAME BUILDER  (#builder)
     ===================================================================== */
  function builderApp() {
    const app = $('#app');
    const clone = v => JSON.parse(JSON.stringify(v));
    const settingsOf = g => ({ title: g.title, pins: Object.assign({}, g.pins), capMinutes: g.capMinutes, defaultHintPenaltyMinutes: g.defaultHintPenaltyMinutes, startCountdownSeconds: g.startCountdownSeconds });
    let draft = { settings: settingsOf(G), steps: clone(G.steps) };
    let sel = 0, tab = 'steps', saveTimer = null, saveState = 'idle', previewSrc = '';
    const isLocked = st => st.type === 'final' || st.finale;
    const finalIdx = () => draft.steps.findIndex(s => s.type === 'final');

    // canonical form for "does the backup file match?"
    function canon(v) {
      if (Array.isArray(v)) { const a = v.map(canon).filter(x => x !== undefined); return a.length ? a : undefined; }
      if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { const c = canon(v[k]); if (c !== undefined) o[k] = c; }); return Object.keys(o).length ? o : undefined; }
      if (v === '' || v == null) return undefined;
      return typeof v === 'number' ? String(v) : v;
    }
    const baseDraft = () => ({ settings: settingsOf(BASE), steps: clone(BASE.steps) });
    const matchesFile = () => JSON.stringify(canon(draft)) === JSON.stringify(canon(baseDraft()));

    function save() {
      saveState = 'pending'; drawStatus();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const payload = JSON.parse(JSON.stringify({ settings: draft.settings, steps: draft.steps, updatedAt: CDB.now() }));
        const p = CDB.set('content', payload);
        saveState = 'saving'; drawStatus();
        Promise.resolve(p).then(() => { saveState = 'saved'; drawStatus(); }).catch(() => { saveState = 'error'; drawStatus(); });
      }, 600);
    }
    function drawStatus() {
      const el = $('[data-status]'); if (!el) return;
      const txt = { idle: 'All changes saved', pending: 'Saving…', saving: 'Saving…', saved: 'All changes saved', error: 'Couldn\'t save. Check the connection.' }[saveState];
      el.innerHTML = '<span class="dot ' + (saveState === 'error' ? 'off' : (saveState === 'saved' || saveState === 'idle' ? '' : 'warn')) + '"></span>' + esc(txt) +
        (DB.mode === 'demo' ? '<span class="muted"> (demo: this browser only)</span>' : '') +
        '<span class="bld-file">' + (matchesFile() ? 'Backup content.js matches' : '<button class="btn ghost sm" data-export>Backup content.js is out of date. Download a new one</button>') + '</span>';
      const ex = $('[data-export]', el); if (ex) ex.onclick = exportFile;
    }
    window.addEventListener('beforeunload', e => { if (saveState === 'pending' || saveState === 'saving') { e.preventDefault(); e.returnValue = ''; } });

    function exportFile() {
      const g = Object.assign({}, BASE, draft.settings, { pins: draft.settings.pins, steps: draft.steps });
      delete g.homerooms; delete g.teams;
      const g2 = Object.assign({ title: g.title, pins: g.pins, capMinutes: Number(g.capMinutes), defaultHintPenaltyMinutes: Number(g.defaultHintPenaltyMinutes), startCountdownSeconds: Number(g.startCountdownSeconds), teams: BASE.teams, homerooms: BASE.homerooms, steps: draft.steps });
      const txt = '/* Operation: Falcon Frost game content.\n   Exported from the game builder on ' + new Date().toLocaleString() + '.\n   Upload this file to GitHub to replace content.js. It is the backup the game\n   uses if a computer can\'t load your latest edits from Firebase. */\n\nwindow.GAME = ' + JSON.stringify(g2, null, 2) + ';\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([txt], { type: 'text/javascript' }));
      a.download = 'content.js'; document.body.appendChild(a); a.click(); a.remove();
    }

    /* ---- shell ---- */
    app.innerHTML = '<div class="bld"><header class="bld-head"><div><h1>Game builder</h1><div class="bld-status" data-status></div></div>' +
      '<nav class="bld-tabs" role="tablist">' + [['steps', 'Steps'], ['sheet', 'Run sheet'], ['settings', 'Settings']].map(([k, l]) => '<button class="btn" role="tab" data-tab="' + k + '">' + l + '</button>').join('') + '</nav>' +
      '<div class="bld-links"><a class="btn primary" href="?preview" target="_blank" rel="noopener">Play the full preview</a><a class="btn" href="#control">Control panel</a></div></header>' +
      '<div data-body></div></div>';
    $$('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; drawTab(); });
    drawStatus();
    drawTab();

    function drawTab() {
      $$('[data-tab]').forEach(b => { b.classList.toggle('primary', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
      if (tab === 'steps') drawSteps();
      else if (tab === 'sheet') drawSheet();
      else drawSettings();
    }

    /* ---- steps tab ---- */
    function drawSteps() {
      previewSrc = '';
      $('[data-body]').innerHTML = '<div class="bld-steps"><aside class="bld-list"><ol data-list></ol>' +
        '<div class="bld-add"><button class="btn sm" data-add="video">Add video</button><button class="btn sm" data-add="mission">Add mission</button></div>' +
        '<p class="muted small">New steps go right after the selected one.</p></aside>' +
        '<section class="bld-editor" data-editor></section>' +
        '<section class="bld-preview"><div class="pv-frame" data-frame><iframe title="Step preview" data-iframe></iframe></div>' +
        '<p class="muted small">This is how the selected step looks on the classroom TV. Your edits appear here within a second or two. Codewords and hints work in here too.</p></section></div>';
      $$('[data-add]').forEach(b => b.onclick = () => addStep(b.dataset.add));
      const frame = $('[data-frame]'), ifr = $('[data-iframe]');
      const fit = () => { const w = frame.clientWidth; ifr.style.transform = 'scale(' + (w / 1600) + ')'; frame.style.height = (900 * w / 1600) + 'px'; };
      if ('ResizeObserver' in window) new ResizeObserver(fit).observe(frame); fit();
      drawList(); drawEditor(); updatePreview();
    }
    function updatePreview() {
      const ifr = $('[data-iframe]'); if (!ifr) return;
      const src = location.pathname + '?preview&embed&step=' + sel;
      if (src !== previewSrc) { previewSrc = src; ifr.src = src; }
    }
    function stepMeta(st) {
      if (st.type === 'video') return st.youtubeId ? 'Video added' : '<span class="warn-txt">No video yet</span>';
      if (st.type === 'final') return 'Ends at library check-in';
      const a = (st.code && st.code.answers) || [];
      const h = (st.hints || []).filter(x => x && x.text).length;
      return (a.length ? 'Code: ' + esc(a[0]) : '<span class="warn-txt">No codeword</span>') + (h ? ', ' + h + ' hint' + (h > 1 ? 's' : '') : '');
    }
    function drawList() {
      $('[data-list]').innerHTML = draft.steps.map((st, i) =>
        '<li><button class="bld-item' + (i === sel ? ' on' : '') + (st.type === 'video' ? ' vid' : '') + '" data-sel="' + i + '">' +
        '<span class="bld-kind">' + (st.type === 'video' ? 'Video' : 'Mission') + '</span>' +
        '<span class="bld-name">' + esc(st.label || st.title || 'Untitled') + '</span><span class="bld-meta">' + stepMeta(st) + '</span></button></li>').join('');
      $$('[data-sel]').forEach(b => b.onclick = () => { sel = Number(b.dataset.sel); drawList(); drawEditor(); updatePreview(); });
    }
    function addStep(kind) {
      const fi = finalIdx();
      let at = sel + 1;
      if (fi >= 0 && at > fi) at = fi;
      const id = 's' + newId();
      const st = kind === 'video'
        ? { id, type: 'video', label: 'New video', title: 'New video', youtubeId: '', recap: '' }
        : { id, type: 'mission', label: 'New mission', title: 'New mission', body: '<p>Write the instructions here.</p>', code: { answers: [] }, hints: [] };
      draft.steps.splice(at, 0, st);
      sel = at; save(); drawList(); drawEditor(); updatePreview();
    }
    function moveStep(d) {
      const j = sel + d, fi = finalIdx();
      if (j < 0 || j >= draft.steps.length || isLocked(draft.steps[sel]) || (fi >= 0 && j >= fi)) return;
      const [x] = draft.steps.splice(sel, 1); draft.steps.splice(j, 0, x);
      sel = j; save(); drawList(); drawEditor(); updatePreview();
    }
    async function deleteStep() {
      const st = draft.steps[sel];
      if (isLocked(st)) return;
      if (!await confirmBox({ title: 'Delete "' + (st.label || st.title) + '"?', text: 'This removes the step from the game for everyone.', ok: 'Delete step', danger: true })) return;
      draft.steps.splice(sel, 1);
      sel = Math.max(0, sel - 1); save(); drawList(); drawEditor(); updatePreview();
    }

    function field(label, key, value, opts = {}) {
      const id = 'f-' + key;
      return '<div class="bld-field"><label for="' + id + '">' + esc(label) + '</label>' +
        (opts.area ? '<textarea id="' + id + '" data-f="' + key + '" rows="' + (opts.rows || 3) + '" placeholder="' + esc(opts.ph || '') + '">' + esc(value || '') + '</textarea>'
          : '<input id="' + id + '" type="text" data-f="' + key + '" value="' + esc(value || '') + '" placeholder="' + esc(opts.ph || '') + '">') +
        (opts.help ? '<p class="help">' + opts.help + '</p>' : '') + '</div>';
    }
    function ytId(v) {
      v = (v || '').trim();
      const m = v.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
      return /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
    }

    function drawEditor() {
      const st = draft.steps[sel], ed = $('[data-editor]');
      if (!st) { ed.innerHTML = ''; return; }
      const fi = finalIdx();
      const canUp = !isLocked(st) && sel > 0, canDown = !isLocked(st) && sel < (fi >= 0 ? fi - 1 : draft.steps.length - 1);
      let h = '<div class="bld-ed-head"><h2>' + esc(st.label || 'Untitled') + '</h2><div class="bld-ed-btns">' +
        '<button class="btn sm" data-mv="-1"' + (canUp ? '' : ' disabled') + '>Move up</button>' +
        '<button class="btn sm" data-mv="1"' + (canDown ? '' : ' disabled') + '>Move down</button>' +
        (isLocked(st) ? '' : '<button class="btn sm danger" data-del>Delete</button>') + '</div></div>';
      if (st.type === 'final') h += '<p class="note">This is the last mission. It has no codeword: the room\'s clock stops when the library checks them in. It always stays just before the final video.</p>';
      if (st.finale) h += '<p class="note">This video unlocks after the library check-in, or when time runs out. It always stays last.</p>';
      h += field('Name in the control panel and run sheet', 'label', st.label, { help: 'Short, for you. Teachers don\'t see this.' });
      h += field('Title on the TV', 'title', st.title);
      if (st.type === 'video') {
        h += field('YouTube link', 'youtube', st.youtubeId ? 'https://www.youtube.com/watch?v=' + st.youtubeId : '', { ph: 'Paste the video link', help: 'Upload as Unlisted with "Allow embedding" on.' });
        h += '<div data-yt></div>';
        h += field('Recap', 'recap', st.recap, { area: true, rows: 4, help: 'Shown if the video won\'t play or hasn\'t been added. Include anything students must know.' });
      } else {
        h += '<div class="bld-field"><label>Instructions</label><div class="rte-bar">' +
          '<button class="btn sm" data-cmd="bold" title="Bold"><strong>B</strong></button>' +
          '<button class="btn sm" data-cmd="insertOrderedList">Numbered list</button>' +
          '<button class="btn sm" data-cmd="insertUnorderedList">Bullets</button>' +
          '<button class="btn sm" data-cmd="callout">Highlight box</button>' +
          '<button class="btn sm" data-cmd="normal">Plain text</button></div>' +
          '<div class="rte mission-body" contenteditable="true" data-rte>' + (st.body || '') + '</div>' +
          '<p class="help">Pasted text comes in plain. Use the buttons to format it.</p></div>';
        if (st.type === 'mission') {
          h += '<div class="bld-section"><h3>Codeword</h3>' +
            field('Accepted answers, one per line', 'answers', ((st.code && st.code.answers) || []).join('\n'), { area: true, rows: 3, help: 'Capitalization, spaces and punctuation don\'t matter. Add a line for any other spelling you\'ll accept.' }) +
            field('Sentence starter (optional)', 'prefix', st.code && st.code.prefix, { ph: 'e.g. Professor Frost is', help: 'Shown above the codeword box. Teachers can type just the answer or the whole sentence.' }) +
            '<div class="bld-field"><label for="f-test">Test a codeword</label><input id="f-test" type="text" data-test placeholder="Type what a teacher might enter"><p class="help" data-testres></p></div></div>';
        }
        h += '<div class="bld-section"><h3>Hints</h3><p class="help">Hints unlock in order. Leave minutes blank to use the default (' + esc(draft.settings.defaultHintPenaltyMinutes) + ' min).</p><div data-hints></div><button class="btn sm" data-addhint>Add a hint</button></div>';
      }
      ed.innerHTML = h;

      $$('[data-mv]', ed).forEach(b => b.onclick = () => moveStep(Number(b.dataset.mv)));
      const del = $('[data-del]', ed); if (del) del.onclick = deleteStep;
      $$('[data-f]', ed).forEach(inp => inp.addEventListener('input', () => onField(st, inp)));
      if (st.type === 'video') drawYT(st);
      const rte = $('[data-rte]', ed);
      if (rte) setupRTE(rte, st);
      const test = $('[data-test]', ed);
      if (test) test.addEventListener('input', () => drawTest(st));
      if (st.type !== 'video') { drawHints(st); $('[data-addhint]', ed).onclick = () => { st.hints = st.hints || []; st.hints.push({ text: '' }); save(); drawHints(st); drawList(); const t = $$('[data-hint-text]', ed).pop(); if (t) t.focus(); }; }
    }
    function onField(st, inp) {
      const k = inp.dataset.f, v = inp.value;
      if (k === 'label') { st.label = v; $('.bld-ed-head h2').textContent = v || 'Untitled'; }
      else if (k === 'title') st.title = v;
      else if (k === 'recap') st.recap = v;
      else if (k === 'youtube') { const id = ytId(v); if (!v.trim()) st.youtubeId = ''; else if (id) st.youtubeId = id; drawYT(st, v.trim() && !id); }
      else if (k === 'answers') { st.code = st.code || {}; st.code.answers = v.split('\n').map(x => x.trim()).filter(Boolean); drawTest(st); }
      else if (k === 'prefix') { st.code = st.code || {}; st.code.prefix = v.trim(); drawTest(st); }
      save(); drawList();
    }
    function drawYT(st, bad) {
      const el = $('[data-yt]'); if (!el) return;
      el.innerHTML = bad ? '<p class="help warn-txt">That doesn\'t look like a YouTube link. Copy the address from the video page or the Share button.</p>'
        : st.youtubeId ? '<div class="yt-thumb"><img alt="" src="https://i.ytimg.com/vi/' + encodeURIComponent(st.youtubeId) + '/mqdefault.jpg"><span class="help">Video ID ' + esc(st.youtubeId) + '</span></div>'
        : '<p class="help">No video yet. The recap will show in its place.</p>';
    }
    function drawTest(st) {
      const t = $('[data-test]'), r = $('[data-testres]'); if (!t || !r) return;
      if (!t.value.trim()) { r.textContent = ''; return; }
      const ok = codeMatches(st, t.value);
      r.innerHTML = ok ? '<span style="color:var(--ok)">Accepted. This would unlock the next step.</span>' : '<span class="warn-txt">Not accepted.</span>';
    }
    function drawHints(st) {
      const el = $('[data-hints]'); if (!el) return;
      const hs = st.hints || [];
      el.innerHTML = hs.length ? hs.map((hn, n) => '<div class="hint-ed"><div class="hint-ed-top"><strong>Hint ' + (n + 1) + '</strong>' +
        '<label class="mins">Minutes <input type="number" min="0" step="0.5" data-hint-min="' + n + '" value="' + (hn.penaltyMinutes != null ? esc(hn.penaltyMinutes) : '') + '" placeholder="' + esc(draft.settings.defaultHintPenaltyMinutes) + '"></label>' +
        '<button class="btn sm" data-hmv="' + n + ':-1"' + (n ? '' : ' disabled') + '>Up</button><button class="btn sm" data-hmv="' + n + ':1"' + (n < hs.length - 1 ? '' : ' disabled') + '>Down</button><button class="btn sm danger" data-hdel="' + n + '">Remove</button></div>' +
        '<textarea rows="2" data-hint-text="' + n + '" placeholder="What the hint says">' + esc(hn.text || '') + '</textarea></div>').join('')
        : '<p class="muted small">No hints yet.</p>';
      $$('[data-hint-text]', el).forEach(t => t.addEventListener('input', () => { hs[Number(t.dataset.hintText)].text = t.value; save(); drawList(); }));
      $$('[data-hint-min]', el).forEach(t => t.addEventListener('input', () => { const h = hs[Number(t.dataset.hintMin)]; if (t.value === '') delete h.penaltyMinutes; else if (!isNaN(Number(t.value))) h.penaltyMinutes = Number(t.value); save(); }));
      $$('[data-hmv]', el).forEach(b => b.onclick = () => { const [n, d] = b.dataset.hmv.split(':').map(Number); const [x] = hs.splice(n, 1); hs.splice(n + d, 0, x); save(); drawHints(st); });
      $$('[data-hdel]', el).forEach(b => b.onclick = () => { hs.splice(Number(b.dataset.hdel), 1); save(); drawHints(st); drawList(); });
    }

    /* ---- simple rich text editor ---- */
    function sanitize(html) {
      const src = document.createElement('div'); src.innerHTML = html;
      const out = document.createElement('div');
      const map = { b: 'strong', i: 'em', div: 'p', h1: 'p', h2: 'p', h3: 'p', h4: 'p' };
      const allowed = ['p', 'ol', 'ul', 'li', 'strong', 'em', 'br'];
      (function walk(node, parent) {
        Array.from(node.childNodes).forEach(ch => {
          if (ch.nodeType === 3) { parent.appendChild(document.createTextNode(ch.textContent)); return; }
          if (ch.nodeType !== 1) return;
          let tag = ch.tagName.toLowerCase(); tag = map[tag] || tag;
          if (allowed.includes(tag)) {
            if (tag === 'p' && parent.tagName === 'P') { walk(ch, parent); return; }
            const el = document.createElement(tag);
            if (tag === 'p' && ch.classList.contains('callout')) el.className = 'callout';
            parent.appendChild(el); walk(ch, el);
          } else walk(ch, parent);
        });
      })(src, out);
      // wrap loose inline content at the top level in paragraphs
      const final = document.createElement('div'); let cur = null;
      Array.from(out.childNodes).forEach(n => {
        const block = n.nodeType === 1 && ['P', 'OL', 'UL'].includes(n.tagName);
        if (block) { cur = null; final.appendChild(n); }
        else { if (n.nodeType === 3 && !n.textContent.trim() && !cur) return; if (!cur) { cur = document.createElement('p'); final.appendChild(cur); } cur.appendChild(n); }
      });
      $$('p', final).forEach(p => { if (!p.textContent.trim()) p.remove(); });
      return final.innerHTML;
    }
    function setupRTE(rte, st) {
      try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { }
      const sync = () => { st.body = sanitize(rte.innerHTML); save(); };
      rte.addEventListener('input', sync);
      rte.addEventListener('blur', () => { const clean = sanitize(rte.innerHTML); if (clean !== rte.innerHTML) rte.innerHTML = clean; });
      rte.addEventListener('paste', e => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length <= 1) document.execCommand('insertText', false, text.trim());
        else document.execCommand('insertHTML', false, lines.map(l => '<p>' + esc(l.trim()) + '</p>').join(''));
      });
      $$('[data-cmd]').forEach(b => {
        b.addEventListener('mousedown', e => e.preventDefault()); // keep the text selection
        b.onclick = () => {
          rte.focus();
          const c = b.dataset.cmd;
          if (c === 'callout' || c === 'normal') {
            document.execCommand('formatBlock', false, 'p');
            const s2 = window.getSelection(); let n = s2 && s2.anchorNode;
            if (n && n.nodeType === 3) n = n.parentElement;
            const blk = n && n.closest ? n.closest('p') : null;
            if (blk && rte.contains(blk)) { if (c === 'callout') blk.classList.toggle('callout'); else blk.classList.remove('callout'); }
          } else document.execCommand(c, false, null);
          sync();
        };
      });
    }

    /* ---- run sheet tab ---- */
    function drawSheet() {
      const issues = [];
      draft.steps.forEach(st => {
        if (st.type === 'mission' && !((st.code && st.code.answers) || []).length) issues.push(esc(st.label) + ' has no codeword, so rooms can\'t get past it.');
        if (st.type === 'video' && !st.youtubeId) issues.push(esc(st.label) + ' has no video yet (the recap will show instead).');
      });
      const rows = draft.steps.map((st, i) => {
        const hs = (st.hints || []).filter(h => h && h.text);
        const hintTxt = st.type === 'video' ? '' : (hs.length ? hs.map((h, n) => (n + 1) + '. ' + esc(h.text) + ' <span class="muted">(+' + esc(h.penaltyMinutes != null ? h.penaltyMinutes : draft.settings.defaultHintPenaltyMinutes) + ' min)</span>').join('<br>') : '<span class="muted">None</span>');
        const code = st.type === 'mission' ? (((st.code && st.code.answers) || []).length ? (st.code.prefix ? '<span class="muted">' + esc(st.code.prefix) + '…</span> ' : '') + '<strong>' + esc(st.code.answers[0]) + '</strong>' + (st.code.answers.length > 1 ? '<br><span class="muted">also: ' + esc(st.code.answers.slice(1).join(', ')) + '</span>' : '') : '<span class="warn-txt">Missing</span>')
          : st.type === 'final' ? 'Library check-in' : '';
        const what = st.type === 'video' ? (st.youtubeId ? 'Video' : 'Video <span class="warn-txt">(not added)</span>') : 'Mission';
        return '<tr><td>' + (i + 1) + '</td><td>' + what + '</td><td><strong>' + esc(st.label) + '</strong><br><span class="muted">' + esc(st.title) + '</span></td><td>' + code + '</td><td>' + hintTxt + '</td></tr>';
      }).join('');
      $('[data-body]').innerHTML = '<div class="bld-sheet"><div class="bld-sheet-head"><div><h2>Run sheet</h2><p class="muted">Every step in order with its codeword and hints. Print it for yourself and the ASB helpers. Keep it away from students.</p></div><button class="btn primary" data-print>Print</button></div>' +
        (issues.length ? '<div class="issues"><strong>Before game day</strong><ul>' + issues.map(x => '<li>' + x + '</li>').join('') + '</ul></div>' : '<div class="issues ok">Every mission has a codeword and every video is added.</div>') +
        '<div style="overflow-x:auto"><table class="sheet"><thead><tr><th>#</th><th>Type</th><th>Step</th><th>Codeword</th><th>Hints</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="muted small">Scoring: final time is the mission clock at library check-in plus hint penalties. Anything over ' + esc(draft.settings.capMinutes) + ':00 counts as ' + esc(draft.settings.capMinutes) + ':00.</p></div>';
      $('[data-print]').onclick = () => window.print();
    }

    /* ---- settings tab ---- */
    function drawSettings() {
      const s = draft.settings;
      $('[data-body]').innerHTML = '<div class="bld-settings">' +
        '<section class="panel"><h2>PINs</h2><p class="muted">Each browser remembers a PIN after it\'s entered once. If you change one, those screens will ask for the new PIN.</p>' +
        sField('Teacher screens', 'pins.teacher', s.pins.teacher) + sField('Control panel, builder and preview', 'pins.control', s.pins.control) + sField('Library check-in', 'pins.library', s.pins.library) + '</section>' +
        '<section class="panel"><h2>Game rules</h2>' + sField('Game title', 'title', s.title) +
        sField('Time cap (minutes)', 'capMinutes', s.capMinutes, 'number') + sField('Default hint penalty (minutes)', 'defaultHintPenaltyMinutes', s.defaultHintPenaltyMinutes, 'number') +
        sField('Start countdown (seconds)', 'startCountdownSeconds', s.startCountdownSeconds, 'number') + '</section>' +
        '<section class="panel"><h2>Homerooms and Falcon teams</h2><p class="muted">These are set in content.js on GitHub. ' + G.homerooms.filter(h => h.room !== 'P').length + ' homerooms on ' + G.teams.length + ' teams.</p></section>' +
        '<section class="panel"><h2>Backup file</h2><p class="muted">Your edits are saved in Firebase. content.js on GitHub is the backup a computer uses if it can\'t load them. After your final edits, download a fresh copy and upload it to GitHub to replace the old one.</p>' +
        '<div class="row-btns"><button class="btn primary" data-export2>Download content.js</button><button class="btn danger" data-restore>Undo all edits (go back to content.js)</button></div></section></div>';
      $$('[data-s]').forEach(inp => inp.addEventListener('input', () => {
        const k = inp.dataset.s, v = inp.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value.trim();
        if (k.startsWith('pins.')) { if (!v) return; s.pins[k.slice(5)] = v; } else { if (v === '') return; s[k] = v; }
        save();
      }));
      $('[data-export2]').onclick = exportFile;
      $('[data-restore]').onclick = async () => {
        if (!await confirmBox({ title: 'Undo all edits?', text: 'Every step, codeword, hint and setting goes back to what\'s in content.js on GitHub. This can\'t be undone.', ok: 'Undo all edits', danger: true })) return;
        clearTimeout(saveTimer);
        CDB.remove('content');
        draft = baseDraft(); sel = 0; saveState = 'saved'; drawStatus(); drawTab();
      };
    }
    function sField(label, key, val, type) {
      return '<div class="bld-field"><label for="s-' + key + '">' + esc(label) + '</label><input id="s-' + key + '" type="' + (type || 'text') + '" data-s="' + key + '" value="' + esc(val) + '"' + (type === 'number' ? ' min="0" step="0.5"' : '') + '></div>';
    }
  }

  /* =====================================================================
     BOOT
     ===================================================================== */
  let DB, CDB;
  function fatal(title, msg) {
    $('#app').innerHTML = '<div class="center-screen"><div class="fatal stack"><h1>' + esc(title) + '</h1><p>' + msg + '</p><button class="btn primary big" onclick="location.reload()">Reload the page</button></div></div>';
  }
  if (!BASE || !Array.isArray(BASE.steps)) return fatal('Content didn\'t load', 'The file content.js is missing or has a typo. Check it and reload.');
  const hasConfig = !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL);
  if (hasConfig) {
    if (!window.firebase || !firebase.database) return fatal('Can\'t reach the game server', 'Firebase didn\'t load on this computer. Check the internet connection, then reload. If it keeps happening, the school web filter may be blocking gstatic.com or firebaseio.com.');
    try {
      CDB = makeFirebaseDB(CONTENT_ROOT);
      DB = PREVIEW ? makeLocalDB(ROOT) : makeFirebaseDB(ROOT);
    } catch (e) { console.error(e); return fatal('Can\'t start the game server', 'The Firebase settings in firebase-config.js look wrong.'); }
  } else { CDB = makeLocalDB(CONTENT_ROOT); DB = makeLocalDB(ROOT); }

  // Start from the last content this computer saw (or content.js), then sync.
  applyContent(buildGame(normalizeContent(store.get('ff-content-cache'))));
  $('#app').innerHTML = '<div class="center-screen"><p class="muted">Loading the mission files…</p></div>';
  new Promise(res => {
    let first = true;
    const t = setTimeout(() => { if (first) { first = false; res(); } }, 5000);
    CDB.on('content', v => {
      if (v) store.set('ff-content-cache', v); else store.del('ff-content-cache');
      const g = buildGame(normalizeContent(v));
      if (contentFrozen) pendingContent = g;
      else { applyContent(g); contentListeners.forEach(fn => fn()); }
      if (first) { first = false; clearTimeout(t); res(); }
    });
  }).then(() => {
    const route = location.hash.replace('#', '').toLowerCase();
    modeBanner();
    if (route === 'control') pinGate('ff-cpin', G.pins.control, 'Control panel', controlApp);
    else if (route === 'builder') pinGate('ff-cpin', G.pins.control, 'Game builder', builderApp);
    else if (route === 'library') pinGate('ff-lpin', G.pins.library, 'Library check-in', libraryApp);
    else if (route === 'board') boardApp();
    else if (PREVIEW) pinGate('ff-cpin', G.pins.control, 'Preview', teacherApp);
    else teacherApp();
  });
  window.addEventListener('hashchange', () => location.reload());
})();
