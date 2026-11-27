// Procedural bike models. Local frame: origin at the rear axle, +Z forward,
// +Y up, +X to the rider's left. Everything is built from tubes and boxes.
// Geometry is sorted into named paint slots (frame, plastics, seat, fork...)
// so each can be recoloured, wrapped or left stock.
import * as THREE from 'three';
import { Batch, between, mat, canvasTexture } from './world/geo.js';
import { applyGlb, hasGlb, paintGlb } from './bikeGlb.js';

const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const CYL12 = new THREE.CylinderGeometry(1, 1, 1, 12);
const CYL20 = new THREE.CylinderGeometry(1, 1, 1, 20);
const BOX = new THREE.BoxGeometry(1, 1, 1);

const tube = (b, a, c, r, g = CYL6) => b.geom(g, between(a[0], a[1], a[2], c[0], c[1], c[2], r));
const tube2 = (b, a, c, r) => { tube(b, a, c, r); tube(b, [-a[0], a[1], a[2]], [-c[0], c[1], c[2]], r); };
const box = (b, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => b.geom(BOX, mat(x, y, z, rx, ry, rz, sx, sy, sz));
// disc / cylinder with its axis along X
const disc = (b, x, y, z, r, w, g = CYL12) => b.geom(g, mat(x, y, z, 0, 0, Math.PI / 2, r, w, r));

// [metalness, roughness] per paint slot
const SLOTS = { frame: [0.45, 0.38], plastics: [0.25, 0.45], seat: [0.05, 0.85], fork: [0.6, 0.35], swingarm: [0.6, 0.4], bars: [0.5, 0.4], grips: [0, 0.9], rims: [0.6, 0.35], shock: [0.5, 0.4], detail: [0.35, 0.55] };

// ---- wrap + flag textures (drawn once, monochrome so any tint works) -----------
const texCache = {};
export function wrapTexture(id) {
  if (texCache[id]) return texCache[id];
  const R = (a, b) => a + Math.random() * (b - a);
  const t = canvasTexture(256, (c, s) => {
    const g = (v) => `rgb(${v},${v},${v})`;
    if (id === 'galaxy') {
      c.fillStyle = g(120); c.fillRect(0, 0, s, s);
      for (let k = 0; k < 10; k++) { c.fillStyle = `rgba(0,0,0,${R(0.2, 0.45)})`; c.beginPath(); c.ellipse(R(0, s), R(0, s), R(30, 80), R(20, 50), R(0, 3), 0, 6.3); c.fill(); }
      for (let k = 0; k < 26; k++) { const x = R(0, s), y = R(0, s), r = R(20, 70); const gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${R(0.25, 0.6)})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, 2 * r, 2 * r); }
      c.fillStyle = '#fff'; for (let k = 0; k < 140; k++) c.fillRect(R(0, s), R(0, s), R(1, 2.6), R(1, 2.6));
    } else if (id === 'camo') {
      c.fillStyle = g(150); c.fillRect(0, 0, s, s);
      for (const v of [70, 230, 105]) for (let k = 0; k < 16; k++) { c.fillStyle = g(v); c.beginPath(); c.ellipse(R(0, s), R(0, s), R(14, 46), R(10, 28), R(0, 3), 0, 6.3); c.fill(); }
    } else if (id === 'flames') {
      c.fillStyle = g(60); c.fillRect(0, 0, s, s);
      for (const [v, h] of [[150, 1], [255, 0.6]]) { c.fillStyle = g(v); for (let k = 0; k < 9; k++) { const x = k * (s / 8); c.beginPath(); c.moveTo(x - 22, s); c.quadraticCurveTo(x - 18, s - 90 * h, x + R(-8, 8), s - R(120, 200) * h); c.quadraticCurveTo(x + 18, s - 90 * h, x + 22, s); c.fill(); } }
    } else if (id === 'stripes') {
      c.fillStyle = g(245); c.fillRect(0, 0, s, s); c.strokeStyle = g(60); c.lineWidth = 26;
      for (let k = -s; k < s * 2; k += 64) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + s, s); c.stroke(); }
    } else if (id === 'carbon') {
      const q = 16; for (let y = 0; y < s; y += q) for (let x = 0; x < s; x += q) { const d = ((x + y) / q) % 2; const gr = c.createLinearGradient(x, y, x + q, y + q); gr.addColorStop(0, g(d ? 60 : 130)); gr.addColorStop(1, g(d ? 120 : 70)); c.fillStyle = gr; c.fillRect(x, y, q, q); }
    } else if (id === 'checker') {
      const q = 32; for (let y = 0; y < s; y += q) for (let x = 0; x < s; x += q) { c.fillStyle = g(((x + y) / q) % 2 ? 60 : 250); c.fillRect(x, y, q, q); }
    } else { // tiger
      c.fillStyle = g(240); c.fillRect(0, 0, s, s); c.fillStyle = g(45);
      for (let k = 0; k < 13; k++) { const y = k * 21 + R(-5, 5); c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(70, y + R(-22, 22), 150, y + R(-22, 22), s, y + R(-10, 10)); c.lineTo(s, y + R(5, 12)); c.bezierCurveTo(150, y + R(0, 26), 70, y + R(0, 26), 0, y + R(4, 10)); c.fill(); }
    }
  }, { aniso: 4 });
  return (texCache[id] = t);
}

function flagTexture(id) {
  const key = 'flag-' + id;
  if (texCache[key]) return texCache[key];
  return (texCache[key] = canvasTexture(128, (c, s) => {
    if (id === 'checkered') { const q = 16; for (let y = 0; y < s; y += q) for (let x = 0; x < s; x += q) { c.fillStyle = ((x + y) / q) % 2 ? '#111' : '#fff'; c.fillRect(x, y, q, q); } }
    else if (id === 'stripes') { for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#fff' : '#d42a2a'; c.fillRect(0, k * 16, s, 16); } }
    else if (id === 'flames') { c.fillStyle = '#111'; c.fillRect(0, 0, s, s); for (const [col, h] of [['#f07a1a', 1], ['#ffd21f', 0.6]]) { c.fillStyle = col; for (let k = 0; k < 6; k++) { const x = k * 26; c.beginPath(); c.moveTo(x - 14, s); c.quadraticCurveTo(x - 10, s - 50 * h, x, s - 100 * h); c.quadraticCurveTo(x + 10, s - 50 * h, x + 14, s); c.fill(); } } }
    else { c.fillStyle = '#15171c'; c.fillRect(0, 0, s, s); c.fillStyle = '#ffd21f'; c.font = 'italic 900 78px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('WW', s / 2, s / 2 + 4); }
  }, { repeat: false }));
}

function plateTexture(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
  const c = cv.getContext('2d');
  c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, 256, 96); c.strokeStyle = '#111'; c.lineWidth = 8; c.strokeRect(4, 4, 248, 88);
  c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle';
  let size = 60; c.font = `900 ${size}px system-ui, sans-serif`;
  while (c.measureText(text).width > 224 && size > 18) { size -= 4; c.font = `900 ${size}px system-ui, sans-serif`; }
  c.fillText(text, 128, 51);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// B(slot) hands out the batch for that paint slot inside this wheel
function buildWheel(B, r, tw, o = {}) {
  const b = B('detail');
  const tr = tw * 0.5 * (o.fat || 1);
  b.color(0x18181a).geom(new THREE.TorusGeometry(r - tr, tr, 8, 26).rotateY(Math.PI / 2));
  if (o.knobby) {
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      for (const sx of [-1, 1]) b.geom(BOX, mat(sx * tr * 0.55, Math.cos(a) * (r - tr * 0.25), Math.sin(a) * (r - tr * 0.25), a, 0, 0, tr * 0.5, 0.022, 0.03));
    }
  }
  const rimR = r - tr * 2 + 0.004;
  B('rims').color(o.rim ?? 0x2a2b2e).geom(new THREE.TorusGeometry(rimR, 0.013 + tw * 0.08, 6, 26).rotateY(Math.PI / 2));
  b.color(o.hub ?? 0x8c8f94);
  disc(b, 0, 0, 0, 0.028, 0.11, CYL6);
  const ns = o.spokes ?? 12;
  b.color(o.spoke ?? 0xb9bcc2);
  for (let k = 0; k < ns; k++) {
    const a = (k / ns) * Math.PI * 2, sx = k % 2 ? 0.03 : -0.03;
    tube(b, [sx, Math.cos(a) * 0.03, Math.sin(a) * 0.03], [0, Math.cos(a + 0.25) * rimR, Math.sin(a + 0.25) * rimR], o.mag ? 0.012 : 0.0035);
  }
  if (o.disc) { b.color(0x9a9da2); disc(b, o.disc, 0, 0, o.discR || 0.085, 0.004, CYL12); }
  if (o.sprocket) { b.color(0x77797d); disc(b, -0.055, 0, 0, o.sprocket, 0.006, CYL20); }
  return rimR;
}

// Returns { group, anchors, slots, setLook, animate, ... } for a catalogue entry.
// look: { colors: { slot: hex }, wrap: { id, color }, leds: { mode, color }, flag, plate }
// (a plain number is treated as a frame + plastics colour).
export function buildBike(spec, look) {
  const style = spec.style, v = spec.variant;
  const L = spec.wheelbase, rR = spec.rR, rF = spec.rF;
  const paint = spec.paint;
  const group = new THREE.Group();
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  // one batch per (parent group, paint slot); meshes are created at the end
  const parts = new Map();
  const P = (parent, slot) => { const k = parent.uuid + slot; let e = parts.get(k); if (!e) parts.set(k, (e = { parent, slot, batch: new Batch() })); return e.batch; };

  // geometry numbers per style
  const S = {
    bmx: { rake: 0.28, fork: 0.5, bb: [-0.07, 0.43], seat: [0.5, 0.2], barRise: 0.2, barW: 0.35, barBack: 0.03, head: 0.12 },
    mtb: { rake: 0.42, fork: 0.62, bb: [-0.05, 0.43], seat: [0.58, 0.19], barRise: 0.06, barW: 0.38, barBack: 0.0, head: 0.11 },
    moped: { rake: 0.36, fork: 0.6, bb: [-0.02, 0.42], seat: [0.5, 0.18], barRise: 0.17, barW: 0.33, barBack: 0.08, head: 0.13 },
    emoto: { rake: 0.45, fork: 0.84, bb: [-0.03, 0.4], seat: [0.5, 0.28], barRise: 0.1, barW: 0.4, barBack: 0.04, head: 0.14 },
  }[style];
  const big = v === 'varg' ? 1.14 : 1;
  const rake = S.rake, forkLen = S.fork * big, offset = 0.045;
  const ax = [0, Math.cos(rake), -Math.sin(rake)], perp = [0, Math.sin(rake), Math.cos(rake)];
  const fAxle = [0, rF - rR, L];
  const headTop = [0, fAxle[1] + ax[1] * forkLen - perp[1] * offset, fAxle[2] + ax[2] * forkLen - perp[2] * offset];
  const headBot = [0, headTop[1] - ax[1] * S.head, headTop[2] - ax[2] * S.head];
  const bb = [0, S.bb[0], S.bb[1]];
  const seat = [0, S.seat[0] * big, S.seat[1]];

  const fp = P(group, 'frame').color(paint), fd = P(group, 'detail'); // painted frame tubes / unpainted hardware
  const pl = P(group, 'plastics').color(paint), st = P(group, 'seat'), sh = P(group, 'shock');
  const anchors = { seat: new THREE.Vector3(0, seat[1], seat[2]), pegL: new THREE.Vector3(), pegR: new THREE.Vector3(), bb: new THREE.Vector3(0, bb[1], bb[2]), tail: new THREE.Vector3() };
  let crank = null, crankLen = 0;
  const steelDark = 0x1c1d20, steel = 0x8c8f94;

  if (style === 'bmx' || style === 'mtb') {
    const mt = style === 'mtb';
    const seatClu = [0, seat[1] - (mt ? 0.2 : 0.1), seat[2] + 0.04];
    const R = mt ? 0.024 : 0.02;
    tube(fp, bb, seatClu, R);
    tube(fp, seatClu, headTop, R);
    tube(fp, headBot, bb, R * 1.25);
    tube(fp, headBot, headTop, R * 1.4);
    if (!spec.fullSus) { // hardtail: chainstays and seatstays; a full-suspension bike has a swingarm instead
      tube2(fp, [0.05, bb[1], bb[2]], [0.06, 0, 0], 0.012);
      tube2(fp, [0.03, seatClu[1], seatClu[2]], [0.06, 0, 0], 0.011);
    } else {
      // rear shock: from the down tube back to the swingarm's rocker, coil and air can
      // shock hangs under the top tube and drives a rocker on the seat tube
      const d = [0, seatClu[1] + (headTop[1] - seatClu[1]) * 0.55 - 0.035, seatClu[2] + (headTop[2] - seatClu[2]) * 0.55], s = [0, 0.33, 0.31];
      sh.color(0x1c1d20); tube(sh, d, [0, (d[1] + s[1]) / 2, (d[2] + s[2]) / 2], 0.024, CYL12);
      sh.color(0xb9bdc2); tube(sh, [0, (d[1] + s[1]) / 2, (d[2] + s[2]) / 2], s, 0.013, CYL12);
      sh.color(0xc8282a);
      for (let k = 0; k < 7; k++) { const f = 0.3 + k * 0.08, px = d[1] + (s[1] - d[1]) * f, pz = d[2] + (s[2] - d[2]) * f; sh.geom(new THREE.TorusGeometry(0.03, 0.006, 5, 12).rotateX(Math.PI / 2), mat(0, px, pz, Math.atan2(s[2] - d[2], s[1] - d[1]))); }
      fd.color(steelDark); disc(fd, 0, d[1], d[2], 0.016, 0.06, CYL6);
    }
    fd.color(steel); tube(fd, seatClu, [0, seat[1] - 0.03, seat[2]], 0.014);
    st.color(spec.seat); box(st, 0, seat[1], seat[2] - 0.02, mt ? 0.13 : 0.15, 0.05, mt ? 0.27 : 0.3, -0.06);
    disc(fd.color(steel), 0, bb[1], bb[2], 0.03, 0.09, CYL6);
    if (!mt) {
      // frame + bar pads, pegs
      pl.color(spec.accent); tube(pl, [0, seatClu[1] + 0.012, seatClu[2] + 0.12], [0, headTop[1] - 0.03, headTop[2] - 0.14], 0.032);
      fd.color(steel); disc(fd, 0.11, 0, 0, 0.018, 0.1, CYL6); disc(fd, -0.11, 0, 0, 0.018, 0.1, CYL6);
    }
    // cranks
    crank = new THREE.Group(); crank.position.set(0, bb[1], bb[2]); group.add(crank);
    crankLen = 0.17;
    const cb = P(crank, 'detail');
    cb.color(steelDark);
    tube(cb, [0.07, 0, 0], [0.07, -crankLen, 0], 0.011); tube(cb, [-0.07, 0, 0], [-0.07, crankLen, 0], 0.011);
    box(cb, 0.13, -crankLen, 0, 0.1, 0.02, 0.09); box(cb, -0.13, crankLen, 0, 0.1, 0.02, 0.09);
    cb.color(0x2b2c30); disc(cb, -0.045, 0, 0, mt ? 0.085 : 0.095, 0.006, CYL20);
    fd.color(0x3a3a3d); box(fd, -0.045, bb[1] * 0.5 + 0.045, bb[2] * 0.5, 0.008, 0.012, bb[2] * 0.98, Math.atan2(-bb[1], bb[2]));
    anchors.pegL.set(0.13, bb[1], bb[2]); anchors.pegR.set(-0.13, bb[1], bb[2]);
    anchors.tail.set(0, 0.25, -0.2);
  } else if (style === 'moped') {
    const railY = seat[1] - 0.06;
    const tail = [0, railY + 0.02, -0.2];
    tube2(fp, [0.045, railY, -0.2], [0.03, headTop[1] - 0.04, headTop[2] - 0.03], 0.02);
    tube2(fp, [0.03, headBot[1], headBot[2]], [0.05, bb[1], bb[2]], 0.02);
    tube2(fp, [0.05, bb[1], bb[2]], [0.07, 0, 0], 0.018);
    tube2(fp, [0.045, railY, -0.2], [0.07, 0, 0], 0.016);
    tube2(fp, [0.045, railY, 0.3], [0.05, bb[1], bb[2]], 0.017);
    tube(fp, headBot, headTop, 0.032);
    // bench seat
    st.color(spec.seat); box(st, 0, seat[1] + 0.01, 0.17, 0.2, 0.08, 0.74);
    box(st, 0, seat[1] + 0.04, -0.16, 0.2, 0.06, 0.1, 0.5);
    if (v === 'super73') {
      // tank battery up top, rear shocks, chunky fenders
      pl.geom(BOX, mat(0, railY + 0.1, 0.73, 0, 0, 0, 0.17, 0.17, 0.4));
      fd.color(0x101113); box(fd, 0, railY + 0.19, 0.73, 0.1, 0.012, 0.25);
      sh.color(0xc9a227); tube2(sh, [0.085, railY - 0.05, 0.02], [0.085, 0.05, 0.02], 0.014);
      pl.color(steelDark); box(pl, 0, rR + 0.05, -0.1, 0.13, 0.012, 0.36, 0.25);
    } else {
      // battery in the frame triangle
      fd.color(0x15161a); box(fd, 0, railY - 0.17, 0.58, 0.12, 0.22, 0.42, -0.1);
      pl.color(spec.accent); box(pl, 0.066, railY - 0.17, 0.58, 0.012, 0.07, 0.32, -0.1);
      box(pl, -0.066, railY - 0.17, 0.58, 0.012, 0.07, 0.32, -0.1);
    }
    fd.color(steel); disc(fd, 0, bb[1], bb[2], 0.035, 0.1, CYL6);
    fd.color(steelDark); tube(fd, [0.07, bb[1], bb[2]], [0.07, bb[1], bb[2] + 0.15], 0.011); tube(fd, [-0.07, bb[1], bb[2]], [-0.07, bb[1], bb[2] - 0.15], 0.011);
    box(fd, 0.13, bb[1], bb[2] + 0.15, 0.1, 0.02, 0.09); box(fd, -0.13, bb[1], bb[2] - 0.15, 0.1, 0.02, 0.09);
    const tl = new THREE.Mesh(BOX, tailMat); tl.scale.set(0.1, 0.035, 0.02); tl.position.set(0, railY + 0.02, -0.235); group.add(tl);
    anchors.pegL.set(0.13, bb[1], bb[2] + 0.15); anchors.pegR.set(-0.13, bb[1], bb[2] - 0.15);
    anchors.tail.set(0, railY, -0.24);
    void tail;
  } else {
    // e-moto: twin spar, battery box, motor, MX seat and fenders
    const sy = seat[1], piv = [0, 0.07 * big, 0.43 * big];
    const sp = v === 'varg' ? 0.075 : 0.06;
    tube2(fp, [sp, headTop[1] - 0.05, headTop[2] - 0.02], [sp + 0.02, sy - 0.1, 0.42], 0.024);
    tube2(fp, [sp + 0.02, sy - 0.1, 0.42], [sp, piv[1], piv[2]], 0.024);
    tube2(fd.color(steelDark), [sp, piv[1], piv[2]], [sp - 0.01, -0.1 * big, 0.6 * big], 0.018);
    tube2(fd, [sp - 0.01, -0.1 * big, 0.6 * big], [0.035, headBot[1] - 0.12, headBot[2] - 0.1], 0.018);
    tube(fp, headBot, headTop, 0.036);
    // subframe + seat
    tube2(fd.color(v === 'varg' ? 0xe8e8e8 : steelDark), [sp, sy - 0.08, 0.36], [0.05, sy - 0.02, -0.3], 0.016);
    tube2(fd, [sp, piv[1] + 0.12, piv[2] - 0.04], [0.05, sy - 0.04, -0.22], 0.014);
    st.color(spec.seat); box(st, 0, sy - 0.005, 0.2, 0.17, 0.07, 0.86, -0.03);
    // battery / body
    const bodyCol = v === 'surron' ? 0x16171a : v === 'varg' ? 0xf0f0f0 : 0x1a1b1e;
    fd.color(bodyCol); box(fd, 0, sy - 0.25 * big, 0.6 * big, sp * 2 - 0.01, 0.34 * big, 0.36 * big, -0.12);
    // side shrouds in paint
    for (const sx of [-1, 1]) {
      pl.geom(BOX, mat(sx * (sp + 0.012), sy - 0.13, 0.72 * big, -0.3, 0, 0, 0.02, 0.2 * big, 0.42 * big));
      pl.geom(BOX, mat(sx * (sp + 0.01), sy - 0.1, -0.02, 0.12, 0, 0, 0.018, 0.14, 0.42));
    }
    fd.color(spec.accent);
    for (const sx of [-1, 1]) box(fd, sx * (sp + 0.024), sy - 0.13, 0.72 * big, 0.003, 0.05, 0.3 * big, -0.3);
    // motor + bash plate
    fd.color(0x55585d); disc(fd, 0, 0.02 * big, 0.5 * big, 0.085 * big, sp * 2 + 0.02, CYL12);
    fd.color(0x2a2b2e); box(fd, 0, -0.1 * big, 0.56 * big, sp * 2, 0.012, 0.3 * big, 0.12);
    // rear fender + plate (paint)
    pl.geom(BOX, mat(0, sy + 0.0, -0.36, 0.2, 0, 0, 0.15, 0.02, 0.4));
    pl.geom(BOX, mat(0, rR + 0.09, 0.28, -0.9, 0, 0, 0.13, 0.012, 0.3));
    // footpegs
    fd.color(steel); tube2(fd, [sp, piv[1] - 0.06, piv[2] - 0.03], [sp + 0.13, piv[1] - 0.06, piv[2] - 0.03], 0.012);
    // rear shock
    sh.color(v === 'varg' ? 0xd9261c : 0xc9a227); tube(sh, [0, sy - 0.13, 0.33], [0, 0.1, 0.22], 0.022);
    const tl = new THREE.Mesh(BOX, tailMat); tl.scale.set(0.09, 0.03, 0.02); tl.position.set(0, sy + 0.03, -0.555); tl.rotation.x = 0.2; group.add(tl);
    anchors.pegL.set(sp + 0.1, piv[1] - 0.05, piv[2] - 0.03); anchors.pegR.set(-sp - 0.1, piv[1] - 0.05, piv[2] - 0.03);
    anchors.tail.set(0, sy - 0.02, -0.55);
  }

  // ---- rear end: wheel (+ swingarm on suspended bikes)
  const rearSusp = new THREE.Group(); group.add(rearSusp);
  const rearWheel = new THREE.Group(); rearSusp.add(rearWheel);
  const wopt = style === 'emoto' ? { knobby: true, spokes: 14, disc: 0.05, discR: 0.1, sprocket: 0.11, rim: v === 'varg' ? 0x1a1a1c : 0x2a2b2e }
    : style === 'moped' ? { fat: 1, mag: false, spokes: 12, disc: 0.06, rim: 0x1c1c1e }
    : style === 'mtb' ? { knobby: true, spokes: 14, disc: 0.045, rim: 0x222326 }
    : { spokes: 16, rim: spec.accent === 0x111111 ? 0xdedede : 0x2a2b2e, sprocket: 0.045 };
  const rimRR = buildWheel((slot) => P(rearWheel, slot), rR, spec.tireW, wopt);
  let swing = null;
  if (style === 'emoto' || v === 'super73' || spec.fullSus) {
    const piv = style === 'emoto' ? [0, 0.07 * big, 0.43 * big] : spec.fullSus ? [0, bb[1] + 0.09, bb[2] + 0.01] : [0, bb[1] + 0.03, bb[2] - 0.02];
    swing = new THREE.Group(); swing.position.set(piv[0], piv[1], piv[2]); group.add(swing);
    const sb = P(swing, 'swingarm').color(style === 'emoto' ? 0x9a9da2 : 0x1c1d20);
    const len = Math.hypot(piv[1], piv[2]);
    if (spec.fullSus) {
      // a one-piece rear triangle on the main pivot: chainstays, seatstays up to a rocker that
      // drives the shock (built in bike space, then moved into the swingarm's frame)
      sb.color(paint);
      const inv = new THREE.Matrix4().compose(new THREE.Vector3(...piv), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(-piv[1], piv[2]), 0, 0)), new THREE.Vector3(1, 1, 1)).invert();
      const L = (p) => new THREE.Vector3(...p).applyMatrix4(inv).toArray();
      const rock = [0, 0.33, 0.31];
      for (const sx of [-1, 1]) {
        tube(sb, L([sx * 0.05, piv[1], piv[2]]), L([sx * 0.06, 0, 0]), 0.014);
        tube(sb, L([sx * 0.06, 0, 0]), L([sx * 0.03, rock[1], rock[2]]), 0.012);
      }
      tube(sb, L([-0.045, piv[1], piv[2]]), L([0.045, piv[1], piv[2]]), 0.018);
      sb.color(0x1c1d20); tube(sb, L([-0.035, rock[1], rock[2]]), L([0.035, rock[1], rock[2]]), 0.016);
    } else for (const sx of [-1, 1]) box(sb, sx * 0.075, 0, -len / 2, 0.022, 0.05, len);
    if (style === 'emoto') { const ch = P(swing, 'detail').color(0x2a2b2e); box(ch, -0.058, 0.03, -len / 2, 0.006, 0.01, len * 0.95); box(ch, -0.058, -0.035, -len / 2, 0.006, 0.01, len * 0.95); }
    swing.userData.len = len; swing.userData.piv = piv;
    swing.rotation.x = Math.atan2(-piv[1], piv[2]);
  }

  // ---- front end
  const forkTilt = new THREE.Group(); forkTilt.position.set(headTop[0], headTop[1], headTop[2]); forkTilt.rotation.x = -rake; group.add(forkTilt);
  const fork = new THREE.Group(); forkTilt.add(fork);
  const forkLower = new THREE.Group(); fork.add(forkLower);
  const frontWheel = new THREE.Group(); frontWheel.position.set(0, -forkLen, offset); forkLower.add(frontWheel);
  // wheel must spin about the bike's X axis: fine, the fork only tilts about X too
  const rimRF = buildWheel((slot) => P(frontWheel, slot), rF, spec.tireW, { ...wopt, sprocket: 0 });

  const up = P(fork, 'detail'), upP = P(fork, 'plastics').color(paint), low = P(forkLower, 'detail');
  const fk = P(fork, 'fork'), fkL = P(forkLower, 'fork'), bars = P(fork, 'bars'), grips = P(fork, 'grips');
  const legX = style === 'emoto' ? 0.095 : style === 'moped' ? 0.085 : 0.06;
  const barY = 0.06 + S.barRise, bw = S.barW * (v === 'varg' ? 1.03 : 1);
  if (style === 'bmx') {
    fk.color(0xc0c3c8); tube2(fk, [legX, -S.head - 0.02, 0], [legX * 0.9, -forkLen, offset], 0.013);
    box(fk, 0, -S.head - 0.02, 0, legX * 2 + 0.03, 0.03, 0.04);
    up.color(steelDark); tube(up, [0, -0.02, 0], [0, 0.07, 0.03], 0.018);
    // tall BMX bars with crossbar
    bars.color(0xc0c3c8); tube2(bars, [0.1, 0.07, 0.03], [0.17, barY - 0.01, 0.0], 0.012);
    tube2(bars, [0.17, barY - 0.01, 0.0], [bw + 0.06, barY, -S.barBack], 0.012);
    tube(bars, [-0.1, 0.07, 0.03], [0.1, 0.07, 0.03], 0.012); tube(bars, [-0.15, barY - 0.07, 0.01], [0.15, barY - 0.07, 0.01], 0.01);
    upP.color(spec.accent); tube(upP, [-0.1, barY - 0.07, 0.01], [0.1, barY - 0.07, 0.01], 0.028); upP.color(paint);
  } else {
    const usd = style === 'emoto';
    // stanchions (upper) and lowers
    fk.color(usd ? (v === 'varg' ? 0x2a2a2c : 0xc9a227) : 0xb9bcc2);
    tube2(fk, [legX, 0.02, 0], [legX, -forkLen * 0.55, offset * 0.5], usd ? 0.026 : 0.016);
    up.color(steelDark); box(up, 0, 0.01, 0, legX * 2 + 0.05, 0.03, 0.07); box(up, 0, -S.head - 0.02, 0, legX * 2 + 0.05, 0.03, 0.07);
    fkL.color(usd ? 0xb9bcc2 : steelDark); tube2(fkL, [legX, -forkLen * 0.5, offset * 0.5], [legX, -forkLen, offset], usd ? 0.019 : 0.024);
    low.color(steel); disc(low, 0, -forkLen, offset, 0.012, legX * 2, CYL6);
    // bars
    up.color(steelDark); tube(up, [0, 0.02, 0], [0, 0.07, 0.01], 0.02);
    bars.color(steelDark); tube2(bars, [0.04, 0.07, 0.01], [0.13, barY, -S.barBack * 0.5], 0.012);
    tube2(bars, [0.13, barY, -S.barBack * 0.5], [bw + 0.06, barY + 0.01, -S.barBack], 0.012);
    tube(bars, [-0.04, 0.07, 0.01], [0.04, 0.07, 0.01], 0.014);
    if (usd) { upP.color(spec.accent); tube(upP, [-0.09, barY - 0.01, -0.01], [0.09, barY - 0.01, -0.01], 0.022); upP.color(paint); }
  }
  const gy = barY + (style === 'bmx' ? 0 : 0.01);
  grips.color(0x101010); tube(grips, [bw - 0.06, gy, -S.barBack], [bw + 0.07, gy, -S.barBack], 0.017); tube(grips, [-bw + 0.06, gy, -S.barBack], [-bw - 0.07, gy, -S.barBack], 0.017);

  let headlight = null;
  if (style === 'emoto') {
    // front fender + number plate / headlight mask in paint
    upP.geom(BOX, mat(0, -forkLen + rF + 0.14, offset + 0.1, rake - 0.12, 0, 0, 0.15, 0.014, 0.62));
    upP.geom(BOX, mat(0, -0.1, 0.1, 0.1, 0, 0, 0.22, 0.26, 0.02));
    headlight = new THREE.Mesh(BOX, lightMat); headlight.scale.set(0.12, 0.07, 0.02); headlight.position.set(0, -0.1, 0.115); headlight.rotation.x = 0.1; fork.add(headlight);
  } else if (style === 'moped') {
    up.color(0x101113); up.geom(CYL12, mat(0, -0.12, 0.11, Math.PI / 2 + rake, 0, 0, 0.085, 0.07, 0.085));
    headlight = new THREE.Mesh(new THREE.CircleGeometry(0.07, 14), lightMat); headlight.position.set(0, -0.12 - Math.sin(rake) * 0.037, 0.11 + Math.cos(rake) * 0.037); headlight.rotation.x = rake; fork.add(headlight);
    if (v === 'super73') P(forkLower, 'plastics').color(steelDark).geom(BOX, mat(0, -forkLen + rF + 0.06, offset, rake, 0, 0, 0.13, 0.012, 0.34));
  } else if (style === 'mtb') {
    fkL.color(steelDark); box(fkL, 0, -forkLen * 0.48, offset * 0.5 + 0.03, legX * 2, 0.03, 0.03);
  }

  const gripL = new THREE.Object3D(); gripL.position.set(bw, barY + 0.02, -S.barBack); fork.add(gripL);
  const gripR = new THREE.Object3D(); gripR.position.set(-bw, barY + 0.02, -S.barBack); fork.add(gripR);

  // ---- meshes: one per (group, slot), sharing a material per slot
  const mats = {};
  for (const { parent, slot, batch } of parts.values()) {
    if (!batch.v) continue;
    if (!mats[slot]) mats[slot] = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: SLOTS[slot][0], roughness: SLOTS[slot][1] });
    const me = new THREE.Mesh(batch.geometry(), mats[slot]); me.castShadow = true; parent.add(me);
  }

  // ---- wheel LEDs (hidden until switched on)
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const leds = [];
  for (const [wheel, rimR] of [[rearWheel, rimRR], [frontWheel, rimRF]]) {
    for (const sx of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.012, 0.007, 5, 28).rotateY(Math.PI / 2), ledMat);
      ring.position.x = sx * (spec.tireW * 0.32 + 0.012); ring.visible = false; wheel.add(ring); leds.push(ring);
    }
  }
  const ledState = { mode: 'off', color: new THREE.Color(0xffffff) };

  // ---- flag pole + name plate mounts at the tail
  const flag = new THREE.Group(); flag.position.copy(anchors.tail); flag.position.y -= 0.03; flag.visible = false; group.add(flag);
  const pole = new THREE.Mesh(CYL6, new THREE.MeshStandardMaterial({ color: 0x8c8f94, metalness: 0.6, roughness: 0.4 })); pole.scale.set(0.008, 1.15, 0.008); pole.position.y = 0.575; flag.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.3).translate(-0.22, 0, 0).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  cloth.position.y = 0.98; flag.add(cloth);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), new THREE.MeshBasicMaterial());
  plate.position.set(0, anchors.tail.y - 0.075, anchors.tail.z - 0.012); plate.rotation.y = Math.PI; plate.visible = false; group.add(plate);
  let plateText = '';

  // everything built so far is the procedural look; a detailed model can hide it (bikeGlb.js)
  group.traverse((o) => { if (o.isMesh) o.userData.proc = true; });
  for (const o of [...leds, plate]) o.userData.proc = false;
  flag.traverse((o) => { o.userData.proc = false; });

  const model = {
    group, spec, style, rearSusp, rearWheel, swing, fork, forkLower, frontWheel, crank, crankLen, headlight, flag, plate, leds,
    gripL, gripR, anchors, forkLen, rake, hasRearSusp: !!swing, hasFrontSusp: style !== 'bmx',
    slots: Object.keys(mats).filter((k) => k !== 'detail'),
    // Apply paint, wrap, LEDs, flag and plate. Anything missing falls back to stock.
    setLook(lk) {
      if (typeof lk === 'number') lk = { colors: { frame: lk, plastics: lk } };
      lk = lk || {}; this.lastLook = lk;
      const colors = lk.colors || {};
      for (const slot of this.slots) {
        const m = mats[slot], wrap = lk.wrap && lk.wrap.id && (slot === 'frame' || slot === 'plastics') ? lk.wrap : null;
        if (wrap) { m.map = wrapTexture(wrap.id); m.vertexColors = false; m.color.set(wrap.color ?? 0xffffff); }
        else if (colors[slot] != null) { m.map = null; m.vertexColors = false; m.color.set(colors[slot]); }
        else { m.map = null; m.vertexColors = true; m.color.set(0xffffff); }
        m.needsUpdate = true;
      }
      paintGlb(this, colors, lk.wrap && lk.wrap.id ? lk.wrap : null, wrapTexture);
      const ld = lk.leds || {};
      ledState.mode = ld.mode || 'off'; ledState.color.set(ld.color ?? 0x2f7bff);
      for (const r of leds) r.visible = ledState.mode !== 'off';
      ledMat.color.copy(ledState.color);
      flag.visible = !!lk.flag;
      if (lk.flag) { cloth.material.map = flagTexture(lk.flag); cloth.material.needsUpdate = true; }
      const text = (lk.plate || '').trim();
      plate.visible = !!text;
      if (text && text !== plateText) { if (plate.material.map) plate.material.map.dispose(); plate.material.map = plateTexture(text); plate.material.needsUpdate = true; }
      plateText = text;
    },
    // per-frame extras: LED effects and the flag in the wind
    animate(t, speed = 0) {
      if (ledState.mode === 'pulse') ledMat.color.copy(ledState.color).multiplyScalar(0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 6)));
      else if (ledState.mode === 'rainbow') ledMat.color.setHSL((t * 0.3) % 1, 1, 0.55);
      if (flag.visible) {
        const w = Math.min(1, Math.abs(speed) / 9);
        flag.rotation.x = -0.12 - w * 0.3;
        cloth.rotation.y = Math.sin(t * (5 + w * 9)) * (0.12 + 0.2 * w);
      }
    },
    dispose() {
      group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      if (plate.material.map) plate.material.map.dispose();
    },
  };
  model.setLook(look);
  if (hasGlb(spec.variant)) applyGlb(model);
  return model;
}

// Apply physics state to the model (wheel spin, suspension, steering).
export function poseBike(model, phys, dt) {
  const sp = model.spec;
  model.rearWheel.rotation.x = phys.wheelRotR;
  model.frontWheel.rotation.x = phys.wheelRotF;
  const cr = Math.min(phys.rearPen, sp.susp.tR), cf = Math.min(phys.frontPen, sp.susp.tF);
  if (model.hasRearSusp) {
    model.rearSusp.position.y += (cr - model.rearSusp.position.y) * Math.min(1, dt * 40);
    const p = model.swing.userData.piv;
    model.swing.rotation.x = Math.atan2(model.rearSusp.position.y - p[1], p[2]);
  }
  if (model.hasFrontSusp) model.forkLower.position.y += (cf / Math.cos(model.rake) - model.forkLower.position.y) * Math.min(1, dt * 40);
  // bars turn a lot at walking pace, barely at speed
  const v = Math.abs(phys.speed);
  // on the ground the front wheel shows the real steering angle (countersteer flicks included)
  const target = phys.frontContact && phys.steerAngle !== undefined ? phys.steerAngle : phys.steer * (0.55 / (1 + v * 0.22)) + phys.steer * 0.25;
  model.fork.rotation.y += (target - model.fork.rotation.y) * Math.min(1, dt * 14);
  if (model.crank && phys.effThrottle > 0.05 && !phys.crashed) model.crank.rotation.x += Math.max(2.5, phys.spinR * 0.42) * dt;
}
