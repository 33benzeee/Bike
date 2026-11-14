// Police: patrol cruisers that notice you, a five-level heat system, pursuit AI
// on the road grid, roadblocks, bike cops that follow your trail through
// alleys, and a helicopter. Lose line of sight long enough and you escape.
import * as THREE from 'three';
import { Batch, mat } from './world/geo.js';
import { N, PITCH, roadC } from './world/city.js';
import { buildBike } from './bikeModel.js';
import { Rider } from './rider.js';
import { BIKE_BY_ID, effectiveSpec } from './bikes.js';

const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const nodeOf = (v) => clamp(Math.round(v / PITCH + N / 2), 0, N);

export const HEAT_REWARD = [0, 250, 600, 1400, 3000, 6000];
const HEAT_TIME = [0, 0, 26, 58, 95, 135]; // seconds of being seen to reach each level
const CRUISERS = [0, 1, 2, 4, 5, 6];
const CAR_SPEED = [0, 19, 23, 27, 31, 35];

function cruiserMesh() {
  const b = new Batch();
  b.color(0x15171b).box(0, 0.32, 0, 1.86, 0.62, 4.6, { bottom: true });
  b.color(0xf2f2f2).box(0, 0.33, 0, 1.88, 0.6, 1.9);
  b.color(0x18222c).box(0, 0.94, -0.25, 1.64, 0.52, 2.3);
  b.color(0xf2f2f2).box(0, 1.46, -0.25, 1.66, 0.07, 2.34);
  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 10);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.color(0x101012).geom(wheel, mat(sx * 0.83, 0.34, sz * 1.45, 0, 0, Math.PI / 2));
  b.color(0x2a2c30).box(0, 0.3, 2.34, 1.9, 0.3, 0.2).box(0, 0.3, -2.3, 1.86, 0.25, 0.12);
  b.color(0xfff4c8).box(-0.62, 0.64, 2.31, 0.34, 0.14, 0.04).box(0.62, 0.64, 2.31, 0.34, 0.14, 0.04);
  b.color(0x222222).box(0, 1.53, -0.25, 1.2, 0.1, 0.3);
  const g = new THREE.Group();
  const body = new THREE.Mesh(b.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  body.castShadow = true; g.add(body);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.26), new THREE.MeshBasicMaterial({ color: 0xff1a1a }));
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.26), new THREE.MeshBasicMaterial({ color: 0x1a4cff }));
  red.position.set(0.33, 1.64, -0.25); blue.position.set(-0.33, 1.64, -0.25);
  g.add(red, blue);
  return { g, red, blue };
}

function heliMesh() {
  const b = new Batch();
  b.color(0x1b2a44).geom(new THREE.SphereGeometry(1.3, 10, 8), mat(0, 0, 0.4, 0, 0, 0, 1, 1, 1.7));
  b.color(0x10161f).geom(new THREE.SphereGeometry(1.05, 8, 6), mat(0, 0.1, 1.5, 0, 0, 0, 1, 0.9, 1));
  b.color(0x1b2a44).box(0, -0.2, -3.6, 0.3, 0.4, 4.4, { bottom: true });
  b.color(0xf2f2f2).box(0, 0.2, -5.6, 0.12, 1.3, 0.6, { bottom: true });
  b.color(0x333333).box(0, 1.25, 0.4, 0.2, 0.4, 0.2);
  for (const sx of [-1, 1]) b.color(0x222222).box(sx * 0.9, -1.6, 0.4, 0.1, 0.1, 3.2, { bottom: true });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(b.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.05, 0.28), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  rotor.position.set(0, 1.7, 0.4); g.add(rotor);
  const rotor2 = rotor.clone(); rotor2.rotation.y = Math.PI / 2; rotor.add(rotor2);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 46, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
  beam.position.y = -24; g.add(beam);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }));
  light.position.set(0, -1.1, 1.2); g.add(light);
  return { g, rotor, beam };
}

export class Cops {
  constructor(scene, terrain) {
    this.scene = scene; this.terrain = terrain;
    this.units = []; this.units.sirens = false;
    this.dyn = [];
    this.heat = 0; this.maxHeat = 0; this.wanted = false;
    this.seen = false; this.seenT = 0; this.evade = 0; this.evadeNeed = 1;
    this.suspicion = 0; this.watcher = false;
    this.bust = 0; this.lastX = 0; this.lastZ = 0;
    this.blockT = 12; this.spawnT = 0; this.flash = 0;
    this.trail = []; this.heli = null; this.hidden = false;
    this.onWanted = null; this.onHeat = null; this.onEscape = null; this.onBusted = null;
    this.nearest = 999; this.time = 0;
    for (let k = 0; k < 3; k++) this._addCruiser('patrol');
  }

  // ---- units -------------------------------------------------------------
  _addCruiser(state, x, z, yaw) {
    const m = cruiserMesh();
    const u = { car: true, mesh: m, x: 0, z: 0, yaw: 0, speed: 0, state, chasing: false, stuck: 0, rev: 0, ni: 0, nj: 0, pi: -1, pj: -1, sees: false, age: 0, blockT: 0,
      dynO: { t: 0, x: 0, z: 0, hx: 0.98, hz: 2.35, c: 1, s: 0, y0: 0, y1: 1.6, vx: 0, vz: 0, ref: null, cop: true, stamp: 0 } };
    u.dynO.ref = u;
    this.scene.add(m.g);
    if (x === undefined) this._placeRandom(u, 0, 0, 80, 400); else { u.x = x; u.z = z; u.yaw = yaw; u.ni = nodeOf(x); u.nj = nodeOf(z); }
    this.units.push(u);
    return u;
  }

  _placeRandom(u, px, pz, rMin, rMax, ahead) {
    let best = null;
    for (let t = 0; t < 40; t++) {
      const i = Math.floor(Math.random() * (N + 1)), j = Math.floor(Math.random() * (N + 1));
      const x = roadC(i), z = roadC(j), d = Math.hypot(x - px, z - pz);
      if (d < rMin || d > rMax) continue;
      if (ahead && (x - px) * ahead.x + (z - pz) * ahead.z < 0 && t < 25) continue;
      best = { i, j, x, z }; break;
    }
    if (!best) { const i = Math.floor(Math.random() * (N + 1)), j = Math.floor(Math.random() * (N + 1)); best = { i, j, x: roadC(i), z: roadC(j) }; }
    u.x = best.x; u.z = best.z; u.ni = best.i; u.nj = best.j; u.pi = -1; u.pj = -1; u.speed = 0;
    u.yaw = Math.atan2(px - u.x, pz - u.z);
  }

  _remove(u) {
    this.scene.remove((u.mesh.g || u.mesh));
    if (u.bike) { this.scene.remove(u.model.group); }
    const i = this.units.indexOf(u); if (i >= 0) this.units.splice(i, 1);
  }

  _addBikeCop(px, pz) {
    const spec = effectiveSpec(BIKE_BY_ID.surron);
    const model = buildBike(spec, 0xf2f2f2);
    const rider = new Rider({ hoodie: 0x1c2d5a, pants: 0x151a2a, shoes: 0x111111, gloves: 0x111111, helmet: 0xf4f4f4, visor: 0x101216, skin: 0xd8a47c, pack: 0x1c2d5a });
    model.group.add(rider.group);
    this.scene.add(model.group);
    const u = { bike: true, model, rider, mesh: model.group, x: 0, y: 0, z: 0, yaw: 0, speed: 0, chasing: true, state: 'chase', ti: Math.max(0, this.trail.length - 60), sees: false, age: 0, spin: 0,
      fake: { speed: 0, steer: 0, pitch: 0, comShift: 0, hopCharge: 0, rearContact: true, frontContact: true, airTime: 0, yaw: 0, effThrottle: 1, spinR: 0 } };
    const t = this.trail[u.ti] || { x: px, y: 0, z: pz };
    u.x = t.x; u.y = t.y; u.z = t.z;
    this.units.push(u);
    return u;
  }

  // ---- cruiser driving -----------------------------------------------------
  _drive(u, tx, tz, vmax, dt) {
    const dx = tx - u.x, dz = tz - u.z, dist = Math.hypot(dx, dz);
    let diff = angDiff(Math.atan2(dx, dz), u.yaw);
    if (u.rev > 0) {
      u.rev -= dt; u.speed += (-5 - u.speed) * Math.min(1, dt * 4);
      u.yaw -= clamp(diff, -1, 1) * dt * 1.2;
    } else {
      const maxTurn = Math.min(1.9, 10 / Math.max(u.speed, 3.5));
      u.yaw += clamp(diff * 3.2, -maxTurn, maxTurn) * dt * Math.min(1, Math.abs(u.speed) / 2 + 0.25);
      let vt = vmax * clamp(1.15 - Math.abs(diff) / 1.1, 0.22, 1);
      if (dist < 14) vt = Math.min(vt, 4 + dist * 0.9);
      if (u.speed < vt) u.speed = Math.min(vt, u.speed + 6.5 * dt); else u.speed = Math.max(vt, u.speed - 13 * dt);
    }
    u.x += Math.sin(u.yaw) * u.speed * dt; u.z += Math.cos(u.yaw) * u.speed * dt;
    // keep out of the blocks
    let pushed = false;
    const r = 1.25, cb = this.terrain.carBlocks;
    for (let k = 0; k < cb.length; k++) {
      const b = cb[k];
      if (u.x < b.x0 - r || u.x > b.x1 + r || u.z < b.z0 - r || u.z > b.z1 + r) continue;
      const cx = clamp(u.x, b.x0, b.x1), cz = clamp(u.z, b.z0, b.z1);
      let nx = u.x - cx, nz = u.z - cz; const d = Math.hypot(nx, nz);
      if (d > r) continue;
      if (d < 1e-4) {
        const ex = Math.min(u.x - b.x0, b.x1 - u.x), ez = Math.min(u.z - b.z0, b.z1 - u.z);
        if (ex < ez) u.x = u.x - b.x0 < b.x1 - u.x ? b.x0 - r : b.x1 + r; else u.z = u.z - b.z0 < b.z1 - u.z ? b.z0 - r : b.z1 + r;
      } else { nx /= d; nz /= d; u.x = cx + nx * r; u.z = cz + nz * r; }
      pushed = true;
    }
    const lim = this.terrain.bounds - 5;
    u.x = clamp(u.x, -lim, lim); u.z = clamp(u.z, -lim, lim);
    if (pushed) { u.speed *= 1 - Math.min(1, dt * 2.5); u.stuck += dt; if (u.stuck > 1.1) { u.rev = 0.9; u.stuck = 0; } }
    else u.stuck = Math.max(0, u.stuck - dt * 0.5);
  }

  // straight line free of blocks?
  _clear(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, cb = this.terrain.carBlocks;
    for (let k = 0; k < cb.length; k++) {
      const b = cb[k];
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (x0 < b.x0 || x0 > b.x1) continue; }
      else { let a = (b.x0 - x0) / dx, c = (b.x1 - x0) / dx; if (a > c) { const t = a; a = c; c = t; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-9) { if (z0 < b.z0 || z0 > b.z1) continue; }
      else { let a = (b.z0 - z0) / dz, c = (b.z1 - z0) / dz; if (a > c) { const t = a; a = c; c = t; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) continue; }
      return false;
    }
    return true;
  }

  // drive toward (gx, gz) using the road grid when the direct line is blocked
  _route(u, gx, gz, vmax, dt) {
    // snap the goal to the nearest road centre line
    const ri = nodeOf(gx), rj = nodeOf(gz);
    const ddx = Math.abs(gx - roadC(ri)), ddz = Math.abs(gz - roadC(rj));
    if (ddx > 7 && ddz > 7) { if (ddx < ddz) gx = roadC(ri); else gz = roadC(rj); }
    if (this._clear(u.x, u.z, gx, gz)) { this._drive(u, gx, gz, vmax, dt); return; }
    const ci = nodeOf(u.x), cj = nodeOf(u.z);
    const atNode = Math.hypot(u.x - roadC(ci), u.z - roadC(cj)) < 9;
    if (atNode || u.pi < 0) {
      // choose the next junction: reduce the larger index gap, never straight back
      const ti = nodeOf(gx), tj = nodeOf(gz);
      let ni = ci, nj = cj;
      const di = ti - ci, dj = tj - cj;
      if (di === 0 && dj === 0) { u.pi = ci; u.pj = cj; this._drive(u, gx, gz, vmax, dt); return; }
      if (Math.abs(di) >= Math.abs(dj) && di !== 0) ni += Math.sign(di); else nj += Math.sign(dj);
      u.ni = ni; u.nj = nj; u.pi = ci; u.pj = cj;
    }
    // aim at the right-hand lane of the leg we're on
    let tx = roadC(u.ni), tz = roadC(u.nj);
    const lx = Math.sign(roadC(u.ni) - roadC(u.pi)), lz = Math.sign(roadC(u.nj) - roadC(u.pj));
    tx += -lz * 2.2; tz += lx * 2.2;
    if (!this._clear(u.x, u.z, tx, tz)) { tx = roadC(ci); tz = roadC(cj); }
    this._drive(u, tx, tz, vmax, dt);
  }

  // ---- main update ----------------------------------------------------------
  // p: { x, y, z, vx, vz, speed, crashed, offence (0..1), emoto, hitCop }
  update(dt, p, traffic) {
    this.time += dt;
    const T = this.terrain;
    this.dyn.length = 0;
    this.flash += dt * 9;
    const flashOn = Math.floor(this.flash) % 2 === 0;

    // breadcrumbs for the bike cops
    const tr = this.trail, last = tr[tr.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 1.2) { tr.push({ x: p.x, y: p.groundY, z: p.z }); if (tr.length > 600) { tr.shift(); for (const u of this.units) if (u.bike) u.ti = Math.max(0, u.ti - 1); } }

    // ---- sight
    let seen = false, nearest = 999, watcher = false;
    for (const u of this.units) {
      const d = Math.hypot(u.x - p.x, u.z - p.z);
      if (d < nearest) nearest = d;
      const range = u.heli ? 105 : 95;
      u.sees = d < range && (u.heli ? !T.inCover(p.x, p.z) : !T.losBlocked(u.x, u.z, p.x, p.z));
      if (u.sees && (u.chasing || u.state === 'block')) seen = true;
      if (u.sees && d < 48 && u.state === 'patrol') watcher = true;
    }
    this.nearest = nearest; this.watcher = watcher;
    this.hidden = this.wanted && !seen && T.inCover(p.x, p.z);

    // ---- getting noticed
    if (!this.wanted) {
      if (watcher) {
        const rate = p.offence * 1.25 + (p.emoto ? 0.22 : 0) + (Math.abs(p.speed) > 15 ? 0.45 : 0);
        this.suspicion += (rate > 0 ? rate : -0.35) * dt;
      } else this.suspicion -= 0.4 * dt;
      this.suspicion = clamp(this.suspicion, 0, 1);
      if (this.suspicion >= 1 || p.hitCop) this._startChase();
    }

    // ---- heat
    if (this.wanted) {
      this.seen = seen;
      if (seen) {
        this.seenT += dt * (1 + p.offence * 0.6); this.evade = Math.max(0, this.evade - dt * 2);
        this.lastX = p.x; this.lastZ = p.z;
      } else this.evade += dt * (this.hidden ? 1.6 : 1);
      if (p.hitCop) this.seenT += 8;
      let h = this.heat;
      while (h < 5 && this.seenT >= HEAT_TIME[h + 1]) h++;
      if (h !== this.heat) { this.heat = h; this.maxHeat = Math.max(this.maxHeat, h); if (this.onHeat) this.onHeat(h); }
      this.evadeNeed = 7 + this.heat * 2;
      if (this.evade >= this.evadeNeed) { this._endChase(true); return; }

      // reinforcements
      this.spawnT -= dt;
      const cruisers = this.units.filter((u) => u.car && u.chasing).length;
      if (cruisers < CRUISERS[this.heat] && this.spawnT <= 0) {
        this.spawnT = 3.5;
        const sp = Math.hypot(p.vx, p.vz);
        const u = this._addCruiser('chase'); u.chasing = true;
        this._placeRandom(u, p.x, p.z, 120, 230, sp > 4 ? { x: p.vx / sp, z: p.vz / sp } : null);
      }
      if (this.heat >= 4 && this.units.filter((u) => u.bike).length < this.heat - 3 && this.spawnT <= 0 && this.trail.length > 80) { this.spawnT = 6; this._addBikeCop(p.x, p.z); }
      if (this.heat >= 5 && !this.heli) {
        const m = heliMesh(); this.scene.add(m.g);
        this.heli = { heli: true, mesh: m, x: p.x + 160, y: 70, z: p.z + 160, yaw: 0, chasing: true, state: 'chase', sees: false, age: 0 };
        this.units.push(this.heli);
      }
      // roadblocks
      if (this.heat >= 3) {
        this.blockT -= dt;
        if (this.blockT <= 0) { this.blockT = 14 - this.heat; this._roadblock(p); }
      }
      // busted?
      let grab = 0;
      for (const u of this.units) {
        if (u.heli) continue;
        const d = Math.hypot(u.x - p.x, u.z - p.z);
        if (d < (u.car ? 4.6 : 3) && (Math.abs(p.speed) < 2.4 || p.crashed)) grab = 1;
        else if (p.crashed && d < 10) grab = Math.max(grab, 0.6);
        // sitting still in plain sight: officers get out and walk over
        else if (u.sees && d < 22 && Math.abs(p.speed) < 1.5) grab = Math.max(grab, 0.4);
      }
      this.bust = clamp(this.bust + (grab > 0 ? grab * dt / 1.3 : -dt * 0.8), 0, 1);
      if (this.bust >= 1) { this._endChase(false); return; }
    }

    // ---- move units
    const vmaxCar = CAR_SPEED[Math.max(1, this.heat)];
    for (let k = this.units.length - 1; k >= 0; k--) {
      const u = this.units[k];
      u.age += dt;
      const d = Math.hypot(u.x - p.x, u.z - p.z);
      if (u.car) {
        if (u.state === 'patrol') {
          // amble from junction to junction
          if (Math.hypot(u.x - roadC(u.ni), u.z - roadC(u.nj)) < 9 || u.pi < 0) {
            const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [u.ni + a, u.nj + b]).filter(([a, b]) => a >= 0 && a <= N && b >= 0 && b <= N && !(a === u.pi && b === u.pj));
            const [a, b] = opts[Math.floor(Math.random() * opts.length)];
            u.pi = u.ni; u.pj = u.nj; u.ni = a; u.nj = b;
          }
          const lx = Math.sign(u.ni - u.pi), lz = Math.sign(u.nj - u.pj);
          this._drive(u, roadC(u.ni) - lz * 2.2, roadC(u.nj) + lx * 2.2, 10.5, dt);
          if (d > 330) this._placeRandom(u, p.x, p.z, 140, 280);
        } else if (u.state === 'block') {
          u.speed = 0; u.blockT -= dt;
          if (u.blockT <= 0 || d > 220) { u.state = 'chase'; u.chasing = true; u.pi = -1; }
        } else if (u.state === 'chase') {
          if (u.sees && this._clear(u.x, u.z, p.x, p.z)) {
            const lead = clamp(d / Math.max(8, u.speed), 0, 1.1);
            this._drive(u, p.x + p.vx * lead, p.z + p.vz * lead, vmaxCar, dt);
            u.pi = -1;
          } else this._route(u, seen ? p.x : this.lastX + Math.sin(u.age * 0.4 + k) * (this.seen ? 0 : 40), seen ? p.z : this.lastZ + Math.cos(u.age * 0.3 + k) * (this.seen ? 0 : 40), vmaxCar * 0.92, dt);
          if (d > 380) this._placeRandom(u, p.x, p.z, 130, 220);
        } else if (u.state === 'leave') {
          this._route(u, u.gx, u.gz, 14, dt);
          if (d > 260 || u.age > 40) { if (this.units.filter((q) => q.car).length > 3) { this._remove(u); continue; } u.state = 'patrol'; u.pi = -1; u.ni = nodeOf(u.x); u.nj = nodeOf(u.z); }
        }
        // don't drive through each other
        for (const o of this.units) {
          if (o === u || !o.car) continue;
          const sx = u.x - o.x, sz = u.z - o.z, sd = Math.hypot(sx, sz);
          if (sd < 3.4 && sd > 0.01) { u.x += (sx / sd) * (3.4 - sd) * 0.5; u.z += (sz / sd) * (3.4 - sd) * 0.5; }
        }
        if (traffic) for (const c of traffic.dyn) {
          const sx = u.x - c.x, sz = u.z - c.z, sd = Math.hypot(sx, sz);
          if (sd < 3.2 && sd > 0.01) { u.x += (sx / sd) * (3.2 - sd) * 0.6; u.z += (sz / sd) * (3.2 - sd) * 0.6; u.speed *= 1 - Math.min(1, dt * 2); }
        }
        const m = u.mesh;
        m.g.position.set(u.x, 0, u.z); m.g.rotation.y = u.yaw;
        const lit = u.chasing || u.state === 'block';
        m.red.visible = lit && flashOn; m.blue.visible = lit && !flashOn;
        if (d < 45) {
          const o = u.dynO; o.x = u.x; o.z = u.z; o.c = Math.cos(u.yaw); o.s = Math.sin(u.yaw);
          o.vx = Math.sin(u.yaw) * u.speed; o.vz = Math.cos(u.yaw) * u.speed;
          this.dyn.push(o);
        }
      } else if (u.bike) {
        // ride the player's breadcrumb trail
        const vmax = Math.max(13, Math.min(24, Math.abs(p.topSpeed) * 0.88));
        let tx, ty, tz;
        if (u.sees && d < 16) { tx = p.x; tz = p.z; ty = p.groundY; u.ti = tr.length - 1; }
        else { while (u.ti < tr.length - 1 && Math.hypot(tr[u.ti].x - u.x, tr[u.ti].z - u.z) < 2.5) u.ti++; const t = tr[u.ti]; tx = t.x; ty = t.y; tz = t.z; }
        const want = Math.atan2(tx - u.x, tz - u.z), diff = angDiff(want, u.yaw);
        u.yaw += clamp(diff * 5, -3.2, 3.2) * dt;
        const vt = d < 4 ? 2 : vmax * clamp(1.1 - Math.abs(diff), 0.3, 1);
        u.speed += clamp(vt - u.speed, -12 * dt, 5 * dt);
        u.x += Math.sin(u.yaw) * u.speed * dt; u.z += Math.cos(u.yaw) * u.speed * dt;
        u.y += (Math.max(ty, T.height(u.x, u.z)) - u.y) * Math.min(1, dt * 10);
        const g = u.model.group, r = u.model.spec.rR, lean = clamp(diff * 0.8, -0.6, 0.6) * Math.min(1, u.speed / 8);
        g.position.set(u.x - Math.sin(u.yaw) * 0.55, u.y + r, u.z - Math.cos(u.yaw) * 0.55);
        g.rotation.set(0, u.yaw, -lean, 'YXZ');
        u.spin += (u.speed / r) * dt; u.model.rearWheel.rotation.x = u.spin; u.model.frontWheel.rotation.x = u.spin;
        u.fake.speed = u.speed; u.fake.steer = clamp(diff, -1, 1); u.fake.yaw = u.yaw;
        g.updateMatrixWorld(true);
        u.rider.update(dt, u.fake, u.model, { one: false, no: false, stand: false, drag: false }, u.y);
        if (d > 300) { this._remove(u); continue; }
      } else if (u.heli) {
        const tx = (seen || u.sees ? p.x : this.lastX) - 14, tz = (seen || u.sees ? p.z : this.lastZ) - 10;
        u.x += (tx - u.x) * Math.min(1, dt * 0.9); u.z += (tz - u.z) * Math.min(1, dt * 0.9);
        u.y += (52 + Math.sin(this.time * 0.7) * 3 - u.y) * Math.min(1, dt);
        u.yaw += angDiff(Math.atan2(p.x - u.x, p.z - u.z), u.yaw) * Math.min(1, dt * 2);
        const m = u.mesh;
        m.g.position.set(u.x, u.y, u.z); m.g.rotation.set(0.12, u.yaw, 0, 'YXZ');
        m.rotor.rotation.y += dt * 38;
        // aim the beam at the player
        m.beam.lookAt(p.x, p.y, p.z); m.beam.rotateX(-Math.PI / 2);
        m.beam.position.set(0, 0, 0); m.beam.translateY(-23);
        m.beam.material.opacity = u.sees ? 0.16 : 0.07;
      }
    }
    this.units.sirens = this.wanted;
  }

  _startChase() {
    this.wanted = true; this.heat = 1; this.maxHeat = 1; this.seenT = 0; this.evade = 0; this.bust = 0; this.suspicion = 0;
    this.blockT = 10; this.spawnT = 2;
    // whoever was watching goes after you
    let any = false;
    for (const u of this.units) if (u.car && u.state === 'patrol' && (u.sees || !any)) { if (u.sees) { u.state = 'chase'; u.chasing = true; u.pi = -1; any = true; } }
    if (!any) { const u = this.units.find((q) => q.car); if (u) { u.state = 'chase'; u.chasing = true; u.pi = -1; } }
    if (this.onWanted) this.onWanted();
  }

  _endChase(escaped) {
    const heat = this.maxHeat;
    this.wanted = false; this.heat = 0; this.maxHeat = 0; this.seen = false; this.seenT = 0; this.evade = 0; this.bust = 0; this.suspicion = 0;
    for (let k = this.units.length - 1; k >= 0; k--) {
      const u = this.units[k];
      if (u.heli || u.bike) { this._remove(u); continue; }
      u.chasing = false; u.state = 'leave'; u.age = 0;
      u.gx = u.x + (Math.random() - 0.5) * 500; u.gz = u.z + (Math.random() - 0.5) * 500;
    }
    this.heli = null;
    this.units.sirens = false;
    if (escaped) { if (this.onEscape) this.onEscape(heat); } else if (this.onBusted) this.onBusted(heat);
  }

  // After a bust / respawn: clear the area.
  reset(px, pz) {
    for (let k = this.units.length - 1; k >= 0; k--) {
      const u = this.units[k];
      if (!u.car) { this._remove(u); continue; }
      u.state = 'patrol'; u.chasing = false;
      this._placeRandom(u, px, pz, 150, 400);
    }
    while (this.units.length > 3) this._remove(this.units[this.units.length - 1]);
    this.heli = null; this.wanted = false; this.heat = 0; this.maxHeat = 0; this.suspicion = 0; this.bust = 0; this.evade = 0; this.seenT = 0;
    this.trail.length = 0; this.units.sirens = false;
  }

  _roadblock(p) {
    const sp = Math.hypot(p.vx, p.vz);
    if (sp < 7) return;
    const ax = Math.abs(p.vx) > Math.abs(p.vz);
    // only if the player is actually on a road heading down it
    const ri = nodeOf(p.x), rj = nodeOf(p.z);
    if (ax ? Math.abs(p.z - roadC(rj)) > 7 : Math.abs(p.x - roadC(ri)) > 7) return;
    const dir = Math.sign(ax ? p.vx : p.vz);
    const dist = 95 + sp * 2.2;
    let bx = ax ? p.x + dir * dist : roadC(ri), bz = ax ? roadC(rj) : p.z + dir * dist;
    // mid-block, never inside a junction
    const snap = (v) => { const n = Math.floor(v / PITCH + N / 2); return (n - N / 2) * PITCH + PITCH / 2; };
    if (ax) bx = snap(bx); else bz = snap(bz);
    if (Math.abs(bx) > roadC(N) || Math.abs(bz) > roadC(N)) return;
    for (const o of [-2.75, 2.75]) {
      const u = this._addCruiser('block', ax ? bx : bx + o, ax ? bz + o : bz, ax ? 0 : Math.PI / 2);
      u.blockT = 22; u.chasing = false;
    }
  }
}
