// The rider: a low-poly figure whose arms and legs are solved with two-bone IK
// every frame so hands stay on the grips and feet on the pegs — until a trick
// (or a crash) says otherwise.
import * as THREE from 'three';
import { buildHelmet } from './helmets.js';
import { circleVsObstacle } from './world/terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();
const _d = V(), _p = V(), _t = V(), _f = V();
const _m = new THREE.Matrix4(), _hit = { nx: 0, nz: 0 };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const L_UPPER = 0.31, L_FORE = 0.3, L_THIGH = 0.45, L_SHIN = 0.47;
const SHOULDER_W = 0.19, HIP_W = 0.1, TORSO = 0.48;

function ik(a, t, l1, l2, pole, mid, end) {
  _d.subVectors(t, a);
  let dist = _d.length();
  if (dist < 1e-5) { _d.set(0, -1, 0); dist = 1e-5; }
  _d.divideScalar(dist);
  const dc = clamp(dist, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.004);
  const x = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-6) _p.set(1, 0, 0);
  _p.normalize();
  mid.copy(a).addScaledVector(_d, x).addScaledVector(_p, h);
  end.copy(a).addScaledVector(_d, dc);
}

function seg(mesh, a, b) {
  _d.subVectors(b, a);
  const len = _d.length() || 1e-5;
  mesh.position.copy(a).addScaledVector(_d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, _d.divideScalar(len));
  mesh.scale.y = len;
}

export const OUTFITS = {
  hoodie: 0x2a2e37, pants: 0x1f2126, shoes: 0xf0f0f0, gloves: 0x111111, helmet: 0xf4f4f4, visor: 0x15181d, skin: 0xd8a47c, pack: 0x8a1f1f,
};

export class Rider {
  constructor(colors = OUTFITS) {
    this.group = new THREE.Group();
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.05, ...o });
    const mats = {
      hoodie: M(colors.hoodie), pants: M(colors.pants), shoes: M(colors.shoes), gloves: M(colors.gloves),
      helmet: M(colors.helmet, { roughness: 0.3, metalness: 0.2 }), visor: M(colors.visor, { roughness: 0.15, metalness: 0.6 }), pack: M(colors.pack),
    };
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 7);
    const limb = (r, m) => { const me = new THREE.Mesh(cyl, m); me.scale.set(r, 1, r * 1.05); me.castShadow = true; this.group.add(me); return me; };
    const boxM = (sx, sy, sz, m, parent = this.group) => { const me = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); me.castShadow = true; parent.add(me); return me; };

    // torso + head hang off a hip pivot
    this.torso = new THREE.Group(); this.group.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.155, TORSO, 8), mats.hoodie);
    chest.scale.z = 0.62; chest.position.y = TORSO / 2 + 0.01; chest.castShadow = true; this.torso.add(chest);
    const hips = boxM(0.3, 0.16, 0.2, mats.pants, this.torso); hips.position.y = 0.0;
    const pack = boxM(0.24, 0.3, 0.1, mats.pack, this.torso); pack.position.set(0, 0.28, -0.14);
    const hood = boxM(0.2, 0.1, 0.12, mats.hoodie, this.torso); hood.position.set(0, TORSO - 0.02, -0.1);
    this.head = new THREE.Group(); this.head.position.set(0, TORSO + 0.15, 0.02); this.torso.add(this.head);
    const helm = buildHelmet(mats.helmet, mats.visor); this.head.add(helm.group);
    const neck = boxM(0.09, 0.1, 0.09, mats.hoodie, this.torso); neck.position.set(0, TORSO + 0.03, 0);
    this.helmetMat = mats.helmet; this.visorMat = mats.visor; // restyled by the helmet the player wears
    this.helmetEyes = helm.eyes;

    this.arm = [0, 1].map(() => ({ up: limb(0.047, mats.hoodie), fore: limb(0.04, mats.hoodie), hand: boxM(0.075, 0.09, 0.085, mats.gloves), mid: V(), end: V(), root: V(), target: V() }));
    this.leg = [0, 1].map(() => ({ up: limb(0.072, mats.pants), fore: limb(0.054, mats.pants), foot: boxM(0.095, 0.075, 0.25, mats.shoes), mid: V(), end: V(), root: V(), target: V() }));

    this.w = { one: 0, no: 0, stand: 0, drag: 0, hand: 0, stop: 0, air: 0 };
    this.hip = V(); this.torsoPitch = 0.3; this.t = 0; this.crankA = 0;
    this.firstPerson = false;
    this.ragdoll = false; this.walking = false;
    this._gl = V(); this._gr = V(); this._hand = new THREE.Vector3(); this._foot = V();
  }

  setFirstPerson(on) {
    this.firstPerson = on;
    this.head.visible = !on;
  }

  // ---- ragdoll: 13 point masses held together by distance constraints
  // (verlet), colliding with the ground and walls. Started from the exact pose
  // and motion the rider had at the moment of the crash.
  beginRagdoll(scene, bikeGroup, phys, terrain) {
    if (this.ragdoll) return;
    this.ragdoll = true; this.terrain = terrain;
    const P = [V(), V(), V(), V(), V(), V(), V(), V(), V(), V(), V(), V(), V()];
    P[0].set(0, TORSO + 0.15, 0.02).applyMatrix4(this.torso.matrix);
    for (let s = 0; s < 2; s++) {
      P[1 + s].copy(this.arm[s].root); P[5 + s].copy(this.arm[s].mid); P[7 + s].copy(this.arm[s].end);
      P[3 + s].copy(this.leg[s].root); P[9 + s].copy(this.leg[s].mid); P[11 + s].copy(this.leg[s].end);
    }
    for (const p of P) p.applyMatrix4(bikeGroup.matrixWorld);
    // velocities: the crash throw plus the spin the bike had
    const rg = phys.rag, hx = Math.sin(phys.yaw), hz = Math.cos(phys.yaw);
    const cx = (P[3].x + P[4].x) / 2, cy = (P[3].y + P[4].y) / 2, cz = (P[3].z + P[4].z) / 2;
    const w = clamp(phys.pitchVel + (phys.crashReason === 'endo' ? -5 : phys.crashReason === 'loopout' ? 2.5 : -2), -7, 7);
    const dt = 1 / 120;
    this.prev = P.map((p) => {
      const rs = (p.x - cx) * hx + (p.z - cz) * hz, ry = p.y - cy;
      const vs = -w * ry, vy = w * rs;
      const j = () => (Math.random() - 0.5) * 1.5;
      return V().set(p.x - (rg.vx + hx * vs + j()) * dt, p.y - (rg.vy + vy + j()) * dt, p.z - (rg.vz + hz * vs + j()) * dt);
    });
    this.pts = P;
    const link = (a, b, min) => ({ a, b, d: P[a].distanceTo(P[b]), min: !!min });
    this.links = [link(1, 2), link(3, 4), link(1, 3), link(2, 4), link(1, 4), link(2, 3), link(0, 1), link(0, 2), link(0, 3), link(0, 4)];
    for (let s = 0; s < 2; s++) {
      this.links.push({ a: 1 + s, b: 5 + s, d: L_UPPER }, { a: 5 + s, b: 7 + s, d: L_FORE }, { a: 3 + s, b: 9 + s, d: L_THIGH }, { a: 9 + s, b: 11 + s, d: L_SHIN });
      // keep limbs from folding flat or passing through the body
      this.links.push({ a: 1 + s, b: 7 + s, d: 0.22, min: true }, { a: 3 + s, b: 11 + s, d: 0.35, min: true }, { a: 0, b: 7 + s, d: 0.2, min: true }, { a: 9 + s, b: 2 - s, d: 0.3, min: true });
    }
    this.links.push({ a: 9, b: 10, d: 0.14, min: true }, { a: 11, b: 12, d: 0.14, min: true });
    scene.add(this.group);
    this.group.position.set(0, 0, 0); this.group.rotation.set(0, 0, 0);
    this.head.visible = true;
  }

  // how fast the tumbling body is still moving (m/s)
  ragdollSpeed() {
    if (!this.ragdoll) return 0;
    let v = 0;
    for (let i = 0; i < this.pts.length; i++) v = Math.max(v, this.pts[i].distanceTo(this.prev[i]) * 120);
    return v;
  }

  // ---- on foot
  beginWalk(scene) {
    this.ragdoll = false; this.walking = true;
    scene.add(this.group);
    this.head.visible = true;
  }

  // f: { x, y, z, yaw, speed, phase, rise } — rise 0..1 is getting up off the ground
  updateWalk(dt, f) {
    const g = this.group, sp = Math.min(1, Math.abs(f.speed) / 4.8), up = f.rise;
    g.position.set(f.x, f.y, f.z); g.rotation.set(0, f.yaw, 0);
    const bob = Math.abs(Math.sin(f.phase)) * 0.035 * sp;
    this.torso.position.set(0, 0.34 + 0.56 * up + bob, -0.1 * (1 - up));
    const cuffed = !!f.cuffed; // hands held behind the back, head down
    this.torso.rotation.set(0.06 + sp * 0.16 + (1 - up) * 0.9 + (cuffed ? 0.1 : 0), Math.sin(f.phase) * 0.12 * sp, 0, 'YXZ');
    this.head.rotation.set(cuffed ? 0.32 : -(1 - up) * 0.6 - sp * 0.1, 0, 0);
    this.torso.updateMatrix();
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? 1 : -1, a = f.phase + (s ? Math.PI : 0), dir = f.speed < 0 ? -1 : 1;
      const l = this.leg[s];
      l.root.set(sx * HIP_W, -0.02, 0).applyMatrix4(this.torso.matrix);
      // swing forward lifted, push back planted
      l.target.set(sx * 0.11, 0.07 + Math.max(0, -Math.sin(a)) * 0.2 * sp, Math.cos(a) * 0.34 * sp * dir + 0.02);
      _p.set(sx * 0.15, 0.3, 1);
      ik(l.root, l.target, L_THIGH, L_SHIN, _p, l.mid, l.end);
      seg(l.up, l.root, l.mid); seg(l.fore, l.mid, l.end);
      l.foot.position.copy(l.end); l.foot.position.z += 0.06; l.foot.position.y -= 0.03; l.foot.rotation.set(0, 0, 0);
      const ar = this.arm[s];
      ar.root.set(sx * SHOULDER_W, TORSO - 0.04, 0).applyMatrix4(this.torso.matrix);
      if (cuffed) { ar.target.set(sx * 0.045, 0.1, -0.2).applyMatrix4(this.torso.matrix); _p.set(sx * 1.2, 0.1, -1); }
      else { ar.target.copy(ar.root); ar.target.x += sx * 0.07; ar.target.y -= 0.5 - sp * 0.08; ar.target.z += 0.06 - Math.cos(a) * 0.26 * sp * dir + (1 - up) * 0.3; _p.set(sx * 0.4, -0.2, -1); }
      ik(ar.root, ar.target, L_UPPER, L_FORE, _p, ar.mid, ar.end);
      seg(ar.up, ar.root, ar.mid); seg(ar.fore, ar.mid, ar.end);
      ar.hand.position.copy(ar.end); ar.hand.quaternion.copy(ar.fore.quaternion);
    }
  }

  // back onto the bike, from a ragdoll or from walking
  endRagdoll(bikeGroup) {
    if (!this.ragdoll && !this.walking) return;
    this.ragdoll = false; this.walking = false;
    bikeGroup.add(this.group);
    this.group.position.set(0, 0, 0); this.group.rotation.set(0, 0, 0);
    this.head.visible = !this.firstPerson;
  }

  updateRagdoll(dt, rag) {
    const P = this.pts, Q = this.prev, T = this.terrain;
    const n = Math.max(1, Math.min(6, Math.round(dt * 120))), h = dt / n;
    for (let it = 0; it < n; it++) {
      for (let i = 0; i < P.length; i++) {
        const p = P[i], q = Q[i];
        const vx = (p.x - q.x) * 0.998, vy = (p.y - q.y) * 0.998 - 9.81 * h * h, vz = (p.z - q.z) * 0.998;
        q.copy(p); p.x += vx; p.y += vy; p.z += vz;
      }
      for (let k = 0; k < 5; k++) {
        for (let c = 0; c < this.links.length; c++) {
          const l = this.links[c], a = P[l.a], b = P[l.b];
          _d.subVectors(b, a);
          const len = _d.length() || 1e-6;
          if (l.min && len >= l.d) continue;
          _d.multiplyScalar(((len - l.d) / len) * 0.5);
          a.add(_d); b.sub(_d);
        }
      }
      for (let i = 0; i < P.length; i++) {
        const p = P[i], q = Q[i], r = i === 0 ? 0.14 : 0.09;
        const g = T.height(p.x, p.z) + r;
        if (p.y < g) {
          // land, lose most of the bounce, scrub speed along the ground
          const vy = p.y - q.y;
          p.y = g; q.y = g + vy * 0.25;
          q.x += (p.x - q.x) * 0.1; q.z += (p.z - q.z) * 0.1;
        }
        if (i < 5 || i > 10) T.query(p.x, p.z, 0.3, (o) => {
          if (o.carOnly || o.y1 < p.y - 0.05) return;
          const pen = circleVsObstacle(o, p.x, p.z, 0.12, _hit);
          if (pen > 0) { p.x += _hit.nx * pen; p.z += _hit.nz * pen; }
        });
      }
    }
    // draw the body through the points
    const hipM = _t.addVectors(P[3], P[4]).multiplyScalar(0.5);
    const up = _p.addVectors(P[1], P[2]).multiplyScalar(0.5).sub(hipM).normalize();
    const left = _d.subVectors(P[1], P[2]).normalize();
    const fwd = _f.crossVectors(left, up).normalize();
    left.crossVectors(up, fwd);
    _m.makeBasis(left, up, fwd);
    this.torso.quaternion.setFromRotationMatrix(_m);
    this.torso.position.copy(hipM);
    this.head.rotation.set(0.15, 0, 0);
    for (let s = 0; s < 2; s++) {
      const a = this.arm[s], l = this.leg[s];
      seg(a.up, P[1 + s], P[5 + s]); seg(a.fore, P[5 + s], P[7 + s]);
      a.hand.position.copy(P[7 + s]); a.hand.quaternion.copy(a.fore.quaternion);
      seg(l.up, P[3 + s], P[9 + s]); seg(l.fore, P[9 + s], P[11 + s]);
      l.foot.position.copy(P[11 + s]); l.foot.quaternion.copy(l.fore.quaternion);
    }
    // the camera and the cops track the body, not the scripted estimate
    rag.x = hipM.x; rag.y = hipM.y; rag.z = hipM.z;
  }

  // tr: { one, no, stand, drag } booleans. ground: world Y under the rear wheel.
  update(dt, phys, model, tr, ground) {
    this.t += dt;
    const w = this.w, k = Math.min(1, dt * 9);
    const air = !phys.rearContact && !phys.frontContact && phys.airTime > 0.1;
    const stopped = Math.abs(phys.speed) < 0.7 && phys.rearContact && phys.frontContact && !tr.stand;
    w.one += ((tr.one ? 1 : 0) - w.one) * k;
    w.no += ((tr.no ? 1 : 0) - w.no) * k;
    w.stand += ((tr.stand ? 1 : 0) - w.stand) * k;
    w.drag += ((tr.drag ? 1 : 0) - w.drag) * k;
    w.hand += ((tr.hand ? 1 : 0) - w.hand) * Math.min(1, dt * 6);
    w.stop += ((stopped ? 1 : 0) - w.stop) * Math.min(1, dt * 6);
    w.air += ((air ? 1 : 0) - w.air) * Math.min(1, dt * 7);

    const A = model.anchors, cls = model.style;
    const lean = phys.comShift, hop = phys.hopCharge / 0.3;
    const wheelie = clamp(phys.pitch, -0.7, 1.2);
    const standG = w.stand * (1 - w.air), superman = w.stand * w.air;

    // ---- hips & torso
    const base = cls === 'emoto' ? 0.3 : cls === 'moped' ? 0.2 : cls === 'mtb' ? 0.52 : 0.36;
    let pitch = base + (wheelie > 0 ? wheelie * 0.5 : wheelie * 0.35) - lean * 0.2 + hop * 0.25 - w.no * 0.3 + standG * 0.5 + superman * 0.85;
    pitch = clamp(pitch, -0.25, 1.35);
    this.torsoPitch += (pitch - this.torsoPitch) * Math.min(1, dt * 10);
    const hip = this.hip;
    hip.set(0, A.seat.y + 0.09, A.seat.z - 0.02);
    hip.z += -lean * 0.11 - Math.max(0, wheelie) * 0.06;
    hip.y += -hop * 0.07 + standG * 0.43 + superman * 0.28 + Math.abs(lean) * 0.02;
    hip.z += standG * 0.08 - superman * 0.25;
    // hand drag: hang off the left side, shoulder down towards the tarmac
    const handG = w.hand * (1 - w.air);
    hip.x = phys.steer * 0.02 + w.stop * 0.04 + handG * 0.22;
    hip.y -= handG * 0.1;
    this.torso.position.copy(hip);
    this.torso.rotation.set(this.torsoPitch + handG * 0.25, phys.steer * 0.12 * (1 - w.no) + handG * 0.35, -phys.steer * 0.06 + w.one * 0.08 - handG * 0.95, 'YXZ');
    this.head.rotation.set(clamp(0.12 + phys.pitch - this.torsoPitch, -0.9, 0.8), phys.steer * 0.3, 0);
    this.torso.updateMatrix();

    // ---- arms
    model.fork.updateMatrix();
    const ft = model.fork.parent; ft.updateMatrix();
    this._gl.copy(model.gripL.position).applyMatrix4(model.fork.matrix).applyMatrix4(ft.matrix);
    this._gr.copy(model.gripR.position).applyMatrix4(model.fork.matrix).applyMatrix4(ft.matrix);
    for (let s = 0; s < 2; s++) {
      const a = this.arm[s], sx = s === 0 ? 1 : -1;
      a.root.set(sx * SHOULDER_W, TORSO - 0.04, 0).applyMatrix4(this.torso.matrix);
      a.target.copy(s === 0 ? this._gl : this._gr);
      a.target.y += 0.02;
      // free-hand poses
      const no = w.no, one = s === 0 ? w.one * (1 - no) : 0;
      if (no > 0.01) { _t.copy(a.root); _t.x += sx * 0.46; _t.y += 0.2 + Math.sin(this.t * 5 + s) * 0.03; _t.z -= 0.08; a.target.lerp(_t, no); }
      if (one > 0.01) { _t.copy(a.root); _t.x += sx * 0.3; _t.y += 0.44 + Math.sin(this.t * 10) * 0.04; _t.z += 0.06; a.target.lerp(_t, one); }
      const hd = s === 0 ? w.hand * (1 - no) : 0;
      if (hd > 0.01) {
        if (w.air < 0.5 && ground !== undefined) {
          // left glove on the tarmac beside the bike, a little behind the shoulder
          const g = model.group, hx = Math.sin(phys.yaw), hz = Math.cos(phys.yaw), back = A.seat.z - 0.1;
          this._hand.set(g.position.x + hz * 0.62 + hx * back, ground + 0.05, g.position.z - hx * 0.62 + hz * back);
          g.worldToLocal(this._hand);
          a.target.lerp(this._hand, hd * (1 - w.air));
        } else { _t.copy(a.root); _t.x += 0.25; _t.y -= 0.55; _t.z -= 0.1; a.target.lerp(_t, hd); } // dangling in the air
      }
      _p.set(sx * 1, -0.6, -0.5);
      ik(a.root, a.target, L_UPPER, L_FORE, _p, a.mid, a.end);
      seg(a.up, a.root, a.mid); seg(a.fore, a.mid, a.end);
      a.hand.position.copy(a.end); a.hand.quaternion.copy(a.fore.quaternion);
    }

    // ---- legs
    if (model.crank) this.crankA = model.crank.rotation.x;
    for (let s = 0; s < 2; s++) {
      const l = this.leg[s], sx = s === 0 ? 1 : -1;
      l.root.set(sx * HIP_W, -0.02, 0).applyMatrix4(this.torso.matrix);
      const peg = s === 0 ? A.pegL : A.pegR;
      l.target.copy(peg);
      if (model.crank) {
        // feet ride the pedals
        const r = model.crankLen * (s === 0 ? -1 : 1);
        l.target.set(peg.x, A.bb.y + r * Math.cos(this.crankA), A.bb.z + r * Math.sin(this.crankA));
      }
      l.target.y += 0.085; l.target.z -= 0.03;
      if (standG > 0.01) { _t.set(sx * 0.07, A.seat.y + 0.1, A.seat.z + (s ? 0.1 : -0.06)); l.target.lerp(_t, standG); }
      if (superman > 0.01) { _t.copy(l.root); _t.x += sx * 0.04; _t.y += 0.06; _t.z -= 0.86; l.target.lerp(_t, superman); }
      if (s === 0) {
        const down = Math.max(w.drag * (1 - w.air), w.stop);
        if (down > 0.01 && ground !== undefined) {
          // plant / drag the left foot on the tarmac
          const g = model.group;
          const hx = Math.sin(phys.yaw), hz = Math.cos(phys.yaw);
          const back = w.drag > w.stop ? -0.25 : A.seat.z + 0.15;
          this._foot.set(g.position.x + hz * 0.34 + hx * back, ground + 0.09, g.position.z - hx * 0.34 + hz * back);
          g.worldToLocal(this._foot);
          l.target.lerp(this._foot, down);
        }
        const out = w.drag * w.air;
        if (out > 0.01) { _t.copy(l.root); _t.x += 0.72; _t.y += 0.1; _t.z += 0.3; l.target.lerp(_t, out); }
      }
      _p.set(sx * 0.35, 0.35, 1);
      ik(l.root, l.target, L_THIGH, L_SHIN, _p, l.mid, l.end);
      seg(l.up, l.root, l.mid); seg(l.fore, l.mid, l.end);
      l.foot.position.copy(l.end); l.foot.position.z += 0.06; l.foot.position.y -= 0.03;
      l.foot.rotation.set(superman * 1.2 + (s === 0 ? w.drag * (1 - w.air) * 0.4 : 0), 0, 0);
    }
  }

  headWorld(out) {
    return this.head.getWorldPosition(out);
  }
}
