// Civilian traffic: cars follow lanes on the road grid, obey traffic lights,
// queue behind each other and brake for the bike. Also renders parked cars.
import * as THREE from 'three';
import { Batch, mat } from './world/geo.js';
import { N, PITCH, roadC, CURB } from './world/city.js';

const CYCLE = 22;
const STOP = 13.6; // car centre to node centre when waiting at the line
const LANES = [1.55, 4.3];
const _m = new THREE.Matrix4(), _c = new THREE.Color();

// 0 green, 1 yellow, 2 red. axis 0 = travelling along Z, 1 = along X
export function lightState(i, j, axis, time) {
  const t = (time + ((i * 7 + j * 13) % 11) * 2) % CYCLE;
  const own = axis === 0 ? t : (t + CYCLE / 2) % CYCLE;
  return own < 8 ? 0 : own < 10 ? 1 : 2;
}

function carGeometry(type) {
  const paint = new Batch(), trim = new Batch();
  const van = type === 1;
  const len = van ? 4.9 : 4.4, w = 1.84, bodyH = van ? 0.95 : 0.6, cabH = van ? 0.75 : 0.52;
  paint.color(0xffffff).box(0, 0.32, 0, w, bodyH, len, { bottom: true });
  const cabL = van ? 3.4 : 2.3, cabZ = van ? -0.45 : -0.25;
  trim.color(0x1a2430).box(0, 0.32 + bodyH, cabZ, w - 0.22, cabH, cabL);
  paint.box(0, 0.32 + bodyH + cabH, cabZ, w - 0.2, 0.07, cabL + 0.04);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) paint.box(sx * (w / 2 - 0.13), 0.32 + bodyH, cabZ + sz * (cabL / 2 - 0.05), 0.09, cabH, 0.09, { top: false });
  // wheels, bumpers, lights
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) trim.color(0x141416).geom(wheel, mat(sx * (w / 2 - 0.1), 0.33, sz * (len / 2 - 0.85), 0, 0, Math.PI / 2));
  trim.color(0x2a2c30).box(0, 0.3, len / 2, w, 0.25, 0.14).box(0, 0.3, -len / 2, w, 0.25, 0.14);
  trim.color(0xfff4c8).box(-0.62, 0.62, len / 2 + 0.01, 0.34, 0.14, 0.04).box(0.62, 0.62, len / 2 + 0.01, 0.34, 0.14, 0.04);
  trim.color(0xd21a1a).box(-0.64, 0.66, -len / 2 - 0.01, 0.34, 0.12, 0.04).box(0.64, 0.66, -len / 2 - 0.01, 0.34, 0.12, 0.04);
  return { paint: paint.geometry(), trim: trim.geometry(), len };
}

export class Traffic {
  constructor(scene, terrain, city, count) {
    this.scene = scene; this.terrain = terrain; this.city = city;
    this.cars = []; this.dyn = []; this.time = Math.random() * 100;
    this.onNearMiss = null; this.onHonk = null;
    this.group = new THREE.Group(); scene.add(this.group);

    // instanced bodies: [type][0 paint, 1 trim]
    const parked = [city.parked.filter((p) => p.type === 0), city.parked.filter((p) => p.type === 1)];
    const perType = [Math.ceil(count * 0.72), Math.floor(count * 0.28)];
    const paintMat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.inst = [];
    for (let t = 0; t < 2; t++) {
      const g = carGeometry(t), total = parked[t].length + perType[t];
      const paint = new THREE.InstancedMesh(g.paint, paintMat, total);
      const trim = new THREE.InstancedMesh(g.trim, trimMat, total);
      paint.castShadow = trim.castShadow = true; paint.frustumCulled = trim.frustumCulled = false;
      parked[t].forEach((p, k) => {
        _m.copy(mat(p.x, p.y, p.z, 0, p.rot, 0));
        paint.setMatrixAt(k, _m); trim.setMatrixAt(k, _m); paint.setColorAt(k, _c.set(p.color));
      });
      this.inst.push({ paint, trim, base: parked[t].length });
      this.group.add(paint, trim);
      for (let k = 0; k < perType[t]; k++) {
        const car = { type: t, idx: parked[t].length + k, x: 0, z: 0, yaw: 0, speed: 0, vmax: 9 + Math.random() * 4.5, len: g.len, hx: 0.95, hz: g.len / 2, stuck: 0, prevF: 0, hitT: 0, honkT: 0, dynO: null };
        car.dynO = { t: 0, x: 0, z: 0, hx: 0.98, hz: g.len / 2 + 0.05, c: 1, s: 0, y0: 0, y1: t ? 1.95 : 1.45, vx: 0, vz: 0, ref: car, stamp: 0 };
        paint.setColorAt(car.idx, _c.set(city.carColors[Math.floor(Math.random() * city.carColors.length)]));
        this.cars.push(car);
      }
      paint.instanceColor.needsUpdate = true;
    }

    this._buildLights();
    for (const c of this.cars) this._spawn(c, 0, 0, 30, 240);
  }

  // ---- traffic lights --------------------------------------------------
  _buildLights() {
    const poles = new Batch(), heads = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const cx = roadC(i), cz = roadC(j);
      for (const [dx, dz, axis] of [[0, 1, 0], [0, -1, 0], [1, 0, 1], [-1, 0, 1]]) {
        // pole on the far-right corner as seen by an approaching driver
        const rx = -dz, rz = dx;
        const px = cx + dx * 8.9 + rx * 8.9, pz = cz + dz * 8.9 + rz * 8.9;
        if (Math.abs(px) > roadC(N) + 9 || Math.abs(pz) > roadC(N) + 9) continue;
        poles.color(0x33363b).box(px, CURB, pz, 0.16, 5.4, 0.16);
        // arm reaching over the lane
        poles.box(px - rx * 2.2, CURB + 5.2, pz - rz * 2.2, Math.abs(rx) * 4.4 + 0.12, 0.12, Math.abs(rz) * 4.4 + 0.12, { bottom: true });
        const hx = px - rx * 4.2, hz = pz - rz * 4.2;
        poles.color(0x15171a).box(hx, CURB + 4.15, hz, 0.42, 1.2, 0.42, { bottom: true });
        this.terrain.addCircle(px, pz, 0.13, 0, 6);
        heads.push({ i, j, axis, x: hx - dx * 0.23, z: hz - dz * 0.23, state: -1 });
      }
    }
    this.group.add(poles.mesh(new THREE.MeshLambertMaterial({ vertexColors: true }), { cast: true }));
    this.heads = heads;
    const lamp = new THREE.BoxGeometry(0.26, 0.26, 0.26);
    this.lamps = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial(), heads.length * 3);
    this.lamps.frustumCulled = false;
    heads.forEach((h, k) => {
      for (let l = 0; l < 3; l++) { this.lamps.setMatrixAt(k * 3 + l, _m.makeTranslation(h.x, CURB + 5.1 - l * 0.36, h.z)); this.lamps.setColorAt(k * 3 + l, _c.set(0x222222)); }
    });
    this.group.add(this.lamps);
  }

  _updateLights() {
    let dirty = false;
    const ON = [0x2bff5a, 0xffc21a, 0xff2a1a], OFF = [0x0c2a12, 0x2a2208, 0x2a0a08];
    this.heads.forEach((h, k) => {
      const s = lightState(h.i, h.j, h.axis, this.time);
      if (s === h.state) return;
      h.state = s; dirty = true;
      // lamp order top to bottom: red, yellow, green
      this.lamps.setColorAt(k * 3, _c.set(s === 2 ? ON[2] : OFF[2]));
      this.lamps.setColorAt(k * 3 + 1, _c.set(s === 1 ? ON[1] : OFF[1]));
      this.lamps.setColorAt(k * 3 + 2, _c.set(s === 0 ? ON[0] : OFF[0]));
    });
    if (dirty) this.lamps.instanceColor.needsUpdate = true;
  }

  // ---- lane following --------------------------------------------------
  _setSeg(c, ai, aj, bi, bj, s = 12) {
    c.ai = ai; c.aj = aj; c.bi = bi; c.bj = bj;
    c.dx = Math.sign(bi - ai); c.dz = Math.sign(bj - aj);
    c.off = LANES[Math.random() < 0.6 ? 0 : 1];
    c.s = s; c.mode = 0; c.yaw = Math.atan2(c.dx, c.dz);
    this._place(c);
  }

  _place(c) {
    const rx = -c.dz, rz = c.dx;
    c.x = roadC(c.ai) + c.dx * c.s + rx * c.off;
    c.z = roadC(c.aj) + c.dz * c.s + rz * c.off;
  }

  _spawn(c, px, pz, rMin, rMax) {
    for (let tries = 0; tries < 30; tries++) {
      const i = Math.floor(Math.random() * (N + 1)), j = Math.floor(Math.random() * (N + 1));
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => i + a >= 0 && i + a <= N && j + b >= 0 && j + b <= N);
      const [a, b] = dirs[Math.floor(Math.random() * dirs.length)];
      this._setSeg(c, i, j, i + a, j + b, 14 + Math.random() * (PITCH - 30));
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < rMin || d > rMax) continue;
      let clear = true;
      for (const o of this.cars) if (o !== c && Math.hypot(o.x - c.x, o.z - c.z) < 9) { clear = false; break; }
      if (!clear) continue;
      c.speed = c.vmax * 0.8; c.stuck = 0;
      return;
    }
  }

  _nextSeg(c) {
    const i = c.bi, j = c.bj;
    const opts = [];
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + a, nj = j + b;
      if (ni < 0 || ni > N || nj < 0 || nj > N) continue;
      if (ni === c.ai && nj === c.aj) continue;
      const straight = a === c.dx && b === c.dz;
      opts.push({ ni, nj, w: straight ? 3 : 1 });
    }
    let r = Math.random() * opts.reduce((s, o) => s + o.w, 0), pick = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    // bezier through the junction
    const ndx = Math.sign(pick.ni - i), ndz = Math.sign(pick.nj - j);
    const off2 = ndx === c.dx && ndz === c.dz ? c.off : LANES[0];
    const cx = roadC(i), cz = roadC(j);
    c.p0x = c.x; c.p0z = c.z;
    c.p2x = cx + ndx * 12 + -ndz * off2; c.p2z = cz + ndz * 12 + ndx * off2;
    if (ndx === c.dx && ndz === c.dz) { c.p1x = (c.p0x + c.p2x) / 2; c.p1z = (c.p0z + c.p2z) / 2; }
    else { c.p1x = c.dx ? c.p2x : c.p0x; c.p1z = c.dz ? c.p2z : c.p0z; }
    c.tLen = Math.hypot(c.p1x - c.p0x, c.p1z - c.p0z) + Math.hypot(c.p2x - c.p1x, c.p2z - c.p1z);
    c.t = 0; c.mode = 1;
    c.n = { ai: i, aj: j, bi: pick.ni, bj: pick.nj, off: off2 };
  }

  update(dt, player, cops) {
    this.time += dt;
    this._updateLights();
    const cars = this.cars;
    this.dyn.length = 0;
    const px = player.x, pz = player.z;

    for (let k = 0; k < cars.length; k++) {
      const c = cars[k];
      if (Math.hypot(c.x - px, c.z - pz) > 290) this._spawn(c, px, pz, 130, 250);

      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      // ---- what's in front of me?
      let gap = 60;
      const look = 7 + c.speed * 1.7;
      const probe = (ox, oz, halfLen, width) => {
        const dx = ox - c.x, dz = oz - c.z;
        const f = dx * fx + dz * fz;
        if (f <= 0 || f > look + halfLen) return;
        const l = Math.abs(dx * fz - dz * fx);
        if (l < width) gap = Math.min(gap, f - halfLen - c.hz - 1.2);
      };
      for (let q = 0; q < cars.length; q++) if (q !== k) probe(cars[q].x, cars[q].z, cars[q].hz, 1.7);
      probe(px, pz, 0.8, 1.35);
      if (cops) for (const u of cops) if (u.car) probe(u.x, u.z, 2.3, 1.9);

      let target = c.vmax;
      if (c.mode === 0) {
        const stopS = PITCH - STOP, dist = stopS - c.s;
        const st = lightState(c.bi, c.bj, c.dz !== 0 ? 0 : 1, this.time);
        if (dist > -0.5 && (st === 2 || (st === 1 && dist > c.speed * c.speed / 9))) gap = Math.min(gap, dist);
        if (dist < 14) target = Math.min(target, 7.5);
      } else target = 5.5;
      if (c.hitT > 0) { c.hitT -= dt; gap = 0; }
      // sirens nearby: pull up and wait
      if (cops && cops.sirens) { for (const u of cops) if (u.chasing && Math.hypot(u.x - c.x, u.z - c.z) < 38) { gap = Math.min(gap, 2); break; } }

      const safe = Math.sqrt(Math.max(0, 2 * 5 * Math.max(0, gap)));
      target = Math.min(target, safe);
      if (c.speed < target) c.speed = Math.min(target, c.speed + 2.6 * dt);
      else c.speed = Math.max(target, c.speed - 8 * dt);
      if (gap < 0.3) c.speed = 0;
      // gridlock breaker
      if (c.speed < 0.2 && c.hitT <= 0) { c.stuck += dt; if (c.stuck > 9) { c.stuck = 0; this._spawn(c, px, pz, 130, 250); } } else c.stuck = 0;

      // ---- advance
      if (c.mode === 0) {
        c.s += c.speed * dt;
        this._place(c);
        if (c.s >= PITCH - STOP) this._nextSeg(c);
      } else {
        c.t += (c.speed * dt) / c.tLen;
        const t = Math.min(1, c.t), u = 1 - t;
        c.x = u * u * c.p0x + 2 * u * t * c.p1x + t * t * c.p2x;
        c.z = u * u * c.p0z + 2 * u * t * c.p1z + t * t * c.p2z;
        const tx = 2 * u * (c.p1x - c.p0x) + 2 * t * (c.p2x - c.p1x), tz = 2 * u * (c.p1z - c.p0z) + 2 * t * (c.p2z - c.p1z);
        if (tx * tx + tz * tz > 1e-4) c.yaw = Math.atan2(tx, tz);
        if (c.t >= 1) { const n = c.n; this._setSeg(c, n.ai, n.aj, n.bi, n.bj, 12); c.off = n.off; this._place(c); }
      }

      const inst = this.inst[c.type];
      _m.copy(mat(c.x, 0, c.z, 0, c.yaw, 0));
      inst.paint.setMatrixAt(c.idx, _m); inst.trim.setMatrixAt(c.idx, _m);

      // ---- near the player: collider + near-miss bookkeeping
      const dx = px - c.x, dz = pz - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 40 * 40) {
        const o = c.dynO;
        o.x = c.x; o.z = c.z; o.c = Math.cos(c.yaw); o.s = Math.sin(c.yaw);
        o.vx = Math.sin(c.yaw) * c.speed; o.vz = Math.cos(c.yaw) * c.speed;
        this.dyn.push(o);
        const f = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
        const l = Math.abs(dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw));
        if (c.prevF * f < 0 && l < 2.5 && l > 0.9 && c.hitT <= 0) {
          const rel = Math.hypot(player.vx - o.vx, player.vz - o.vz);
          if (rel > 5 && this.onNearMiss) this.onNearMiss(c, l - 0.95, rel);
        }
        c.prevF = f;
        if (c.honkT > 0) c.honkT -= dt;
        if (gap < 3 && d2 < 64 && c.honkT <= 0 && f > 0) { c.honkT = 4 + Math.random() * 3; if (this.onHonk) this.onHonk(c); }
      } else c.prevF = 0;
    }
    for (const inst of this.inst) { inst.paint.instanceMatrix.needsUpdate = true; inst.trim.instanceMatrix.needsUpdate = true; }
  }

  // the bike ran into this car
  bumped(car) { if (car && car.hitT !== undefined) { car.hitT = 2.5; car.speed = 0; } }
}
