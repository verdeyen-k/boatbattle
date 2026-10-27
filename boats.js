// Boat Battle: 2 to 8 boats with cannons on one sea. Three hits and you sink. Crates on the water hold power-ups
// with a few special shots each. Last boat floating wins.
(() => {
  // ── The sea ──────────────────────────────────────────────────────────────
  const W = 800, CX = W / 2;
  const BOAT_R = 17, LIVES = 3, MAX_V = 130, TURN = 2.6, BOW = 27, CRATE_R = 14, INV = 1.1;
  const VIS = 1.25;  // boats are drawn a bit bigger than they are, so they're easy to see on a phone
  const COLORS = ['#ff6b6b', '#ff9f43', '#ffd43b', '#69db7c', '#4dabf7', '#b47cf0', '#ff8cc6', '#3bd1c4'];
  const COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Teal'];
  const MAX_PLAYERS = COLORS.length;
  // The plain cannon never runs out. Power-ups replace it until their shots are used up.
  const SHOTS = {
    ball:   { name: 'Cannon', icon: '⚫', reload: 0.55, speed: 360, range: 360, r: 5, dmg: 1 },
    double: { name: 'Double barrel', icon: '⛓️', shots: 5, reload: 0.7, speed: 340, range: 360, r: 5, dmg: 1, gap: 11 },
    spiky:  { name: 'Spiky', icon: '🦔', shots: 1, reload: 0.8, speed: 340, range: 420, r: 8, dmg: 2 },
    boom:   { name: 'Boom', icon: '💥', shots: 3, reload: 0.9, speed: 300, range: 340, r: 6, dmg: 1, blast: 80 },
  };
  const CRATE_KINDS = ['double', 'double', 'boom', 'boom', 'spiky'];  // spiky turns up half as often
  const CRATE_EVERY = 3.2;

  // A big island in the middle, four smaller ones around it, and four rocks to hide behind near the starts.
  const ISLANDS = [{ x: CX, y: CX, r: 54 }];
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; ISLANDS.push({ x: CX + Math.cos(a) * 205, y: CX + Math.sin(a) * 205, r: 34 }); }
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; ISLANDS.push({ x: CX + Math.cos(a) * 250, y: CX + Math.sin(a) * 250, r: 20 }); }

  // Boats start spread around a ring, facing the middle.
  function spawn(k, n) {
    const a = Math.PI / 4 + k * 2 * Math.PI / n;
    return { x: CX + Math.cos(a) * 330, y: CX + Math.sin(a) * 330, a: a + Math.PI };
  }

  const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // How far point p is from the segment a–b.
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  }
  // Is the straight line between two points clear of islands?
  const clearLine = (ax, ay, bx, by) => ISLANDS.every(i => segDist(i.x, i.y, ax, ay, bx, by) > i.r + 4);

  // ── Online rooms ─────────────────────────────────────────────────────────
  // Bump with the ?v= on the script in index.html whenever what goes in the room changes.
  const VERSION = 1;
  const OUTDATED = 'That room is using a different version of Boat Battle. Everyone needs to refresh the page.';
  const ROOMS = 'boatbattle/rooms';

  const db = window.firebase ? (firebase.initializeApp({
    apiKey:            'AIzaSyAsJboNGVuESMhkivllUD0o8MUB5LUCMRQ',
    authDomain:        'kvgames.firebaseapp.com',
    databaseURL:       'https://kvgames-default-rtdb.firebaseio.com',
    projectId:         'kvgames',
    storageBucket:     'kvgames.firebasestorage.app',
    messagingSenderId: '463308384695',
    appId:             '1:463308384695:web:5d57623ebd52101ad26032',
  }), firebase.database()) : null;
  let clockOffset = 0;  // server clock minus ours, so every device agrees when the battle starts and when shots were fired
  if (db) db.ref('.info/serverTimeOffset').on('value', s => { clockOffset = s.val() || 0; });
  const now = () => Date.now() + clockOffset;

  const $ = id => document.getElementById(id);
  const show = id => {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    if (id !== 'game') { $('over').hidden = true; $('count').hidden = true; }
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const swatch = slot => `<span class="sw" style="background:${COLORS[slot]}"></span>`;

  const myId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  // The room is split in two: meta (players, phase: changes rarely) and live (boats, shots and crates: changes all the time).
  // Each device moves its own boat and decides when its own boat gets hit. The host drops the crates.
  let room = null;  // { code, ref, meta, pos, crates, joining, listeners }

  const playerList = meta => Object.entries((meta && meta.players) || {}).filter(([, p]) => p && p.name)
    .map(([id, p]) => ({ id, ...p })).sort((a, b) => a.slot - b.slot);

  function genCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
  function busy(on) { for (const b of document.querySelectorAll('#menu button')) b.disabled = on; }
  function myName() {
    const name = $('name').value.trim().slice(0, 14);
    if (!name) { $('menu-error').textContent = 'Type your name first.'; $('name').focus(); return null; }
    store.set('boatbattle-name', name);
    return name;
  }
  const NO_SERVER = "Can't reach the game server. Check the internet connection.";

  async function createRoom(name) {
    if (!db) { $('menu-error').textContent = NO_SERVER; return; }
    busy(true);
    $('menu-error').textContent = '';
    try {
      let code, ref;
      for (let i = 0; i < 10; i++) {
        code = genCode();
        ref = db.ref(`${ROOMS}/${code}`);
        if (!(await ref.child('meta').get()).exists()) break;
      }
      await ref.set({ meta: { host: myId, v: VERSION, created: firebase.database.ServerValue.TIMESTAMP, phase: 'lobby',
        players: { [myId]: { name, slot: 0 } } } });
      ref.onDisconnect().remove();
      await enterRoom(code, ref);
    } catch (e) {
      $('menu-error').textContent = "Couldn't create a room. Check the internet connection.";
    }
    busy(false);
  }

  async function joinRoom(code, name) {
    if (!db) { $('menu-error').textContent = NO_SERVER; return; }
    busy(true);
    $('menu-error').textContent = '';
    const ref = db.ref(`${ROOMS}/${code}`);
    try {
      const meta = await enterRoom(code, ref, true);
      const problem = !meta || !meta.host ? `There's no room ${code}.` : meta.v !== VERSION ? OUTDATED
        : meta.phase !== 'lobby' ? 'That battle has already started. Wait for it to finish, then join.'
        : playerList(meta).length >= MAX_PLAYERS ? `That room is full (${MAX_PLAYERS} boats).` : null;
      if (problem) throw new Error(problem);
      // A transaction, so two people joining at once can't take the same color.
      const res = await ref.child('meta/players').transaction(cur => {
        if (!cur) return;
        const taken = new Set(Object.values(cur).filter(p => p && p.name).map(p => p.slot));
        const slot = COLORS.findIndex((_, i) => !taken.has(i));
        if (slot < 0) return;
        cur[myId] = { name, slot };
        return cur;
      });
      if (!res.committed) throw new Error(`That room is full (${MAX_PLAYERS} boats).`);
      ref.child(`meta/players/${myId}`).onDisconnect().remove();
      ref.child(`live/pos/${myId}`).onDisconnect().remove();
      room.joining = false;
      render();
    } catch (e) {
      leaveRoom();
      show('menu');
      $('menu-error').textContent = e.message && !/^FIREBASE|permission/i.test(e.message) ? e.message
        : "Couldn't join. Check the code and the internet connection.";
    }
    busy(false);
  }

  // Start listening to the room. Resolves with its first meta, so a join can check it before taking a seat.
  function enterRoom(code, ref, joining = false) {
    leaveRoom();
    room = { code, ref, meta: null, pos: {}, crates: {}, joining, listeners: [] };
    const r = room;
    const listen = (path, ev, fn) => { const q = ref.child(path); q.on(ev, fn); r.listeners.push([q, ev, fn]); };
    listen('live/pos', 'value', snap => { if (room === r) r.pos = snap.val() || {}; });
    listen('live/crates', 'value', snap => { if (room === r) { r.crates = snap.val() || {}; if (game && game.online) game.crates = r.crates; } });
    listen('live/shots', 'child_added', snap => { if (room === r) remoteShot(snap.key, snap.val()); });
    return new Promise(resolve => {
      listen('meta', 'value', snap => {
        if (room !== r) return;
        r.meta = snap.val();
        if (resolve) { const f = resolve; resolve = null; f(r.meta); if (joining) return; }
        if (!r.joining) render();
      });
    });
  }
  function leaveRoom() {
    const r = room;
    game = null;
    if (!r) return;
    room = null;
    for (const [q, ev, fn] of r.listeners) q.off(ev, fn);
    if (r.meta && r.meta.host === myId) { r.ref.onDisconnect().cancel(); r.ref.remove(); }
    else if (!r.joining) {
      for (const path of [`meta/players/${myId}`, `live/pos/${myId}`]) { const c = r.ref.child(path); c.onDisconnect().cancel(); c.remove(); }
    }
  }

  function startBattle() {
    const meta = room && room.meta;
    if (!meta || meta.host !== myId || playerList(meta).length < 2) return;
    room.ref.child('live').remove();
    room.ref.child('meta').update({ phase: 'play', order: playerList(meta).map(p => p.id), startAt: now() + 3600, winner: null });
  }
  function playAgain() {
    if (game && !game.online) { startPractice(); return; }
    if (!room || !room.meta || room.meta.host !== myId) return;
    room.ref.child('live').remove();
    room.ref.child('meta').update({ phase: 'lobby', order: null, startAt: null, winner: null });
  }

  // ── The battle ───────────────────────────────────────────────────────────
  // game: { online, startAt, boats: {id: boat}, order, balls, crates, fx, ... } — rebuilt for each battle.
  // A boat is "mine" to move and hurt if it's my own boat, or a computer boat in practice.
  let game = null;

  function newBoat(id, slot, name, k, n, local, bot) {
    const s = spawn(k, n);
    return { id, slot, name, local, bot, x: s.x, y: s.y, a: s.a, v: 0, lives: LIVES, kind: null, ammo: 0, cool: 0, inv: 0,
      sunkAt: 0, out: false, shown: { x: s.x, y: s.y, a: s.a }, think: 0, goal: null, wantFire: false, wake: 0 };
  }

  function newGame(online, startAt, list) {
    const boats = {};
    list.forEach((p, k) => { boats[p.id] = newBoat(p.id, p.slot, p.name, k, list.length, p.id === myId || !!p.bot, !!p.bot); });
    game = { online, startAt, boats, order: list.map(p => p.id), balls: [], crates: online ? (room.crates || {}) : {}, taking: new Set(),
      seen: new Set(), fx: [], crateAt: 0, sent: '', sendAt: 0, ended: false, sinkOrder: [], over: null };
    if (online) sendPos(true);
  }

  function startPractice() {
    leaveRoom();
    const bots = Number(store.get('boatbattle-bots')) || 3;
    const list = [{ id: myId, slot: 0, name: 'You' }];
    for (let k = 1; k <= bots; k++) list.push({ id: 'bot' + k, slot: k, name: COLOR_NAMES[k], bot: true });
    newGame(false, now() + 3600, list);
    show('game');
    fit();
  }

  const started = () => game && now() >= game.startAt;
  const alive = b => b && !b.out && b.lives > 0;

  // Fire whatever's loaded. Online, the shot is shared so every device can fly it too.
  function fire(b) {
    const kind = b.kind || 'ball', K = SHOTS[kind];
    b.cool = K.reload * (b.bot ? 1.7 : 1);
    if (b.kind && --b.ammo <= 0) { b.kind = null; b.ammo = 0; }
    const shot = { b: b.id, k: kind, x: Math.round(b.x + Math.cos(b.a) * BOW), y: Math.round(b.y + Math.sin(b.a) * BOW), a: +b.a.toFixed(3), t: now() };
    let key = 's' + Math.random().toString(36).slice(2);
    if (game.online) { const ref = room.ref.child('live/shots').push(); key = ref.key; ref.set(shot); }
    game.seen.add(key);
    addBall(shot, 0);
    if (b.id === myId) sendPos(true);
  }
  function remoteShot(key, v) {
    if (!game || !game.online || !v || game.seen.has(key) || v.b === myId || v.t < game.startAt - 1000) return;
    game.seen.add(key);
    // Fly it forward by however long it took to get here, so it's where the shooter sees it.
    addBall(v, clamp((now() - v.t) / 1000, 0, 0.35));
  }
  function addBall(s, age) {
    const K = SHOTS[s.k] || SHOTS.ball;
    const ball = { by: s.b, k: s.k, x: s.x, y: s.y, vx: Math.cos(s.a) * K.speed, vy: Math.sin(s.a) * K.speed, a: s.a, left: K.range, K, dead: false };
    game.balls.push(ball);
    game.fx.push({ type: 'smoke', x: s.x, y: s.y, t: 0 });
    if (age === 0 || inView()) sfx.cannon(s.k);
    for (let t = age; t > 0 && !ball.dead; t -= 1 / 60) moveBall(ball, Math.min(t, 1 / 60));
  }
  const inView = () => !$('game').hidden;

  // The two ends of a chained double-barrel shot, or the ball itself.
  function ballEnds(ball) {
    if (!ball.K.gap) return [ball.x, ball.y, ball.x, ball.y];
    const px = -Math.sin(ball.a) * ball.K.gap, py = Math.cos(ball.a) * ball.K.gap;
    return [ball.x - px, ball.y - py, ball.x + px, ball.y + py];
  }

  function moveBall(ball, dt) {
    const d = Math.hypot(ball.vx, ball.vy) * dt;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.left -= d;
    if (ball.x < 0 || ball.x > W || ball.y < 0 || ball.y > W || ball.left <= 0) return endBall(ball);
    if (ISLANDS.some(i => Math.hypot(ball.x - i.x, ball.y - i.y) < i.r + ball.K.r)) return endBall(ball, true);
    const [ax, ay, bx, by] = ballEnds(ball);
    for (const b of Object.values(game.boats)) {
      if (b.id === ball.by || !alive(b)) continue;
      const p = b.local ? b : b.shown;
      if (segDist(p.x, p.y, ax, ay, bx, by) > BOAT_R + ball.K.r) continue;
      // Only the device that owns a boat decides it was hit; everyone else just sees the ball stop.
      if (!ball.K.blast && b.local) hurt(b, ball.K.dmg);
      return endBall(ball, true, !ball.K.blast);
    }
  }

  function endBall(ball, hitSomething, struck) {
    ball.dead = true;
    if (ball.K.blast) {
      game.fx.push({ type: 'boom', x: ball.x, y: ball.y, t: 0, r: ball.K.blast });
      sfx.boom();
      for (const b of Object.values(game.boats)) {
        if (b.local && b.id !== ball.by && alive(b) && Math.hypot(b.x - ball.x, b.y - ball.y) < ball.K.blast + BOAT_R) hurt(b, ball.K.dmg);
      }
    } else if (struck) {
      game.fx.push({ type: 'hit', x: ball.x, y: ball.y, t: 0 });
    } else {
      game.fx.push({ type: 'splash', x: ball.x, y: ball.y, t: 0, rock: hitSomething });
      if (inView()) sfx.splash();
    }
  }

  function hurt(b, dmg) {
    if (b.inv > 0 || !alive(b)) return;
    b.lives = Math.max(0, b.lives - dmg);
    b.inv = INV;
    sfx.hit();
    if (b.lives <= 0) sink(b);
    if (b.id === myId) { shake = 0.3; sendPos(true); }
  }
  function sink(b) {
    if (b.sunkAt) return;
    b.sunkAt = performance.now();
    game.sinkOrder.push(b.id);
    sfx.sink();
  }

  function give(b, k) {
    b.kind = k; b.ammo = SHOTS[k].shots;
    game.fx.push({ type: 'pickup', x: b.x, y: b.y, t: 0, k });
    if (b.id === myId) { sfx.pickup(); sendPos(true); }
  }

  // My boat or a computer boat touched a crate. Online, a transaction makes sure only one boat gets each crate.
  function grab(b, id, c) {
    if (!game.online) { delete game.crates[id]; give(b, c.k); return; }
    if (game.taking.has(id)) return;
    game.taking.add(id);
    let got = null;
    room.ref.child(`live/crates/${id}`).transaction(cur => { got = cur; return cur ? null : undefined; })
      .then(res => { if (res.committed && got && game) give(b, got.k); })
      .catch(() => {})
      .finally(() => { if (game) game.taking.delete(id); });
  }

  // The host (or this device, in practice) drops a crate somewhere open every few seconds.
  function dropCrates() {
    const t = performance.now() / 1000, n = Object.keys(game.crates || {}).length, cap = Math.min(6, 2 + Math.ceil(game.order.length / 2));
    if (!started() || t < game.crateAt || n >= cap) return;
    game.crateAt = t + CRATE_EVERY;
    for (let tries = 0; tries < 30; tries++) {
      const x = 50 + Math.random() * (W - 100), y = 50 + Math.random() * (W - 100);
      if (ISLANDS.some(i => Math.hypot(x - i.x, y - i.y) < i.r + 30)) continue;
      if (Object.values(game.boats).some(b => alive(b) && Math.hypot(x - b.shown.x, y - b.shown.y) < 80)) continue;
      const crate = { x: Math.round(x), y: Math.round(y), k: CRATE_KINDS[Math.floor(Math.random() * CRATE_KINDS.length)] };
      if (game.online) room.ref.child('live/crates').push(crate);
      else game.crates['c' + Math.random().toString(36).slice(2)] = crate;
      return;
    }
  }

  // ── Steering ─────────────────────────────────────────────────────────────
  const keys = new Set();
  const stick = { x: 0, y: 0, on: false };
  let fireHeld = false;

  // What my boat wants to do this frame: a heading to turn toward (or a turn rate), and how hard to sail.
  function myControls() {
    const left = keys.has('left'), right = keys.has('right'), up = keys.has('up');
    if (stick.on && Math.hypot(stick.x, stick.y) > 0.2) return { want: Math.atan2(stick.y, stick.x), throttle: Math.min(1, Math.hypot(stick.x, stick.y)) };
    if (left || right || up || keys.has('down')) return { turn: (right ? 1 : 0) - (left ? 1 : 0), throttle: up ? 1 : 0 };
    return { throttle: 0 };
  }

  // A computer boat: chase the nearest boat (or a crate, if it has no power-up), steer around islands, fire when lined up.
  function botControls(b, dt) {
    b.think -= dt;
    const others = Object.values(game.boats).filter(o => o !== b && alive(o));
    if (b.think <= 0) {
      b.think = 0.15 + Math.random() * 0.1;
      let target = null, best = 1e9;
      for (const o of others) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < best) { best = d; target = o; } }
      let goal = null;
      if (!b.kind) for (const c of Object.values(game.crates || {})) {
        const d = Math.hypot(c.x - b.x, c.y - b.y);
        if (d < 260 && d < best * 0.8) { best = d; goal = { x: c.x, y: c.y, crate: true }; }
      }
      if (!goal && target) {
        // Aim a little ahead of where the target is going.
        const K = SHOTS[b.kind || 'ball'], lead = best / K.speed * 0.7;
        goal = { x: target.x + Math.cos(target.a) * target.v * lead, y: target.y + Math.sin(target.a) * target.v * lead, dist: best, K };
      }
      b.goal = goal;
      b.wantFire = false;
      if (goal && !goal.crate) {
        const aimA = Math.atan2(goal.y - b.y, goal.x - b.x);
        const range = b.kind === 'spiky' ? 260 : goal.K.range * 0.95;
        b.wantFire = Math.abs(angDiff(b.a, aimA)) < 0.2 && goal.dist < range && clearLine(b.x, b.y, goal.x, goal.y);
      }
    }
    const g = b.goal;
    let want = g ? Math.atan2(g.y - b.y, g.x - b.x) : b.a, throttle = 0.85;
    // Too close: circle around the target instead of ramming it.
    if (g && !g.crate && g.dist < 110) want += Math.PI / 2;
    // Look ahead for islands and the edge of the sea.
    const lx = b.x + Math.cos(b.a) * 70, ly = b.y + Math.sin(b.a) * 70;
    for (const i of ISLANDS) {
      if (Math.hypot(lx - i.x, ly - i.y) < i.r + 28) {
        const side = angDiff(b.a, Math.atan2(i.y - b.y, i.x - b.x)) > 0 ? -1 : 1;
        want = b.a + side * 1.3; throttle = 0.6;
      }
    }
    if (lx < 40 || lx > W - 40 || ly < 40 || ly > W - 40) want = Math.atan2(CX - b.y, CX - b.x);
    return { want, throttle };
  }

  function sail(b, c, dt) {
    if (c.want != null) b.a += clamp(angDiff(b.a, c.want), -TURN * dt, TURN * dt);
    else if (c.turn) b.a += c.turn * TURN * dt;
    b.v += (c.throttle * MAX_V - b.v) * Math.min(1, dt * 1.6);
    b.x += Math.cos(b.a) * b.v * dt; b.y += Math.sin(b.a) * b.v * dt;
    // Bump off islands and the edge of the sea.
    for (const i of ISLANDS) {
      const dx = b.x - i.x, dy = b.y - i.y, d = Math.hypot(dx, dy), min = i.r + BOAT_R - 3;
      if (d < min) { b.x = i.x + dx / (d || 1) * min; b.y = i.y + dy / (d || 1) * min; b.v *= 0.6; }
    }
    b.x = clamp(b.x, BOAT_R, W - BOAT_R); b.y = clamp(b.y, BOAT_R, W - BOAT_R);
  }

  // ── Keeping devices in step ──────────────────────────────────────────────
  function sendPos(force) {
    if (!game || !game.online || !room) return;
    const b = game.boats[myId];
    if (!b) return;
    const p = { x: Math.round(b.x), y: Math.round(b.y), a: +b.a.toFixed(2), v: Math.round(b.v), l: b.lives, k: b.kind || 0, i: b.inv > 0 ? 1 : 0 };
    const key = JSON.stringify(p);
    if (!force && (key === game.sent || performance.now() < game.sendAt)) return;
    game.sent = key; game.sendAt = performance.now() + 80;
    room.ref.child(`live/pos/${myId}`).set(p);
  }

  // Everyone else's boat glides toward where their device last said it was, plus how far it's sailed since.
  function followRemote(b, dt) {
    const m = room && room.meta;
    if (!m || !m.players || !m.players[b.id]) { if (!b.out) { b.out = true; if (!b.sunkAt) b.sunkAt = performance.now(); } return; }
    const p = room.pos[b.id];
    if (!p) return;
    if (b.last !== p) { b.last = p; b.gotAt = performance.now(); }
    const age = Math.min(0.25, (performance.now() - b.gotAt) / 1000);
    b.x = p.x + Math.cos(p.a) * p.v * age; b.y = p.y + Math.sin(p.a) * p.v * age; b.a = p.a; b.v = p.v;
    b.kind = p.k || null; b.inv = p.i ? 1 : 0;
    if (p.l < b.lives) { game.fx.push({ type: 'hit', x: b.shown.x, y: b.shown.y, t: 0 }); }
    b.lives = p.l;
    if (b.lives <= 0) sink(b);
    const s = b.shown, k = Math.min(1, dt * 10);
    s.x += (b.x - s.x) * k; s.y += (b.y - s.y) * k; s.a += angDiff(s.a, b.a) * k;
  }

  // The host (or this device, in practice) decides when the battle is over.
  function checkOver() {
    if (game.ended || !started()) return;
    const floating = game.order.filter(id => alive(game.boats[id]));
    if (game.online) {
      if (room.meta.host !== myId || floating.length > 1) return;
      game.ended = true;
      setTimeout(() => { if (room && room.meta && room.meta.phase === 'play') room.ref.child('meta').update({ phase: 'over', winner: floating[0] || null }); }, 900);
      return;
    }
    // In practice it's over when you sink, or when you're the last one floating.
    if (alive(game.boats[myId]) && floating.length > 1) return;
    game.ended = true;
    const place = alive(game.boats[myId]) ? 1 : floating.length + 1;
    setTimeout(() => { if (game && !game.online) { game.over = { winner: floating.length === 1 ? floating[0] : null, place }; showOver(); } }, 1200);
  }

  function update(dt) {
    const go = started();
    for (const b of Object.values(game.boats)) {
      if (!b.local) { followRemote(b, dt); continue; }
      b.inv = Math.max(0, b.inv - dt); b.cool = Math.max(0, b.cool - dt);
      if (alive(b) && go) {
        const c = b.bot ? botControls(b, dt) : myControls();
        sail(b, c, dt);
        if ((b.bot ? b.wantFire : fireHeld) && b.cool <= 0) fire(b);
        for (const [id, c2] of Object.entries(game.crates || {})) {
          if (c2 && Math.hypot(c2.x - b.x, c2.y - b.y) < BOAT_R + CRATE_R) grab(b, id, c2);
        }
      } else b.v *= 0.95;
      b.shown.x = b.x; b.shown.y = b.y; b.shown.a = b.a;
    }
    for (const ball of game.balls) if (!ball.dead) moveBall(ball, dt);
    game.balls = game.balls.filter(b => !b.dead);
    if (!game.online || room.meta.host === myId) dropCrates();
    if (game.online) sendPos(false);
    checkOver();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  const canvas = $('canvas'), g2 = canvas.getContext('2d');
  let S = 1, lastFrame = performance.now(), shake = 0;

  function fit() {
    const wrap = canvas.parentElement.getBoundingClientRect(), size = Math.max(100, Math.floor(Math.min(wrap.width - 8, wrap.height - 4)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.width = canvas.style.height = size + 'px';
    canvas.width = canvas.height = Math.round(size * dpr);
    S = size / W * dpr;
  }
  window.addEventListener('resize', () => { if (game) fit(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (game) fit(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { if (game) fit(); }, 300));

  function drawSea(t) {
    const sea = g2.createRadialGradient(CX, CX, 50, CX, CX, W * 0.75);
    sea.addColorStop(0, '#2a86c9'); sea.addColorStop(1, '#165a96');
    g2.fillStyle = sea; g2.fillRect(0, 0, W, W);
    // Little wave marks that drift.
    g2.strokeStyle = 'rgba(255,255,255,.12)'; g2.lineWidth = 2; g2.beginPath();
    for (let y = 30; y < W; y += 60) for (let x = (y / 60 % 2) * 40 + 20; x < W; x += 80) {
      const ox = Math.sin(t * 0.8 + y) * 6;
      g2.moveTo(x + ox - 9, y); g2.quadraticCurveTo(x + ox, y - 6, x + ox + 9, y);
    }
    g2.stroke();
  }

  function drawIsland(i, t) {
    g2.fillStyle = 'rgba(255,255,255,.25)';
    g2.beginPath(); g2.arc(i.x, i.y, i.r + 5 + Math.sin(t * 2 + i.x) * 1.5, 0, Math.PI * 2); g2.fill();
    if (i.r < 30) {
      g2.fillStyle = '#7d828c'; g2.beginPath(); g2.arc(i.x, i.y, i.r, 0, Math.PI * 2); g2.fill();
      g2.fillStyle = '#9ba0aa'; g2.beginPath(); g2.arc(i.x - i.r * 0.25, i.y - i.r * 0.25, i.r * 0.55, 0, Math.PI * 2); g2.fill();
      return;
    }
    g2.fillStyle = '#ead59c'; g2.beginPath(); g2.arc(i.x, i.y, i.r, 0, Math.PI * 2); g2.fill();
    g2.fillStyle = '#5fae4f'; g2.beginPath(); g2.arc(i.x, i.y, i.r * 0.68, 0, Math.PI * 2); g2.fill();
    // A palm tree.
    g2.fillStyle = '#3f8a3a';
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5 + 0.3;
      g2.beginPath(); g2.ellipse(i.x + Math.cos(a) * i.r * 0.25, i.y + Math.sin(a) * i.r * 0.25, i.r * 0.3, i.r * 0.11, a, 0, Math.PI * 2); g2.fill();
    }
    g2.fillStyle = '#8a5a32'; g2.beginPath(); g2.arc(i.x, i.y, i.r * 0.09, 0, Math.PI * 2); g2.fill();
  }

  // The little picture for each kind of shot, on crates and over boats.
  function drawIcon(k, x, y, s) {
    if (k === 'double') {
      g2.strokeStyle = '#ddd'; g2.lineWidth = s * 0.18; g2.beginPath(); g2.moveTo(x - s * 0.45, y); g2.lineTo(x + s * 0.45, y); g2.stroke();
      g2.fillStyle = '#222'; for (const dx of [-0.45, 0.45]) { g2.beginPath(); g2.arc(x + dx * s, y, s * 0.3, 0, Math.PI * 2); g2.fill(); }
    } else if (k === 'spiky') {
      g2.fillStyle = '#222'; g2.beginPath();
      for (let j = 0; j < 16; j++) { const a = j * Math.PI / 8, r = j % 2 ? s * 0.32 : s * 0.62; g2.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      g2.closePath(); g2.fill();
    } else if (k === 'boom') {
      g2.fillStyle = '#ff6b2b'; g2.beginPath();
      for (let j = 0; j < 14; j++) { const a = j * Math.PI / 7, r = j % 2 ? s * 0.35 : s * 0.65; g2.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      g2.closePath(); g2.fill();
      g2.fillStyle = '#ffd43b'; g2.beginPath(); g2.arc(x, y, s * 0.25, 0, Math.PI * 2); g2.fill();
    }
  }

  function drawCrate(c, t) {
    const bob = Math.sin(t * 3 + c.x) * 2;
    g2.save(); g2.translate(c.x, c.y + bob); g2.rotate(Math.sin(t * 1.5 + c.y) * 0.15);
    g2.fillStyle = 'rgba(255,255,255,.25)'; g2.beginPath(); g2.arc(0, 0, CRATE_R + 6 + Math.sin(t * 4) * 2, 0, Math.PI * 2); g2.fill();
    g2.fillStyle = '#b07a3c'; g2.fillRect(-12, -12, 24, 24);
    g2.strokeStyle = '#6e4620'; g2.lineWidth = 2.5; g2.strokeRect(-12, -12, 24, 24);
    g2.beginPath(); g2.moveTo(-12, -12); g2.lineTo(12, 12); g2.stroke();
    g2.restore();
    drawIcon(c.k, c.x, c.y + bob - 24, 16);
  }

  function drawBoat(b, t) {
    const s = b.shown;
    let fade = 1, scale = 1;
    if (b.sunkAt) { const k = (performance.now() - b.sunkAt) / 1500; if (k >= 1) return; fade = 1 - k; scale = 1 - k * 0.4; }
    if (b.inv > 0 && !b.sunkAt && Math.floor(t * 12) % 2) fade = 0.35;
    g2.save(); g2.globalAlpha = fade;
    // Foam behind a moving boat.
    if (b.v > 20 && !b.sunkAt) {
      g2.fillStyle = 'rgba(255,255,255,.3)';
      for (let k = 1; k <= 3; k++) { g2.beginPath(); g2.arc(s.x - Math.cos(s.a) * (20 + k * 11), s.y - Math.sin(s.a) * (20 + k * 11), 4 + k * 2, 0, Math.PI * 2); g2.fill(); }
    }
    g2.translate(s.x, s.y); g2.rotate(s.a + (b.sunkAt ? (performance.now() - b.sunkAt) / 600 : 0)); g2.scale(scale * VIS, scale * VIS);
    // Cannon(s) at the front.
    g2.fillStyle = '#2b2b33';
    if (b.kind === 'double') { g2.fillRect(8, -7, 18, 5); g2.fillRect(8, 2, 18, 5); }
    else g2.fillRect(8, b.kind === 'spiky' || b.kind === 'boom' ? -4.5 : -3, 18, b.kind === 'spiky' || b.kind === 'boom' ? 9 : 6);
    // Hull, then a deck in the boat's color.
    g2.fillStyle = '#7a4a26'; g2.strokeStyle = '#3d2310'; g2.lineWidth = 2;
    g2.beginPath(); g2.moveTo(22, 0); g2.quadraticCurveTo(10, -12, -14, -11); g2.quadraticCurveTo(-20, 0, -14, 11); g2.quadraticCurveTo(10, 12, 22, 0);
    g2.fill(); g2.stroke();
    g2.fillStyle = COLORS[b.slot];
    g2.beginPath(); g2.moveTo(16, 0); g2.quadraticCurveTo(7, -8, -11, -7.5); g2.quadraticCurveTo(-15, 0, -11, 7.5); g2.quadraticCurveTo(7, 8, 16, 0); g2.fill();
    // The sail, seen from above, with a white stripe.
    g2.fillStyle = '#fffaf0'; g2.strokeStyle = 'rgba(0,0,0,.35)'; g2.lineWidth = 1.5;
    g2.beginPath(); g2.moveTo(-1, -15); g2.quadraticCurveTo(7, 0, -1, 15); g2.lineTo(-5, 15); g2.quadraticCurveTo(3, 0, -5, -15); g2.closePath(); g2.fill(); g2.stroke();
    g2.fillStyle = '#5a3a1e'; g2.beginPath(); g2.arc(-3, 0, 2.5, 0, Math.PI * 2); g2.fill();
    g2.restore();
    if (b.sunkAt) return;
    // Name and hearts, always upright.
    const label = b.id === myId ? 'You' : b.name, lx = clamp(s.x, 40, W - 40);
    g2.font = `600 22px Fredoka, system-ui, sans-serif`; g2.textAlign = 'center';
    g2.lineWidth = 4.5; g2.strokeStyle = 'rgba(0,0,0,.7)'; g2.strokeText(label, lx, s.y - 40);
    g2.fillStyle = COLORS[b.slot]; g2.fillText(label, lx, s.y - 40);
    for (let k = 0; k < LIVES; k++) {
      g2.fillStyle = k < b.lives ? '#ff4d6d' : 'rgba(0,0,0,.45)';
      const hx = s.x + (k - 1) * 14, hy = s.y - 32;
      g2.beginPath(); g2.arc(hx - 3, hy - 1.5, 3.6, 0, Math.PI * 2); g2.arc(hx + 3, hy - 1.5, 3.6, 0, Math.PI * 2);
      g2.moveTo(hx - 6.4, hy); g2.lineTo(hx, hy + 6.5); g2.lineTo(hx + 6.4, hy); g2.fill();
    }
    if (b.kind) drawIcon(b.kind, s.x + 32, s.y - 32, 13);
  }

  function drawBall(ball) {
    const [ax, ay, bx, by] = ballEnds(ball), r = ball.K.r;
    g2.fillStyle = 'rgba(0,0,0,.25)';
    g2.beginPath(); g2.arc(ball.x + 3, ball.y + 4, r, 0, Math.PI * 2); g2.fill();
    if (ball.K.gap) { g2.strokeStyle = '#ccc'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(ax, ay); g2.lineTo(bx, by); g2.stroke(); }
    if (ball.k === 'spiky') { drawIcon('spiky', ball.x, ball.y, r * 1.7); return; }
    g2.fillStyle = ball.k === 'boom' ? '#5a1010' : '#1e1e24';
    for (const [x, y] of ball.K.gap ? [[ax, ay], [bx, by]] : [[ball.x, ball.y]]) { g2.beginPath(); g2.arc(x, y, r, 0, Math.PI * 2); g2.fill(); }
    if (ball.k === 'boom') { g2.fillStyle = Math.random() < 0.5 ? '#ffd43b' : '#ff6b2b'; g2.beginPath(); g2.arc(ball.x - ball.vx / 120, ball.y - ball.vy / 120, 2.5, 0, Math.PI * 2); g2.fill(); }
  }

  function drawFx(dt) {
    game.fx = game.fx.filter(f => (f.t += dt) < (f.type === 'boom' ? 0.6 : 0.7));
    for (const f of game.fx) {
      const k = f.t / (f.type === 'boom' ? 0.6 : 0.7);
      g2.globalAlpha = 1 - k;
      if (f.type === 'splash') {
        g2.strokeStyle = f.rock ? '#ddd' : '#fff'; g2.lineWidth = 2.5;
        g2.beginPath(); g2.arc(f.x, f.y, 4 + k * 16, 0, Math.PI * 2); g2.stroke();
      } else if (f.type === 'boom') {
        g2.fillStyle = '#ff9f43'; g2.beginPath(); g2.arc(f.x, f.y, f.r * Math.min(1, k * 2.5), 0, Math.PI * 2); g2.fill();
        g2.fillStyle = '#ffd43b'; g2.beginPath(); g2.arc(f.x, f.y, f.r * 0.55 * Math.min(1, k * 2.5), 0, Math.PI * 2); g2.fill();
      } else if (f.type === 'hit') {
        g2.fillStyle = '#ffd43b';
        for (let j = 0; j < 8; j++) { const a = j * Math.PI / 4; g2.beginPath(); g2.arc(f.x + Math.cos(a) * k * 22, f.y + Math.sin(a) * k * 22, 3, 0, Math.PI * 2); g2.fill(); }
      } else if (f.type === 'smoke') {
        g2.fillStyle = '#ddd'; g2.beginPath(); g2.arc(f.x, f.y, 4 + k * 10, 0, Math.PI * 2); g2.fill();
      } else if (f.type === 'pickup') {
        g2.strokeStyle = '#ffd43b'; g2.lineWidth = 3; g2.beginPath(); g2.arc(f.x, f.y, 10 + k * 30, 0, Math.PI * 2); g2.stroke();
      }
    }
    g2.globalAlpha = 1;
  }

  function drawHud() {
    const b = game.boats[myId];
    if (!b) return;
    const hearts = '❤️'.repeat(b.lives) + '🖤'.repeat(LIVES - b.lives);
    if ($('hearts').textContent !== hearts) $('hearts').textContent = hearts;
    const K = SHOTS[b.kind || 'ball'], txt = b.kind ? `${K.icon} ${K.name} ×${b.ammo}` : `${K.icon} Cannon`;
    if ($('ammo').textContent !== txt) { $('ammo').textContent = txt; $('ammo').classList.toggle('special', !!b.kind); }
  }

  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - lastFrame) / 1000); lastFrame = t;
    if (!game || $('game').hidden) return;
    update(dt);
    const time = t / 1000;
    g2.setTransform(1, 0, 0, 1, 0, 0);
    g2.clearRect(0, 0, canvas.width, canvas.height);
    let ox = 0, oy = 0;
    if (shake > 0) { shake -= dt; ox = (Math.random() - 0.5) * 8; oy = (Math.random() - 0.5) * 8; }
    g2.setTransform(S, 0, 0, S, ox * S, oy * S);
    drawSea(time);
    for (const i of ISLANDS) drawIsland(i, time);
    for (const c of Object.values(game.crates || {})) if (c) drawCrate(c, time);
    for (const b of Object.values(game.boats)) if (b.id !== myId) drawBoat(b, time);
    if (game.boats[myId]) drawBoat(game.boats[myId], time);
    for (const ball of game.balls) drawBall(ball);
    drawFx(dt);
    drawHud();
    // Countdown.
    const left = game.startAt - now();
    $('count').hidden = !(left > -700) || !$('over').hidden;
    if (!$('count').hidden) {
      const txt = left > 0 ? String(Math.ceil(left / 1000)) : 'FIRE!';
      if ($('count').textContent !== txt) { $('count').textContent = txt; sfx.beep(left <= 0); }
    }
  }
  requestAnimationFrame(frame);

  // ── Sounds ───────────────────────────────────────────────────────────────
  // Made on the fly with Web Audio, so there are no sound files. Phones only allow sound after a tap.
  const sfx = (() => {
    let ac = null, muted = store.get('boatbattle-mute') === '1';
    function ctx() {
      if (muted) return null;
      if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ac = new AC(); }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(f, dur, type = 'square', vol = 0.08, slide = 1) {
      const a = ctx(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
      o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
    }
    function noise(dur, vol, freq) {
      const a = ctx(); if (!a) return;
      const b = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = b; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
      s.connect(f).connect(g).connect(a.destination); s.start();
    }
    return {
      cannon(k) { noise(0.18, 0.3, k === 'boom' ? 500 : 900); tone(k === 'spiky' ? 160 : 110, 0.12, 'sine', 0.12, 0.5); },
      splash() { noise(0.12, 0.12, 3000); },
      hit() { tone(300, 0.15, 'square', 0.08, 0.5); noise(0.15, 0.25, 1500); },
      boom() { noise(0.5, 0.45, 600); tone(70, 0.4, 'sine', 0.2, 0.4); },
      sink() { tone(400, 0.9, 'triangle', 0.1, 0.25); },
      pickup() { [660, 880, 1100].forEach((f, k) => setTimeout(() => tone(f, 0.12, 'square', 0.07), k * 70)); },
      beep(go) { tone(go ? 880 : 440, go ? 0.35 : 0.15, 'square', 0.08); },
      win() { [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => tone(f, 0.25, 'square', 0.09), k * 120)); },
      unlock() { ctx(); },
      get muted() { return muted; },
      toggle() { muted = !muted; store.set('boatbattle-mute', muted ? '1' : '0'); },
    };
  })();

  // ── Screens ──────────────────────────────────────────────────────────────
  function showOver() {
    const o = game.over;
    if (!o) return;
    $('over').hidden = false;
    keys.clear(); fireHeld = false;
    const w = o.winner && game.boats[o.winner];
    $('winner').innerHTML = !w ? (o.place > 1 && game.order.filter(id => alive(game.boats[id])).length > 1 ? 'You sank! 🌊' : 'Everyone sank! Nobody wins. 🌊') : o.winner === myId ? `${swatch(w.slot)} You win! 🏆` : `${swatch(w.slot)} ${esc(w.name)} wins! 🏆`;
    if (o.winner === myId) sfx.win();
    $('place').textContent = o.place && o.place > 1 ? `You sank. You came ${ordinal(o.place)} of ${game.order.length}.` : '';
    const canAgain = !game.online || room.meta.host === myId;
    $('again').hidden = !canAgain;
    $('again-wait').hidden = canAgain;
  }
  const ordinal = n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

  function render() {
    const meta = room && room.meta;
    if (!room) { show('menu'); return; }
    if (!meta || !meta.host) { leaveRoom(); show('menu'); $('menu-error').textContent = 'The host left, so the room closed.'; return; }
    if (!meta.players || !meta.players[myId]) { leaveRoom(); show('menu'); $('menu-error').textContent = 'You left the room.'; return; }
    const players = playerList(meta), host = meta.host === myId;

    if (meta.phase === 'lobby') {
      game = null;
      show('lobby');
      $('code').textContent = room.code;
      $('lobby-players').innerHTML = players.map(p => `<li>${swatch(p.slot)}<span class="pname">${esc(p.name)}</span>
        <span class="muted">${COLOR_NAMES[p.slot]}${p.id === meta.host ? ' · host' : ''}${p.id === myId ? ' · you' : ''}</span></li>`).join('');
      $('start').hidden = !host;
      $('start').disabled = players.length < 2;
      $('start').textContent = players.length > 1 ? `Start (${players.length} boats)` : 'Start (needs 2 boats)';
      $('lobby-wait').hidden = host;
      return;
    }

    if (!game || !game.online || game.startAt !== meta.startAt) {
      const order = (meta.order ? Object.values(meta.order) : []).filter(Boolean);
      newGame(true, meta.startAt, order.map(id => ({ id, slot: meta.players[id] ? meta.players[id].slot : 0, name: meta.players[id] ? meta.players[id].name : '?' })));
    }
    show('game');
    fit();
    $('over').hidden = meta.phase !== 'over';
    if (meta.phase === 'over' && !game.over) {
      const me = game.boats[myId];
      const place = me && !alive(me) ? game.order.length - game.sinkOrder.indexOf(myId) : null;
      game.over = { winner: meta.winner || null, place };
      showOver();
    }
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  const KEYS = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
  const inGame = () => !$('game').hidden && $('over').hidden;
  document.addEventListener('keydown', e => {
    if (!inGame()) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fireHeld = true; return; }
    const d = KEYS[e.key]; if (d) { e.preventDefault(); keys.add(d); }
  });
  document.addEventListener('keyup', e => {
    if (e.key === ' ' || e.key === 'Enter') fireHeld = false;
    const d = KEYS[e.key]; if (d) keys.delete(d);
  });
  window.addEventListener('blur', () => { keys.clear(); fireHeld = false; stick.on = false; });

  // The steering stick: push the way you want to sail. Farther from the middle is faster.
  const stickEl = $('stick'), knob = $('knob');
  let stickPointer = null;
  function moveStick(e) {
    const r = stickEl.getBoundingClientRect(), rad = r.width / 2;
    let dx = (e.clientX - r.left - rad) / rad, dy = (e.clientY - r.top - rad) / rad;
    const d = Math.hypot(dx, dy); if (d > 1) { dx /= d; dy /= d; }
    stick.x = dx; stick.y = dy; stick.on = true;
    knob.style.transform = `translate(${dx * rad * 0.6}px, ${dy * rad * 0.6}px)`;
  }
  stickEl.addEventListener('pointerdown', e => { e.preventDefault(); stickPointer = e.pointerId; try { stickEl.setPointerCapture(e.pointerId); } catch {} moveStick(e); });
  stickEl.addEventListener('pointermove', e => { if (e.pointerId === stickPointer) moveStick(e); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) stickEl.addEventListener(ev, e => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null; stick.on = false; stick.x = stick.y = 0; knob.style.transform = '';
  });
  const fireEl = $('fire');
  fireEl.addEventListener('pointerdown', e => { e.preventDefault(); fireHeld = true; fireEl.classList.add('on'); try { fireEl.setPointerCapture(e.pointerId); } catch {} });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) fireEl.addEventListener(ev, () => { fireHeld = false; fireEl.classList.remove('on'); });
  for (const el of [stickEl, fireEl]) el.addEventListener('contextmenu', e => e.preventDefault());

  // How many computer boats in practice.
  const botSeg = $('bot-count');
  botSeg.innerHTML = [1, 2, 3, 4, 5, 6, 7].map(n => `<button type="button" data-n="${n}">${n}</button>`).join('');
  const drawBots = () => { const n = Number(store.get('boatbattle-bots')) || 3; for (const b of botSeg.children) b.classList.toggle('on', Number(b.dataset.n) === n); };
  botSeg.onclick = e => { const b = e.target.closest('button'); if (b) { store.set('boatbattle-bots', b.dataset.n); drawBots(); } };
  drawBots();

  // Some touchscreens say they have a mouse, so show the stick whenever there's a touchscreen at all.
  if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) document.body.classList.add('touch');

  $('practice').onclick = startPractice;
  $('name').value = store.get('boatbattle-name') || '';
  $('create').onclick = () => { const n = myName(); if (n) createRoom(n); };
  $('join').onclick = () => {
    const n = myName(); if (!n) return;
    const code = $('join-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { $('menu-error').textContent = 'Room codes are 4 letters.'; return; }
    joinRoom(code, n);
  };
  $('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join').click(); });
  $('start').onclick = startBattle;
  $('again').onclick = playAgain;
  for (const id of ['lobby-leave', 'game-leave', 'over-leave']) $(id).onclick = () => { leaveRoom(); show('menu'); };
  const drawMute = () => { $('mute').textContent = sfx.muted ? '🔇' : '🔊'; };
  $('mute').onclick = () => { sfx.toggle(); drawMute(); };
  drawMute();
  window.addEventListener('pagehide', leaveRoom);
  for (const ev of ['pointerdown', 'touchstart', 'keydown']) document.addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true });

  // For testing: ?debug lets a test script reach the battle.
  if (/[?&]debug\b/.test(location.search)) window.boatGame = () => game;

  if (!db) $('menu-error').textContent = NO_SERVER;
  show('menu');
})();
