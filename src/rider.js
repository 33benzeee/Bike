// The rider: a low-poly figure whose arms and legs are solved with two-bone IK
// every frame so hands stay on the grips and feet on the pegs — until a trick
// (or a crash) says otherwise.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();
const _d = V(), _p = V(), _t = V();
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
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 9), mats.helmet); helmet.scale.set(1, 1.04, 1.16); helmet.castShadow = true; this.head.add(helmet);
    const visor = boxM(0.2, 0.085, 0.1, mats.visor, this.head); visor.position.set(0, 0.012, 0.105);
    const chin = boxM(0.17, 0.08, 0.12, mats.helmet, this.head); chin.position.set(0, -0.075, 0.1);
    const peak = boxM(0.2, 0.012, 0.14, mats.helmet, this.head); peak.position.set(0, 0.095, 0.14); peak.rotation.x = -0.25;
    const neck = boxM(0.09, 0.1, 0.09, mats.hoodie, this.torso); neck.position.set(0, TORSO + 0.03, 0);

    this.arm = [0, 1].map(() => ({ up: limb(0.047, mats.hoodie), fore: limb(0.04, mats.hoodie), hand: boxM(0.075, 0.09, 0.085, mats.gloves), mid: V(), end: V(), root: V(), target: V() }));
    this.leg = [0, 1].map(() => ({ up: limb(0.072, mats.pants), fore: limb(0.054, mats.pants), foot: boxM(0.095, 0.075, 0.25, mats.shoes), mid: V(), end: V(), root: V(), target: V() }));

    this.w = { one: 0, no: 0, stand: 0, drag: 0, stop: 0, air: 0 };
    this.hip = V(); this.torsoPitch = 0.3; this.t = 0; this.crankA = 0;
    this.firstPerson = false;
    this.ragdoll = false;
    this._gl = V(); this._gr = V(); this._foot = V();
  }

  setFirstPerson(on) {
    this.firstPerson = on;
    this.head.visible = !on;
  }

  // parent: bike group while riding, the scene while tumbling
  setRagdoll(on, scene, bikeGroup) {
    if (on === this.ragdoll) return;
    this.ragdoll = on;
    (on ? scene : bikeGroup).add(this.group);
    if (!on) { this.group.position.set(0, 0, 0); this.group.rotation.set(0, 0, 0); }
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
    hip.x = phys.steer * 0.02 + w.stop * 0.04;
    this.torso.position.copy(hip);
    this.torso.rotation.set(this.torsoPitch, phys.steer * 0.12 * (1 - w.no), -phys.steer * 0.06 - w.one * 0.08, 'YXZ');
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
      const no = w.no, one = s === 1 ? w.one * (1 - no) : 0;
      if (no > 0.01) { _t.copy(a.root); _t.x += sx * 0.46; _t.y += 0.2 + Math.sin(this.t * 5 + s) * 0.03; _t.z -= 0.08; a.target.lerp(_t, no); }
      if (one > 0.01) { _t.copy(a.root); _t.x += sx * 0.3; _t.y += 0.44 + Math.sin(this.t * 10) * 0.04; _t.z += 0.06; a.target.lerp(_t, one); }
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

  // Tumbling after a crash. rag = physics ragdoll state.
  updateRagdoll(dt, rag) {
    this.t += dt;
    const g = this.group;
    g.position.set(rag.x, rag.y, rag.z);
    const resting = rag.rest > 0.15;
    let rot = rag.rot;
    if (resting) { rot = Math.round((rag.rot - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2; rag.rot += (rot - rag.rot) * Math.min(1, dt * 8); rot = rag.rot; }
    g.rotation.set(rot, rag.yaw, 0, 'YXZ');
    const flail = resting ? 0 : 1, t = this.t;
    this.torso.position.set(0, 0, 0);
    this.torso.rotation.set(0.1 * flail * Math.sin(t * 6), 0, 0);
    this.head.rotation.set(0.2, 0, 0);
    this.torso.updateMatrix();
    for (let s = 0; s < 2; s++) {
      const a = this.arm[s], sx = s === 0 ? 1 : -1;
      a.root.set(sx * SHOULDER_W, TORSO - 0.04, 0).applyMatrix4(this.torso.matrix);
      a.target.copy(a.root); a.target.x += sx * 0.42; a.target.y += 0.12 + 0.3 * flail * Math.sin(t * 8 + s * 2); a.target.z += 0.12 + 0.25 * flail * Math.cos(t * 7 + s);
      _p.set(sx, -0.3, -0.6);
      ik(a.root, a.target, L_UPPER, L_FORE, _p, a.mid, a.end);
      seg(a.up, a.root, a.mid); seg(a.fore, a.mid, a.end);
      a.hand.position.copy(a.end); a.hand.quaternion.copy(a.fore.quaternion);
      const l = this.leg[s];
      l.root.set(sx * HIP_W, -0.02, 0);
      l.target.set(sx * 0.2, -0.78, 0.15 + 0.3 * flail * Math.sin(t * 7 + s * 3));
      _p.set(sx * 0.3, 0.2, 1);
      ik(l.root, l.target, L_THIGH, L_SHIN, _p, l.mid, l.end);
      seg(l.up, l.root, l.mid); seg(l.fore, l.mid, l.end);
      l.foot.position.copy(l.end); l.foot.position.z += 0.06; l.foot.rotation.set(0, 0, 0);
    }
  }

  headWorld(out) {
    return this.head.getWorldPosition(out);
  }
}
