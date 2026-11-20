// Detailed bike models from glTF files. They load in the background; until (or unless) one
// arrives, the bike is drawn with the procedural model from bikeModel.js. A loaded model is
// cut into the same moving parts the procedural one has, so poseBike() drives it unchanged:
// wheels spin, the fork steers and compresses, the swingarm follows the rear suspension.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from '../vendor/addons/utils/BufferGeometryUtils.js';

// Which nodes of the file belong to which moving part. Names are the glTF node names
// (three.js strips '.' from them, so 'Spoke.001_8' arrives as 'Spoke001_8').
export const GLB_BIKES = {
  varg: {
    url: 'assets/models/stark-varg.json', // self-contained glTF (buffers and textures embedded)
    credit: '"Stark Varg SM" by Hari Yojuta (sketchfab.com/hariroosi30), CC BY 4.0',
    creditUrl: 'https://sketchfab.com/3d-models/stark-varg-sm-bab4fe6d066342eeb96611f37c616311',
    frontWheel: /^Wheel-F_|^F-Dic_|^F-Hub_|^Spoke/, // spin with the front wheel
    rearWheel: /^R-Wheel_/,                          // spins with the rear wheel (sprocket included)
    wheelF: /^Wheel-F_/, wheelR: /^Wheel-R_/,       // the tyres themselves, for sizing
    forkLower: /^Forks_|^F-Caliper_|^Forks-Gaurd_/,  // slides up and down the steering axis
    fork: /^Handel_|^Liver|^Phone_|^Triple-Clamp_|^High-Fender_|^Fb-Cable_/, // turns with the bars
    swing: /^Swingarm_|^R-Caliper_|^Chain_/,         // pivots with the rear suspension
    forkAxis: /^Forks_/, swingPivot: /^Swingarm_/,
    grips: /^Grip_/, seat: /^Seat_/, pegs: /^Footpegs_/, tail: /^r-Mud-Gaurd_/,
    // customisation: which materials each paint slot recolours
    paint: { plastics: ['Body'], frame: ['Main-Frame', 'Subframe'], swingarm: ['Swingarm'], rims: ['Rims'], seat: ['Seat'], grips: ['Grips'], fork: ['Forks'] },
  },
};

const ready = {};
export const hasGlb = (variant) => !!ready[variant];

// Load every detailed model once. Resolves with the variants that loaded.
//
// Files are glTF JSON with the binary buffer inlined as base64 under "x_bin" and the textures
// as PNG files beside it. The buffer is decoded here and handed to the loader as an in-memory
// GLB: pages that may only fetch their own files (the published artifact) refuse the data: URIs
// a self-contained glTF would need.
export function loadBikeModels() {
  const loader = new GLTFLoader();
  return Promise.all(Object.entries(GLB_BIKES).map(([v, def]) => fetch(def.url)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((json) => new Promise((resolve, reject) => {
      const base = def.url.slice(0, def.url.lastIndexOf('/') + 1);
      loader.parse(toGlb(json), base, (gltf) => { ready[v] = prep(gltf.scene); resolve(v); }, reject);
    }))
    .catch((e) => { console.warn(`bike model ${def.url} did not load; keeping the built-in one`, e); return null; })))
    .then((list) => list.filter(Boolean));
}

// glTF JSON (+ base64 buffer) -> GLB bytes
function toGlb(json) {
  const raw = atob(json.x_bin); delete json.x_bin;
  const bin = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  const pad4 = (n) => (n + 3) & ~3;
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jLen = pad4(text.length), bLen = pad4(bin.length);
  const out = new Uint8Array(12 + 8 + jLen + 8 + bLen), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jLen); out.set(text, 20); text = null;
  dv.setUint32(20 + jLen, bLen, true); dv.setUint32(24 + jLen, 0x004e4942, true);
  out.set(bin, 28 + jLen);
  return out.buffer;
}

// one-off tidy-up of a freshly loaded scene
function prep(scene) {
  const mats = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    // the file ships without normals to stay small: rebuild them, keeping sharp edges sharp
    if (!o.geometry.attributes.normal) o.geometry = toCreasedNormals(o.geometry, 0.6);
    // plain standard materials are cheaper than the physical ones the specular extension makes
    const m = o.material;
    if (m.isMeshPhysicalMaterial) {
      if (!mats.has(m)) mats.set(m, new THREE.MeshStandardMaterial({ name: m.name, color: m.color, map: m.map, metalness: m.metalness, roughness: m.roughness, transparent: m.transparent, opacity: m.opacity, side: m.side, emissive: m.emissive, emissiveMap: m.emissiveMap }));
      o.material = mats.get(m);
    }
    o.castShadow = true;
  });
  return scene;
}

const find = (root, re) => { const out = []; root.traverse((o) => { if (o !== root && re.test(o.name)) out.push(o); }); return out; };
const boxOf = (objs, into) => { const b = new THREE.Box3(), t = new THREE.Box3(); for (const o of objs) { o.updateWorldMatrix(true, true); t.setFromObject(o); b.union(t); } return into ? into.copy(b) : b; };

// Swap a procedural model's look for the detailed one, in place. Safe to call while riding.
export function applyGlb(model) {
  const v = model.spec.variant, src = ready[v], def = GLB_BIKES[v];
  if (!src || model.glb) return false;
  const g = model.group, spec = model.spec;

  // the moving parts back to their rest pose while we measure and re-parent
  model.fork.rotation.set(0, 0, 0); model.forkLower.position.set(0, 0, 0);
  model.rearSusp.position.set(0, 0, 0); model.rearWheel.rotation.set(0, 0, 0); model.frontWheel.rotation.set(0, 0, 0);

  const root = src.clone(true);
  // per-model copies of the paintable materials so each bike can have its own colours
  const paintMats = {};
  const byName = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name;
    for (const [slot, names] of Object.entries(def.paint)) {
      if (!names.includes(n)) continue;
      if (!byName[n]) { byName[n] = o.material.clone(); byName[n].userData.baseMap = o.material.map; (paintMats[slot] = paintMats[slot] || []).push(byName[n]); }
      o.material = byName[n];
    }
  });

  // ---- measure it in its own space
  const W = new THREE.Group(); W.add(root);
  W.updateMatrixWorld(true);
  const fwB = boxOf(find(root, def.wheelF)), rwB = boxOf(find(root, def.wheelR));
  const fC = fwB.getCenter(new THREE.Vector3()), rC = rwB.getCenter(new THREE.Vector3());
  const fwd = fC.clone().sub(rC); fwd.y = 0;
  const s = spec.wheelbase / fwd.length();
  W.rotation.y = -Math.atan2(fwd.x, fwd.z); W.scale.setScalar(s);
  W.updateMatrix();
  W.position.copy(rC).applyMatrix4(W.matrix).negate(); // rear axle on the group origin, like the built-in model
  W.updateMatrix();

  // ---- put it on the bike
  g.traverse((o) => { if (o.isMesh && o.userData.proc) o.visible = false; });
  g.add(W);
  g.updateMatrixWorld(true);
  const gInv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const toG = (p) => p.applyMatrix4(gInv); // world -> bike space
  const boxG = (objs) => { const b = boxOf(objs); const c = [b.min, b.max]; const out = new THREE.Box3(); for (let k = 0; k < 8; k++) out.expandByPoint(toG(new THREE.Vector3(c[k & 1].x, c[(k >> 1) & 1].y, c[(k >> 2) & 1].z))); return out; };

  // steering axis: the fork node's own up axis, through its origin
  const forkNode = find(root, def.forkAxis)[0];
  const axisW = new THREE.Vector3().setFromMatrixColumn(forkNode.matrixWorld, 1);
  const axis = axisW.transformDirection(gInv).normalize();
  if (axis.y < 0) axis.negate();
  const rake = Math.atan2(-axis.z, axis.y);
  const p0 = toG(new THREE.Vector3().setFromMatrixPosition(forkNode.matrixWorld));
  const fA = boxG(find(root, def.wheelF)).getCenter(new THREE.Vector3()); // front axle
  const forkTilt = model.fork.parent;
  forkTilt.position.copy(p0); forkTilt.rotation.set(-rake, 0, 0);
  forkTilt.updateMatrix();
  const toTilt = new THREE.Matrix4().copy(forkTilt.matrix).invert();
  model.frontWheel.position.copy(fA.clone().applyMatrix4(toTilt));
  model.rake = rake;

  // swingarm pivot: the swingarm node's origin
  if (model.swing) {
    const sw = find(root, def.swingPivot)[0];
    const piv = toG(new THREE.Vector3().setFromMatrixPosition(sw.matrixWorld));
    model.swing.position.set(0, piv.y, piv.z);
    model.swing.userData.piv = [0, piv.y, piv.z];
    model.swing.rotation.set(Math.atan2(-piv.y, piv.z), 0, 0);
  }
  g.updateMatrixWorld(true);

  // ---- re-parent the moving parts (attach keeps each part exactly where it is)
  const pivot = (parent) => { const p = new THREE.Group(); parent.add(p); p.updateMatrixWorld(true); return p; };
  const FW = pivot(model.frontWheel), RW = pivot(model.rearWheel);
  for (const o of find(root, def.frontWheel)) FW.attach(o);
  for (const o of find(root, def.rearWheel)) RW.attach(o);
  for (const o of find(root, def.forkLower)) model.forkLower.attach(o);
  for (const o of find(root, def.fork)) model.fork.attach(o);
  if (model.swing) for (const o of find(root, def.swing)) model.swing.attach(o);
  // tyres sized to what the physics rolls on
  const rF = boxG(find(FW, def.wheelF)).getSize(new THREE.Vector3()).y / 2, rR = boxG(find(RW, def.wheelR)).getSize(new THREE.Vector3()).y / 2;
  FW.scale.setScalar(spec.rF / rF); RW.scale.setScalar(spec.rR / rR);

  // ---- where the rider's hands, seat and feet go
  g.updateMatrixWorld(true);
  const toFork = new THREE.Matrix4().copy(model.fork.matrixWorld).invert().multiply(g.matrixWorld);
  const gb = boxG(find(model.fork, def.grips));
  const gy = (gb.min.y + gb.max.y) / 2, gz = (gb.min.z + gb.max.z) / 2, gx = gb.max.x - 0.05;
  model.gripL.position.copy(new THREE.Vector3(gx, gy, gz).applyMatrix4(toFork));
  model.gripR.position.copy(new THREE.Vector3(-gx, gy, gz).applyMatrix4(toFork));
  const sb = boxG(find(root, def.seat));
  model.anchors.seat.set(0, sb.max.y - 0.03, (sb.min.z + sb.max.z) / 2 + 0.04);
  const pb = boxG(find(root, def.pegs));
  const py = (pb.min.y + pb.max.y) / 2, pz = (pb.min.z + pb.max.z) / 2;
  model.anchors.pegL.set(pb.max.x - 0.04, py, pz); model.anchors.pegR.set(-pb.max.x + 0.04, py, pz);
  const tb = boxG(find(root, def.tail));
  model.anchors.tail.set(0, tb.min.y + (tb.max.y - tb.min.y) * 0.55, tb.min.z + 0.04);
  if (model.flag) { model.flag.position.copy(model.anchors.tail); model.flag.position.y -= 0.03; }
  if (model.plate) model.plate.position.set(0, model.anchors.tail.y - 0.075, model.anchors.tail.z - 0.012);

  // wheel LEDs: refit the rings to this model's rims, just outside each rim's sides
  // (the built-in rings sit inside the hub and sprocket of a wider detailed wheel)
  if (model.leds) {
    for (const wheel of [model.rearWheel, model.frontWheel]) {
      wheel.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(wheel.matrixWorld).invert(), box = new THREE.Box3(), v = new THREE.Vector3();
      wheel.traverse((o) => {
        if (!o.isMesh || !o.material || !/Rims/.test(o.material.name)) return;
        const pos = o.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        for (let i = 0; i < pos.count; i += 3) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
      });
      if (box.isEmpty()) continue;
      const rimR = Math.max(box.max.y, -box.min.y, box.max.z, -box.min.z), half = Math.max(box.max.x, -box.min.x);
      for (const ring of model.leds) {
        if (ring.parent !== wheel) continue;
        ring.geometry.dispose();
        ring.geometry = new THREE.TorusGeometry(rimR * 0.97, 0.008, 5, 36).rotateY(Math.PI / 2);
        ring.position.x = Math.sign(ring.position.x) * (half + 0.004);
      }
    }
  }

  model.glb = { root: W, paintMats };
  if (model.lastLook) model.setLook(model.lastLook);
  return true;
}

// recolour the detailed model's paintable parts; called from setLook
export function paintGlb(model, colors, wrap, wrapTex) {
  const pm = model.glb && model.glb.paintMats; if (!pm) return;
  for (const [slot, list] of Object.entries(pm)) {
    for (const m of list) {
      const w = wrap && (slot === 'frame' || slot === 'plastics') ? wrap : null;
      if (w) { m.map = wrapTex(w.id); m.color.set(w.color ?? 0xffffff); }
      else { m.map = m.userData.baseMap || null; m.color.set(colors[slot] != null ? colors[slot] : 0xffffff); }
      m.needsUpdate = true;
    }
  }
}
