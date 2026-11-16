// Things to do in the city: delivery jobs, checkpoint races, wheelie runs, and the season's
// hidden collectibles. One job at a time; everything is started by stopping in a marker ring.
import * as THREE from 'three';
import { N, PITCH, CURB, ROAD_HALF, roadC } from './world/city.js';
import { circleVsObstacle } from './world/terrain.js';
import { mulberry } from './world/geo.js';
import { currentSeason } from './seasons.js';
import { money } from './ui/hud.js';

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
// a spot beside the road just past junction (i, j), heading d, `side` metres right of the centre line
const kerb = (i, j, d, along = 12.5, side = 5.9) => {
  const [dx, dz] = DIRS[d];
  return { x: roadC(i) + dx * along - dz * side, z: roadC(j) + dz * along + dx * side, yaw: Math.atan2(dx, dz) };
};

const ORANGE = 0xff8a1f, BLUE = 0x3fa9ff, PINK = 0xff4fd8;

export const FOOD = [
  { name: 'Slice Bros Pizza', at: [1, 1, 0] }, { name: 'Wok & Roll', at: [6, 2, 1] }, { name: 'Burger Bunker', at: [2, 6, 0] },
  { name: 'Taco Garage', at: [6, 6, 3] }, { name: 'Noodle Bar', at: [4, 4, 2] }, { name: 'Curry Corner', at: [7, 3, 2] },
];

// races: start = [i, j, heading], then the junctions to pass in order
export const RACES = [
  { id: 'park', name: 'Park Loop', start: [2, 2, 0], nodes: [[4, 2], [4, 4], [2, 4], [2, 2]] },
  { id: 'cross', name: 'Crosstown Dash', start: [0, 5, 0], nodes: [[2, 5], [2, 3], [5, 3], [5, 6], [8, 6]] },
  { id: 'zig', name: 'Zig-Zag', start: [6, 0, 1], nodes: [[6, 1], [5, 1], [5, 2], [4, 2], [4, 3], [3, 3], [3, 4], [2, 4], [2, 5], [1, 5]] },
  { id: 'ring', name: 'Ring Road GP', start: [0, 0, 0], nodes: [[4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4], [0, 0]] },
  { id: 'w1', name: 'Wheelie Mile', start: [0, 4, 0], wheelie: true },
  { id: 'w2', name: 'Back Wheel Boulevard', start: [7, 8, 3], wheelie: true },
];
export const MEDALS = ['', 'BRONZE', 'SILVER', 'GOLD'];
const MEDAL_CASH = [0, 150, 400, 1000], WHEELIE_GOALS = [40, 120, 300], WHEELIE_TIME = 60;

for (const r of RACES) {
  if (r.wheelie) { r.goals = WHEELIE_GOALS; r.scale = 1; continue; }
  let len = 0, turns = 0, pi = r.start[0], pj = r.start[1], pd = r.start[2];
  for (const [i, j] of r.nodes) {
    len += (Math.abs(i - pi) + Math.abs(j - pj)) * PITCH;
    const d = i > pi ? 0 : i < pi ? 2 : j > pj ? 1 : 3;
    if (d !== pd) turns++;
    pi = i; pj = j; pd = d;
  }
  r.len = len; r.scale = Math.max(1, Math.min(4, len / 700));
  // bronze, silver, gold: average speeds of about 6.5, 11 and 16 m/s
  r.goals = [6.5, 11, 16].map((v) => Math.round(len / v + turns * 1.2));
}

export const clock = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
export const medalFor = (r, v) => (r.wheelie ? (v >= r.goals[2] ? 3 : v >= r.goals[1] ? 2 : v >= r.goals[0] ? 1 : 0) : (v <= r.goals[2] ? 3 : v <= r.goals[1] ? 2 : v <= r.goals[0] ? 1 : 0));
export const medalCash = (r, m) => Math.round(MEDAL_CASH[m] * r.scale);

function label(text, color, w = 6.4) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(13,15,20,0.82)'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = color; g.fillRect(0, 0, 10, 96);
  g.font = 'italic 900 50px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = '#fff';
  g.fillText(text, 261, 50, 480);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(w, w * (96 / 512), 1);
  return s;
}

export class Jobs {
  constructor(game) {
    this.g = game;
    const T = game.terrain;
    this.T = T; this.t = 0;
    this.mode = null; this.job = null; this.count = 0; this.locked = false; this.sanctioned = false;
    this.lock = null; this.streak = 0;
    this.root = new THREE.Group(); game.scene.add(this.root);
    this.panel = document.getElementById('job');
    this.pEl = { t: this.panel.querySelector('.jt'), c: this.panel.querySelector('.jc'), s: this.panel.querySelector('.js') };
    this.nearEl = document.getElementById('sprk'); this.nearBar = this.nearEl.querySelector('b');
    this._txt = ['', '', ''];
    // "do you want this one?" prompt shown while you sit in a start ring
    this.ask = null; this.askEl = document.getElementById('ask');
    const tap = (id, fn) => document.getElementById(id).addEventListener('click', (e) => { fn(); e.currentTarget.blur(); });
    tap('ask-yes', () => this.confirm()); tap('ask-no', () => this.decline());

    // ---- stations: stop in the ring to start
    this.stations = [];
    for (const f of FOOD) {
      const p = kerb(...f.at);
      this.stations.push({ kind: 'food', def: f, x: p.x, z: p.z, r: 2.6, m: this._marker(p.x, p.z, ORANGE, 2.1, 'DELIVERY JOB') });
    }
    for (const r of RACES) {
      const p = kerb(...r.start);
      this.stations.push({ kind: 'race', def: r, x: p.x, z: p.z, r: 2.6, m: this._marker(p.x, p.z, r.wheelie ? PINK : BLUE, 2.1, r.wheelie ? 'WHEELIE RUN' : 'RACE') });
    }
    // ---- reusable target markers
    this.drop = this._marker(0, 0, ORANGE, 3, 'DROP OFF', true); this.drop.visible = false;
    this.gate = [this._marker(0, 0, BLUE, 7, null, true), this._marker(0, 0, BLUE, 7, null)];
    this.gate[0].visible = this.gate[1].visible = false;

    this._initSeason();
    this._pois();
  }

  _marker(x, z, col, r, text, beacon) {
    const g = new THREE.Group(); g.position.set(x, this.T.height(x, z) + 0.04, z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.8, r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 3.2, 28, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 1.6; g.add(ring, beam);
    if (text) { const s = label(text, '#' + col.toString(16).padStart(6, '0')); s.position.y = 4.1; g.add(s); }
    if (beacon) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 90, 12, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      b.position.y = 45; g.add(b);
    }
    g.userData.ring = ring;
    this.root.add(g);
    return g;
  }

  _place(m, x, z) { m.position.set(x, this.T.height(x, z) + 0.04, z); m.visible = true; }

  // ---- season collectibles ---------------------------------------------------
  _initSeason() {
    const g = this.g, se = currentSeason(), sv = g.save.data;
    this.season = se;
    if (sv.season.id !== se.id) { sv.season = { id: se.id, found: {}, done: false }; g.save.persist(); }
    const spots = this._seasonSpots(se);
    const mat = new THREE.MeshBasicMaterial({ color: se.color });
    const glow = new THREE.MeshBasicMaterial({ color: se.color, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending });
    const ringG = new THREE.TorusGeometry(0.3, 0.075, 8, 22), toothG = new THREE.BoxGeometry(0.11, 0.16, 0.12), glowG = new THREE.SphereGeometry(0.62, 12, 8);
    this.tokens = spots.map((s, i) => {
      const m = new THREE.Group();
      m.add(new THREE.Mesh(ringG, mat), new THREE.Mesh(glowG, glow));
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, t = new THREE.Mesh(toothG, mat); t.position.set(Math.cos(a) * 0.41, Math.sin(a) * 0.41, 0); t.rotation.z = a - Math.PI / 2; m.add(t); }
      m.position.set(s.x, s.y + 0.95, s.z); m.visible = !sv.season.found[i];
      this.root.add(m);
      return { x: s.x, y: s.y, z: s.z, m, i };
    });
  }

  // Hiding places: points inside the blocks that you can walk to in a straight line from at
  // least one of the surrounding streets, favouring ones tucked in beside something.
  _seasonSpots(se) {
    const T = this.T, rnd = mulberry(se.seed), hit = { nx: 0, nz: 0 }, sp = this.g.city.spots;
    const free = (x, z, y) => {
      let ok = true;
      T.query(x, z, 1.4, (o) => { if (!ok || o.y1 < y + 0.4 || o.y0 > y + 2.2) return; if (circleVsObstacle(o, x, z, 0.8, hit) > 0) ok = false; });
      return ok;
    };
    const walk = (x, z, dx, dz, n) => {
      let h = T.height(x, z);
      for (let k = 1; k <= n; k++) {
        const nx = x + dx * k, nz = z + dz * k, nh = T.height(nx, nz);
        if (Math.abs(nh - h) > 0.55 || !free(nx, nz, nh)) return false;
        h = nh;
      }
      return true;
    };
    const cand = [];
    for (let bj = 0; bj < N; bj++) for (let bi = 0; bi < N; bi++) {
      const x0 = roadC(bi), z0 = roadC(bj);
      for (let k = 0; k < 14; k++) {
        const x = x0 + 14 + rnd() * (PITCH - 28), z = z0 + 14 + rnd() * (PITCH - 28), y = T.height(x, z), jitter = rnd();
        if (y > 7 || y < -0.5 || !free(x, z, y)) continue;
        if (Math.abs(T.height(x + 0.8, z) - y) > 0.3 || Math.abs(T.height(x, z + 0.8) - y) > 0.3) continue; // not on an edge
        if ([sp.dealer, sp.customs, sp.home].some((s) => s && Math.hypot(s.x - x, s.z - z) < 16)) continue;
        // can you get here from the street on each side?
        const lim = ROAD_HALF - 1;
        const open = [walk(x, z, -1, 0, Math.ceil(x - x0 - lim)), walk(x, z, 1, 0, Math.ceil(x0 + PITCH - lim - x)), walk(x, z, 0, -1, Math.ceil(z - z0 - lim)), walk(x, z, 0, 1, Math.ceil(z0 + PITCH - lim - z))].filter(Boolean).length;
        if (!open) continue;
        cand.push({ x, y, z, block: bj * N + bi, score: (4 - open) + (y > CURB + 0.8 ? 1.5 : 0) + jitter });
      }
    }
    cand.sort((a, b) => b.score - a.score);
    const out = [], used = {};
    for (const sep of [90, 60, 35, 12]) {
      for (const c of cand) {
        if (out.length >= se.count) break;
        if (c.taken || (sep > 35 && used[c.block]) || out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < sep)) continue;
        c.taken = true; used[c.block] = true; out.push(c);
      }
    }
    return out;
  }

  // cheat: show (or hide again) every sprocket you have not found yet on the map
  toggleReveal() { const sv = this.g.save.data.season; sv.reveal = !sv.reveal; this.g.save.persist(); this._pois(); return sv.reveal; }

  seasonFound() { const f = this.g.save.data.season.found; return this.tokens.filter((t) => f[t.i]).length; }

  _collect(tok) {
    const g = this.g, sv = g.save.data.season, se = this.season;
    sv.found[tok.i] = true; tok.m.visible = false;
    if (sv.reveal) this._pois();
    const n = this.seasonFound(), total = this.tokens.length;
    g.save.earn(se.each);
    g.hud.popup(`${se.item.toUpperCase()} ${n}/${total}`, 0); g.hud.popup(`+${money(se.each)}`, 0);
    g.audio.bank(true);
    if (n >= total && !sv.done) {
      sv.done = true;
      const h = se.reward.helmet;
      if (h) { g.save.data.helmets.owned[h] = true; g.equipHelmet(h); }
      g.hud.banner(`SEASON ${se.n} COMPLETE`, `All ${total} found · ${se.reward.name} unlocked`, 'grn', 5);
      g.hud.toast(`SEASON ${se.n} REWARD`, se.reward.name, 'You are wearing it now — swap helmets at Customs');
      g.audio.escaped();
    }
    g.save.persist();
  }

  // ---- map ------------------------------------------------------------------
  _pois() {
    const ex = this.g.hud.extra, hex = (c) => '#' + c.toString(16).padStart(6, '0');
    ex.pois = this.mode ? [] : this.stations.map((s) => ({ x: s.x, z: s.z, color: hex(s.kind === 'food' ? ORANGE : s.def.wheelie ? PINK : BLUE), letter: s.kind === 'food' ? 'D' : s.def.wheelie ? 'W' : 'R', name: s.def.name }));
    // the SPROCKETS code puts the ones you still need on the map
    const sv = this.g.save.data.season;
    if (sv.reveal) for (const k of this.tokens) if (!sv.found[k.i]) ex.pois.push({ x: k.x, z: k.z, color: this.season.css, letter: 'S', name: `a ${this.season.item}` });
    const lg = document.getElementById('lg-sprk'); if (lg) lg.classList.toggle('hidden', !sv.reveal);
    for (const s of this.stations) s.m.visible = !this.mode;
  }

  _target(x, z, col, letter) { this.g.hud.extra.target = { x, z, color: '#' + col.toString(16).padStart(6, '0'), letter }; }

  _dist(d) { return this.g.save.data.settings.units === 'mph' ? `${Math.round(d * 3.281 / 10) * 10} ft` : `${Math.round(d / 5) * 5} m`; }

  _panel(a, b, c) {
    const v = [a, b, c], el = [this.pEl.t, this.pEl.c, this.pEl.s];
    for (let i = 0; i < 3; i++) if (v[i] !== this._txt[i]) { this._txt[i] = v[i]; el[i].textContent = v[i]; }
  }

  // ---- the start prompt --------------------------------------------------------
  _prompt(s) {
    const g = this.g, el = this.askEl, r = s.def, mode = g.input.mode;
    this.ask = s;
    el.dataset.k = s.kind === 'food' ? 'delivery' : r.wheelie ? 'wheelie' : 'race';
    el.querySelector('.at').textContent = s.kind === 'food' ? 'DELIVERY JOB' : r.name.toUpperCase();
    el.querySelector('.as').textContent = s.kind === 'food' ? `${r.name} has an order ready. Take it?`
      : r.wheelie ? `Wheelie run · longest wheelie in ${WHEELIE_TIME} s · gold at ${this._dist(r.goals[2])}`
        : `Checkpoint race · ${this._dist(r.len)} · gold in ${clock(r.goals[2])}`;
    document.getElementById('ask-yes').textContent = (s.kind === 'food' ? 'TAKE ORDER' : 'START') + (mode === 'keyboard' ? ' · ENTER' : mode === 'gamepad' ? ' · A' : '');
    el.classList.remove('hidden');
    g.audio.ui();
  }

  _unprompt() { if (this.ask) { this.ask = null; this.askEl.classList.add('hidden'); } }

  // the player said yes (button, Enter, or A on a gamepad)
  confirm() {
    const s = this.ask;
    if (!s || this.mode || this.g.state !== 'play') return false;
    this._unprompt();
    if (s.kind === 'food') { this.lock = s; this._startDelivery(s); } else this._startRace(s);
    return true;
  }

  // "not now": leave this ring alone until the player rides out of it and back
  decline() { const s = this.ask; if (!s) return; this._unprompt(); this.lock = s; }

  // ---- lifecycle --------------------------------------------------------------
  _begin(mode, job) {
    this._unprompt();
    this.mode = mode; this.job = job;
    this.panel.classList.remove('hidden'); this.panel.dataset.k = mode;
    this.g.hud.extra.target = null; this._pois();
  }

  _end() {
    this.mode = null; this.job = null; this.count = 0; this.locked = false; this.sanctioned = false;
    this.drop.visible = false; this.gate[0].visible = this.gate[1].visible = false;
    this.panel.classList.add('hidden');
    this.g.hud.extra.target = null; this._pois();
  }

  // quietly drop whatever is running (quit to title, shop, reset)
  cancel() { this._unprompt(); if (this.mode) { if (this.mode === 'delivery') this.streak = 0; this._end(); } }

  // the player gave up from the pause menu
  abandon() {
    if (!this.mode) return;
    const what = this.mode === 'delivery' ? 'DELIVERY' : this.mode === 'wheelie' ? 'WHEELIE RUN' : 'RACE';
    this.cancel(); this.g.hud.banner(`${what} ABANDONED`, '', 'red', 2);
  }

  fail(why) {
    if (!this.mode) return;
    const g = this.g, what = this.mode === 'delivery' ? 'DELIVERY FAILED' : this.mode === 'wheelie' ? 'RUN OVER' : 'RACE OVER';
    if (this.mode === 'delivery') this.streak = 0;
    this._end();
    g.hud.banner(what, why, 'red', 3); g.audio.lost();
  }

  busted() {
    if (!this.mode) return;
    if (this.mode === 'delivery') this.streak = 0;
    this._end(); // the bust banner says enough
  }

  // a crash event from the physics
  crashed() {
    const j = this.job, g = this.g;
    if (this.mode === 'delivery') {
      j.hits++;
      if (j.hits >= 3) this.fail('The order did not survive the third crash');
      else g.hud.popup(`ORDER DAMAGED  -${j.hits * 20}%`, 0);
    } else if (this.mode === 'wheelie' && !this.count) this._finishWheelie();
  }

  // ---- deliveries ---------------------------------------------------------------
  _startDelivery(st) {
    const g = this.g, rnd = Math.random;
    let to = null, man = 0;
    for (let k = 0; k < 60 && !to; k++) {
      const i = Math.floor(rnd() * (N + 1)), j = Math.floor(rnd() * (N + 1)), d = Math.floor(rnd() * 4);
      if (i + DIRS[d][0] < 0 || i + DIRS[d][0] > N || j + DIRS[d][1] < 0 || j + DIRS[d][1] > N) continue;
      const p = kerb(i, j, d); man = Math.abs(p.x - st.x) + Math.abs(p.z - st.z);
      if (man < 220 || man > 900) continue;
      if (this.stations.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 12)) continue;
      to = p;
    }
    if (!to) return;
    const top = g.model.spec.drive.topSpeed;
    const limit = Math.round(man / Math.max(6.5, top * 0.5) + 14), base = Math.round(60 + man * 0.45);
    this._begin('delivery', { from: st.def.name, to, man, limit, base, t: 0, wheelie: 0, hits: 0 });
    this._place(this.drop, to.x, to.z); this._target(to.x, to.z, ORANGE, 'D');
    g.hud.banner('ORDER UP', `${st.def.name} · ${this._dist(man)} · ${clock(limit)} on the clock`, 'yel', 2.6);
    g.audio.bank(false);
  }

  _finishDelivery() {
    const g = this.g, j = this.job, sv = g.save.data.jobs;
    const left = Math.max(0, j.limit - j.t);
    const food = Math.round(j.base * (1 - 0.2 * j.hits));
    const tip = Math.round(j.base * 0.5 * (left / j.limit));
    const style = Math.round(Math.min(j.base, j.wheelie * 0.5));
    const mult = 1 + 0.1 * Math.min(5, this.streak);
    const pay = Math.round((food + tip + style) * mult);
    this.streak++;
    sv.deliveries++; sv.earned += pay; sv.streakBest = Math.max(sv.streakBest, this.streak);
    g.save.earn(pay); g.save.stat('deliveries', sv.deliveries);
    this._end();
    const bits = [`tip ${money(tip)}`];
    if (style) bits.push(`wheelie bonus ${money(style)}`);
    if (j.hits) bits.push(`damage -${j.hits * 20}%`);
    if (mult > 1) bits.push(`streak x${mult.toFixed(1)}`);
    g.hud.banner('DELIVERED', `+${money(pay)} · ${bits.join(' · ')}`, 'grn', 3.4);
    g.audio.bank(true);
  }

  // ---- races ----------------------------------------------------------------------
  _startRace(st) {
    const g = this.g, r = st.def, p = g.phys, s = kerb(...r.start); // line up in the ring itself, clear of the traffic lane
    g.tricks.bankNow(); g._tricksOff();
    p.reset(s.x, s.z, s.yaw); g.rig.snap = true; g.respawnGrace = 1.5;
    this.lock = st; this.count = 3.2; this.locked = true; this.sanctioned = true; this._n = 4;
    if (r.wheelie) this._begin('wheelie', { def: r, t: 0, cur: 0, best: 0 });
    else {
      this._begin('race', { def: r, t: 0, idx: 0, cps: r.nodes.map(([i, j]) => ({ x: roadC(i), z: roadC(j) })) });
      this._gates();
    }
    g.hud.hint(r.wheelie ? `Longest single wheelie in ${WHEELIE_TIME} seconds counts · a crash ends the run` : 'Ride through every checkpoint · follow the line on the minimap', 4);
  }

  _gates() {
    const j = this.job, a = j.cps[j.idx], b = j.cps[j.idx + 1];
    if (a) { this._place(this.gate[0], a.x, a.z); this._target(a.x, a.z, BLUE, String(j.idx + 1)); } else this.gate[0].visible = false;
    if (b) { this._place(this.gate[1], b.x, b.z); this.gate[1].userData.ring.material.opacity = 0.3; } else this.gate[1].visible = false;
  }

  _medal(r, value, text) {
    const g = this.g, sv = g.save.data.races, old = sv[r.id] || { best: null, medal: 0 };
    const m = medalFor(r, value);
    const better = old.best == null || (r.wheelie ? value > old.best : value < old.best);
    const pay = (m > old.medal ? medalCash(r, m) - medalCash(r, old.medal) : 0) + Math.round(medalCash(r, m) * 0.15);
    sv[r.id] = { best: better ? value : old.best, medal: Math.max(m, old.medal) };
    if (pay) g.save.earn(pay);
    if (m === 3) g.save.stat('golds', RACES.filter((q) => (sv[q.id] || {}).medal === 3).length);
    g.save.persist();
    this._end();
    const next = m < 3 ? ` · ${MEDALS[m + 1].toLowerCase()} at ${r.wheelie ? this._dist(r.goals[m]) : clock(r.goals[m])}` : '';
    g.hud.banner(m ? MEDALS[m] : 'NO MEDAL', `${text}${better && old.best != null ? ' · NEW BEST' : ''}${pay ? ` · +${money(pay)}` : ''}${next}`, m ? (m === 3 ? 'yel' : 'grn') : 'red', 4);
    if (m) g.audio.escaped(); else g.audio.lost();
  }

  _finishWheelie() { const j = this.job; this._medal(j.def, Math.round(j.best), `${j.def.name} · ${this._dist(j.best)}`); }

  // ---- per frame -------------------------------------------------------------------
  update(dt, pp, p, onFoot) {
    const g = this.g;
    this.t += dt;
    const t = this.t, sp = Math.abs(pp.speed || 0);

    // collectibles: spin, and pick up on touch
    let near = 1e9;
    const py = onFoot ? pp.y : p.y;
    for (const k of this.tokens) {
      if (!k.m.visible) continue;
      const d = Math.hypot(k.x - pp.x, k.z - pp.z);
      if (d < near) near = d;
      if (d > 120) continue;
      k.m.rotation.y = t * 2.2 + k.i; k.m.position.y = k.y + 0.95 + Math.sin(t * 2 + k.i) * 0.1;
      if (d < 1.9 && Math.abs(py - k.y) < 2.6) this._collect(k);
    }
    const hot = near < 45;
    if (hot !== this._hot) { this._hot = hot; this.nearEl.classList.toggle('hidden', !hot); }
    if (hot) this.nearBar.style.width = Math.round((1 - near / 45) * 100) + '%';

    // start markers
    if (!this.mode) {
      // point new players at the rings once
      if (!g.save.data.jobs.tip && t > 25 && !g.cops.wanted && !onFoot) {
        g.save.data.jobs.tip = true; g.save.persist();
        g.hud.hint(g.touchOn ? 'New: <b>orange</b> rings are delivery jobs, <b>blue</b> are races · tap the minimap to find them' : 'New: <b>orange</b> rings are delivery jobs, <b>blue</b> are races · press <kbd>N</kbd> for the map', 7);
      }
      for (const s of this.stations) {
        const d = Math.hypot(pp.x - s.x, pp.z - s.z);
        if (d < 90) { s.m.userData.ring.rotation.y = t * 0.8; s.m.scale.setScalar(1 + Math.sin(t * 3 + s.x) * 0.04); }
        if (this.lock === s) { if (d > s.r + 3) this.lock = null; continue; }
        if (d > s.r || this.lock) continue;
        if (onFoot || p.crashed) { if (this._warn !== s) { this._warn = s; g.hud.hint('Get on your bike to start', 2.5); } continue; }
        if (this.ask === s) continue;
        if (sp > 5 || p.airTime > 0) continue; // just passing through
        if (s.kind === 'race' && g.cops.wanted) { if (this._warn !== s) { this._warn = s; g.hud.hint('Lose the cops before you race', 2.5); } continue; }
        this._warn = null;
        this._prompt(s); // nothing starts until the player says so
        break;
      }
      // the offer goes away if you leave the ring (or can no longer take it)
      const a = this.ask;
      if (a && (Math.hypot(pp.x - a.x, pp.z - a.z) > a.r + 1.5 || onFoot || p.crashed || (a.kind === 'race' && g.cops.wanted))) this._unprompt();
      if (this._warn && Math.hypot(pp.x - this._warn.x, pp.z - this._warn.z) > this._warn.r + 3) this._warn = null;
      return;
    }

    // countdown before a race
    if (this.count > 0) {
      this.count -= dt;
      const n = Math.ceil(this.count);
      if (n !== this._n && n >= 1 && n <= 3) { this._n = n; g.hud.banner(String(n), this.job.def.name, 'yel', 0.9); g.audio.ui(); }
      if (this.count <= 0) { this.count = 0; this.locked = false; g.hud.banner('GO!', '', 'grn', 1); g.audio.bank(false); }
    }
    const j = this.job, live = this.count <= 0;

    if (this.mode === 'delivery') {
      j.t += dt;
      if (p.wheelieT > 0 && !p.crashed && !onFoot) j.wheelie += Math.abs(p.speed) * dt;
      const left = j.limit - j.t, d = Math.hypot(pp.x - j.to.x, pp.z - j.to.z);
      this.drop.userData.ring.rotation.y = t; this.drop.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
      if (d < 4.6) { this._finishDelivery(); return; }
      if (left <= 0) { this.fail('Too slow — the food went cold'); return; }
      this.panel.classList.toggle('late', left < 10);
      this._panel(`DELIVERY · ${j.from}`, clock(left), `${this._dist(d)} to go · ${j.hits ? `order ${100 - j.hits * 20}%` : 'order intact'}`);
    } else if (this.mode === 'race') {
      if (live) j.t += dt;
      const r = j.def, c = j.cps[j.idx];
      this.gate[0].userData.ring.rotation.y = t; this.gate[0].userData.ring.material.opacity = 0.75 + Math.sin(t * 5) * 0.2;
      if (live && Math.hypot(pp.x - c.x, pp.z - c.z) < 9.5) {
        j.idx++;
        if (j.idx >= j.cps.length) { this._medal(r, Math.round(j.t * 10) / 10, `${r.name} · ${clock(j.t)}`); return; }
        g.hud.popup(`CHECKPOINT ${j.idx}/${j.cps.length}`, 0); g.audio.trick();
        this._gates();
      }
      if (j.t > r.goals[0] * 2.5) { this.fail('Out of time'); return; }
      const m = medalFor(r, j.t);
      this._panel(r.name.toUpperCase(), clock(j.t), `checkpoint ${j.idx + 1}/${j.cps.length} · ${m ? `${MEDALS[m].toLowerCase()} until ${clock(r.goals[m - 1])}` : 'no medal pace'}`);
    } else if (this.mode === 'wheelie') {
      if (live) {
        j.t += dt;
        if (p.wheelieT > 0 && !p.crashed) { j.cur += Math.abs(p.speed) * dt; if (j.cur > j.best) j.best = j.cur; } else j.cur = 0;
        if (j.t >= WHEELIE_TIME) { this._finishWheelie(); return; }
      }
      const r = j.def, m = medalFor(r, j.best);
      this._panel(r.name.toUpperCase(), this._dist(Math.max(j.cur, 0)), `best ${this._dist(j.best)} · ${clock(WHEELIE_TIME - j.t)} left · ${m < 3 ? `${MEDALS[m + 1].toLowerCase()} at ${this._dist(r.goals[m])}` : 'gold!'}`);
    }
  }
}
