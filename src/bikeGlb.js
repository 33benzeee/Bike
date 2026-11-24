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
  v10: {
    url: 'assets/models/santa-cruz-v10.json',
    credit: '"Santa Cruz V10 Downhill Mountain Bicycle" by Arsen Ismailov (sketchfab.com/fdgasd7), CC BY 4.0',
    creditUrl: 'https://sketchfab.com/3d-models/santa-cruz-v10-downhill-mountain-bicycle-65e16e9785de4a019e35f599e47c9ee6',
    frontWheel: /^(1WheelMiddleStud001|1Cube007|1Cube008|1Cube009|1Circle140|Cylinder046|Cylinder047|Circle141|Circle013|1Circle014|Circle142|Plane056)$/,
    rearWheel: /^(1WheelMiddleStud002|1Cube001|1Cube002|1Cube003|1Circle001|Cylinder006|Cylinder007|Circle003|Circle004|1Circle002|Circle005|Plane003|Circle027|1Circle028|Circle029|Circle059)$/,
    wheelF: /^(1WheelMiddleStud001|1Cube007|1Cube008|1Cube009|1Circle140|Cylinder046|Cylinder047|Circle141|Circle013)$/, wheelR: /^(1WheelMiddleStud002|1Cube001|1Cube002|1Cube003|1Circle001|Cylinder006|Cylinder007|Circle003)$/,
    forkLower: /^(1Circle004|Circle007|Circle008|1Plane022|1Plane023|Circle036|Circle037|Circle038|Circle039|Circle040|Circle041|Plane024)$/,
    fork: /^(1Circle003|1Circle005|Circle010|Plane|Circle006|Circle011|Circle012|Cylinder002|1Circle009|Handlebar|Grips|1Cylinder011|1Cylinder012|1Plane003|1Plane004|Plane021|Cube015|Cube016|Cylinder017|Cylinder018|Circle035|Circle042|Circle043|Circle044|Circle045|Circle046|Circle047|Circle048|Circle049|Circle050|Circle051|Circle052|Circle053|Circle054|Circle055|Circle056|Circle057|Circle058|Cube018|Cube036|Circle146|Circle147|Circle148|Circle149|Circle150|cable001|cable002)$/,
    swing: /^(Cube001|1Plane020|1Plane057|Circle016|Circle017|Circle034|Circle143|Circle144|Circle145|Plane058|Cube017|Plane014|Plane015|Gear|1Plane016|1Plane017|1Plane018|Circle030|Circle031|Circle032|Gear004|cable003|cable004)$/,
    // steering axis through the two fork crowns; swingarm pivot at the front of the rear triangle
    axisFrom: [/^1Circle009$/, /^1Circle005$/], swingPivotBox: /^Cube001$/,
    // pedal bike: the cranks turn, the rider's feet follow the pedals
    crank: /^(Plane008|Cylinder010|Circle001|1Circle023|1Cube010|Circle025|Plane009|Circle026|Plane019|Circle033|Plane002|Circle009)$/, bb: /^Circle025$/, pedalL: /^(Plane019|Plane002)$/,
    grips: /^Grips$/, seat: /^(Plane006|Plane007)$/, pegs: /^(Plane019|Plane002)$/, tail: /^(Plane006|Plane007)$/,
    rims: /^Cylinder0(06|07|46|47)_/, // the rims (by mesh name: their material was merged with the cables')
    paint: { frame: ['M_Frame'], swingarm: ['M_Frame'], fork: ['M_Fox40_1'], seat: ['M_Seat'], shock: ['MetalOrange'] },
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
export function toGlb(json) {
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
// precise boxes (from the vertices): a rotated part's own bounding box overstates its size
const boxOf = (objs, into) => { const b = new THREE.Box3(), t = new THREE.Box3(); for (const o of objs) { o.updateWorldMatrix(true, true); t.setFromObject(o, true); b.union(t); } return into ? into.copy(b) : b; };

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
  // exact box in bike space, from the vertices (a world box turned into bike space would grow
  // whenever the bike is yawed or leaned, which shrank the wheels)
  const boxG = (objs) => {
    const out = new THREE.Box3(), m = new THREE.Matrix4(), v = new THREE.Vector3();
    for (const o of objs) { o.updateWorldMatrix(true, true); o.traverse((c) => {
      const pos = c.isMesh && c.geometry.attributes.position; if (!pos) return;
      m.multiplyMatrices(gInv, c.matrixWorld);
      for (let i = 0; i < pos.count; i++) out.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    }); }
    return out;
  };

  // steering axis: through two parts on it (axisFrom), or the fork node's own up axis
  let axis, p0;
  if (def.axisFrom) {
    const lo = boxG(find(root, def.axisFrom[0])).getCenter(new THREE.Vector3()), hi = boxG(find(root, def.axisFrom[1])).getCenter(new THREE.Vector3());
    axis = hi.clone().sub(lo).normalize(); axis.x = 0; axis.normalize(); p0 = hi; p0.x = 0;
  } else {
    const forkNode = find(root, def.forkAxis)[0];
    axis = new THREE.Vector3().setFromMatrixColumn(forkNode.matrixWorld, 1).transformDirection(gInv).normalize();
    p0 = toG(new THREE.Vector3().setFromMatrixPosition(forkNode.matrixWorld));
  }
  if (axis.y < 0) axis.negate();
  const rake = Math.atan2(-axis.z, axis.y);
  const fA = boxG(find(root, def.wheelF)).getCenter(new THREE.Vector3()); // front axle
  const forkTilt = model.fork.parent;
  forkTilt.position.copy(p0); forkTilt.rotation.set(-rake, 0, 0);
  forkTilt.updateMatrix();
  const toTilt = new THREE.Matrix4().copy(forkTilt.matrix).invert();
  model.frontWheel.position.copy(fA.clone().applyMatrix4(toTilt));
  model.rake = rake;

  // swingarm pivot: the swingarm node's origin
  if (model.swing) {
    let piv;
    if (def.swingPivotBox) { const b = boxG(find(root, def.swingPivotBox)); piv = new THREE.Vector3(0, b.min.y + (b.max.y - b.min.y) * 0.55, b.max.z - 0.035); }
    else piv = toG(new THREE.Vector3().setFromMatrixPosition(find(root, def.swingPivot)[0].matrixWorld));
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
  // cranks: re-centre the crank group on this model's bottom bracket, with the left pedal at
  // the angle the rider's pedalling expects (straight down at rotation 0)
  if (def.crank && model.crank) {
    model.crank.rotation.set(0, 0, 0);
    const bb = boxG(find(root, def.bb)).getCenter(new THREE.Vector3()); bb.x = 0;
    const peds = find(root, def.pedalL).map((o) => boxG([o]).getCenter(new THREE.Vector3())), left = peds.sort((a, b) => b.x - a.x)[0];
    model.crank.position.copy(bb); model.crank.updateMatrixWorld(true);
    const inner = pivot(model.crank);
    for (const o of find(root, def.crank)) inner.attach(o);
    const dy = left.y - bb.y, dz = left.z - bb.z;
    model.crankLen = Math.hypot(dy, dz);
    inner.rotation.x = -Math.atan2(-dz, -dy);
    model.anchors.bb.copy(bb);
    model.glbPedalX = left.x;
  }
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
  const pb = model.glbPedalX != null ? new THREE.Box3(model.anchors.bb.clone(), model.anchors.bb.clone()) : boxG(find(root, def.pegs)); // pedals now turn with the cranks
  const py = (pb.min.y + pb.max.y) / 2, pz = (pb.min.z + pb.max.z) / 2;
  const px = model.glbPedalX ?? pb.max.x - 0.04;
  model.anchors.pegL.set(px, py, pz); model.anchors.pegR.set(-px, py, pz);
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
        if (!o.isMesh || !o.material || !(def.rims ? def.rims.test(o.name) : /Rims/.test(o.material.name))) return;
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

  // the dash screen: swap its printed picture for a live canvas (see drawScreen)
  let screen = null;
  g.traverse((o) => { // (the screen has moved onto the fork by now)
    if (screen || !o.isMesh || !o.material || o.material.name !== 'Display' || !o.geometry.attributes.uv) return;
    const uv = o.geometry.attributes.uv; let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 4;
    const m = o.material.clone(); m.map = tex; m.emissiveMap = tex; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.9; o.material = m;
    screen = { cv, ctx: cv.getContext('2d'), tex, rect: [u0 * 512, v0 * 256, u1 * 512, v1 * 256], t: 1 };
  });
  model.screen = screen;
  if (screen) drawScreen(screen, { kmh: 0, mph: false, battery: 1, rangeH: 6, mode: '3' });

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

// The Varg's dash, drawn live in the layout of the original screen: power mode, battery and
// range across the top, the speed arc and number below. sc.rect is the part of the texture the
// screen shows (about 441 x 106 px). d: { kmh, mph, battery 0..1, rangeH, mode }
export function drawScreen(sc, d) {
  const c = sc.ctx, [x0, y0, x1, y1] = sc.rect, W = x1 - x0, H = y1 - y0, k = H / 106;
  const X = (f) => x0 + f * W, Y = (px) => y0 + px * k;
  const teal = '#2ee6b0', dim = '#7d8792', font = (px, w = 800) => `${w} ${Math.max(6, Math.round(px * k))}px system-ui, sans-serif`;
  c.fillStyle = '#05070a'; c.fillRect(0, 0, sc.cv.width, sc.cv.height);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  // top band: three boxes
  c.strokeStyle = '#222a33'; c.lineWidth = 1.5 * k;
  for (const f of [0.34, 0.66]) { c.beginPath(); c.moveTo(X(f), Y(3)); c.lineTo(X(f), Y(38)); c.stroke(); }
  c.fillStyle = dim; c.font = font(7.5, 700);
  c.fillText('POWER MODE', X(0.17), Y(9)); c.fillText('BATTERY', X(0.5), Y(9)); c.fillText('RANGE', X(0.83), Y(9));
  c.fillStyle = '#1d232b'; const pw = 52 * k, ph = 18 * k; c.beginPath(); c.roundRect(X(0.17) - pw / 2, Y(27) - ph / 2, pw, ph, ph / 2); c.fill();
  c.fillStyle = '#eef2f6'; c.font = font(14); c.fillText('\u26A1 ' + d.mode, X(0.17), Y(27.5));
  const pct = Math.round(Math.max(0, Math.min(1, d.battery)) * 100);
  c.fillStyle = pct > 20 ? teal : '#ff5a3c'; c.font = font(20); c.fillText(`${pct}%`, X(0.5), Y(27));
  const mins = Math.max(0, Math.round(d.rangeH * 60)), h = Math.floor(mins / 60), mm = mins % 60;
  c.fillStyle = '#eef2f6'; c.font = font(16); c.fillText(`${h}h ${mm < 10 ? '0' : ''}${mm}m`, X(0.83), Y(27.5));
  // speed arc across the lower part, from 0 on the left to the top of the scale on the right
  const maxV = d.mph ? 100 : 160, v = d.mph ? d.kmh / 1.609 : d.kmh, f = Math.max(0, Math.min(1, v / maxV));
  const r = 175 * k, cx = X(0.5), cy = Y(50) + r, a0 = -Math.PI / 2 - 0.78, a1 = -Math.PI / 2 + 0.78;
  c.lineCap = 'butt'; c.lineWidth = 9 * k;
  c.strokeStyle = '#1d242c'; c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke();
  if (f > 0.003) {
    const g = c.createLinearGradient(cx - r * 0.7, 0, cx + r * 0.7, 0); g.addColorStop(0, '#0f8f6b'); g.addColorStop(1, teal);
    c.strokeStyle = g; c.beginPath(); c.arc(cx, cy, r, a0, a0 + (a1 - a0) * f); c.stroke();
  }
  c.strokeStyle = '#8b95a0'; c.lineWidth = 1.2 * k; c.fillStyle = dim; c.font = font(6.5, 700);
  for (let i = 0; i <= 4; i++) {
    const a = a0 + ((a1 - a0) * i) / 4, ca = Math.cos(a), sa = Math.sin(a);
    c.beginPath(); c.moveTo(cx + ca * (r - 6 * k), cy + sa * (r - 6 * k)); c.lineTo(cx + ca * (r + 6 * k), cy + sa * (r + 6 * k)); c.stroke();
    c.fillText(String(Math.round((maxV * i) / 4)), cx + ca * (r - 14 * k), cy + sa * (r - 14 * k));
  }
  c.fillStyle = '#ffffff'; c.font = font(28); c.fillText(String(Math.round(v)), X(0.5), Y(80));
  c.fillStyle = dim; c.font = font(8, 700); c.fillText(d.mph ? 'mph' : 'km/h', X(0.5), Y(98));
  sc.tex.needsUpdate = true;
}
