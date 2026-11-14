// Procedural bike models. Local frame: origin at the rear axle, +Z forward,
// +Y up, +X to the rider's left. Everything is built from tubes and boxes and
// merged into a few meshes per bike.
import * as THREE from 'three';
import { Batch, between, mat } from './world/geo.js';

const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const CYL12 = new THREE.CylinderGeometry(1, 1, 1, 12);
const CYL20 = new THREE.CylinderGeometry(1, 1, 1, 20);
const BOX = new THREE.BoxGeometry(1, 1, 1);

const tube = (b, a, c, r, g = CYL6) => b.geom(g, between(a[0], a[1], a[2], c[0], c[1], c[2], r));
const tube2 = (b, a, c, r) => { tube(b, a, c, r); tube(b, [-a[0], a[1], a[2]], [-c[0], c[1], c[2]], r); };
const box = (b, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => b.geom(BOX, mat(x, y, z, rx, ry, rz, sx, sy, sz));
// disc / cylinder with its axis along X
const disc = (b, x, y, z, r, w, g = CYL12) => b.geom(g, mat(x, y, z, 0, 0, Math.PI / 2, r, w, r));

function buildWheel(r, tw, o = {}) {
  const b = new Batch();
  const tr = tw * 0.5 * (o.fat || 1);
  const tire = new THREE.TorusGeometry(r - tr, tr, 8, 26).rotateY(Math.PI / 2);
  b.color(0x18181a).geom(tire);
  if (o.knobby) {
    // side knobs
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      for (const sx of [-1, 1]) b.geom(BOX, mat(sx * tr * 0.55, Math.cos(a) * (r - tr * 0.25), Math.sin(a) * (r - tr * 0.25), a - Math.PI / 2 + Math.PI / 2, 0, 0, tr * 0.5, 0.022, 0.03));
    }
  }
  const rimR = r - tr * 2 + 0.004;
  b.color(o.rim ?? 0x2a2b2e).geom(new THREE.TorusGeometry(rimR, 0.013 + tw * 0.08, 6, 26).rotateY(Math.PI / 2));
  b.color(o.hub ?? 0x8c8f94);
  disc(b, 0, 0, 0, 0.028, 0.11, CYL6);
  // spokes
  const ns = o.spokes ?? 12;
  b.color(o.spoke ?? 0xb9bcc2);
  for (let k = 0; k < ns; k++) {
    const a = (k / ns) * Math.PI * 2, sx = k % 2 ? 0.03 : -0.03;
    tube(b, [sx, Math.cos(a) * 0.03, Math.sin(a) * 0.03], [0, Math.cos(a + 0.25) * rimR, Math.sin(a + 0.25) * rimR], o.mag ? 0.012 : 0.0035);
  }
  if (o.disc) { b.color(0x9a9da2); disc(b, o.disc, 0, 0, o.discR || 0.085, 0.004, CYL12); }
  if (o.sprocket) { b.color(0x77797d); disc(b, -0.055, 0, 0, o.sprocket, 0.006, CYL20); }
  return b;
}

// Returns { group, parts, anchors, ... } for a catalogue entry.
export function buildBike(spec, paintHex) {
  const style = spec.style, v = spec.variant;
  const L = spec.wheelbase, rR = spec.rR, rF = spec.rF;
  const paint = paintHex ?? spec.paint;
  const group = new THREE.Group();
  const paintMat = new THREE.MeshStandardMaterial({ color: paint, metalness: 0.45, roughness: 0.38 });
  const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.55 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const add = (parent, batch, m) => { if (!batch.v) return null; const me = new THREE.Mesh(batch.geometry(), m); me.castShadow = true; parent.add(me); return me; };

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

  const fp = new Batch(), fd = new Batch(); // frame paint / frame detail
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
    tube2(fp, [0.05, bb[1], bb[2]], [0.06, 0, 0], 0.012);
    tube2(fp, [0.03, seatClu[1], seatClu[2]], [0.06, 0, 0], 0.011);
    fd.color(steel); tube(fd, seatClu, [0, seat[1] - 0.03, seat[2]], 0.014);
    fd.color(spec.seat); box(fd, 0, seat[1], seat[2] - 0.02, mt ? 0.13 : 0.15, 0.05, mt ? 0.27 : 0.3, -0.06);
    disc(fd.color(steel), 0, bb[1], bb[2], 0.03, 0.09, CYL6);
    if (!mt) {
      // frame + bar pads, pegs
      fd.color(spec.accent); tube(fd, [0, seatClu[1] + 0.012, seatClu[2] + 0.12], [0, headTop[1] - 0.03, headTop[2] - 0.14], 0.032);
      fd.color(steel); disc(fd, 0.11, 0, 0, 0.018, 0.1, CYL6); disc(fd, -0.11, 0, 0, 0.018, 0.1, CYL6);
    }
    // cranks
    crank = new THREE.Group(); crank.position.set(0, bb[1], bb[2]); group.add(crank);
    crankLen = 0.17;
    const cb = new Batch();
    cb.color(steelDark);
    tube(cb, [0.07, 0, 0], [0.07, -crankLen, 0], 0.011); tube(cb, [-0.07, 0, 0], [-0.07, crankLen, 0], 0.011);
    box(cb, 0.13, -crankLen, 0, 0.1, 0.02, 0.09); box(cb, -0.13, crankLen, 0, 0.1, 0.02, 0.09);
    cb.color(0x2b2c30); disc(cb, -0.045, 0, 0, mt ? 0.085 : 0.095, 0.006, CYL20);
    add(crank, cb, detailMat);
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
    fd.color(spec.seat); box(fd, 0, seat[1] + 0.01, 0.17, 0.2, 0.08, 0.74);
    box(fd, 0, seat[1] + 0.04, -0.16, 0.2, 0.06, 0.1, 0.5);
    if (v === 'super73') {
      // tank battery up top, rear shocks, chunky fenders
      fp.geom(BOX, mat(0, railY + 0.1, 0.73, 0, 0, 0, 0.17, 0.17, 0.4));
      fd.color(0x101113); box(fd, 0, railY + 0.19, 0.73, 0.1, 0.012, 0.25);
      fd.color(0xc9a227); tube2(fd, [0.085, railY - 0.05, 0.02], [0.085, 0.05, 0.02], 0.014);
      fd.color(steelDark); box(fd, 0, rR + 0.05, -0.1, 0.13, 0.012, 0.36, 0.25);
    } else {
      // battery in the frame triangle
      fd.color(0x15161a); box(fd, 0, railY - 0.17, 0.58, 0.12, 0.22, 0.42, -0.1);
      fd.color(spec.accent); box(fd, 0.062, railY - 0.17, 0.58, 0.004, 0.06, 0.3, -0.1);
      box(fd, -0.062, railY - 0.17, 0.58, 0.004, 0.06, 0.3, -0.1);
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
    fd.color(spec.seat); box(fd, 0, sy - 0.005, 0.2, 0.17, 0.07, 0.86, -0.03);
    // battery / body
    const bodyCol = v === 'surron' ? 0x16171a : v === 'varg' ? 0xf0f0f0 : 0x1a1b1e;
    fd.color(bodyCol); box(fd, 0, sy - 0.25 * big, 0.6 * big, sp * 2 - 0.01, 0.34 * big, 0.36 * big, -0.12);
    // side shrouds in paint
    for (const sx of [-1, 1]) {
      fp.geom(BOX, mat(sx * (sp + 0.012), sy - 0.13, 0.72 * big, -0.3, 0, 0, 0.02, 0.2 * big, 0.42 * big));
      fp.geom(BOX, mat(sx * (sp + 0.01), sy - 0.1, -0.02, 0.12, 0, 0, 0.018, 0.14, 0.42));
    }
    fd.color(spec.accent);
    for (const sx of [-1, 1]) box(fd, sx * (sp + 0.024), sy - 0.13, 0.72 * big, 0.003, 0.05, 0.3 * big, -0.3);
    // motor + bash plate
    fd.color(0x55585d); disc(fd, 0, 0.02 * big, 0.5 * big, 0.085 * big, sp * 2 + 0.02, CYL12);
    fd.color(0x2a2b2e); box(fd, 0, -0.1 * big, 0.56 * big, sp * 2, 0.012, 0.3 * big, 0.12);
    // rear fender + plate (paint)
    fp.geom(BOX, mat(0, sy + 0.0, -0.36, 0.2, 0, 0, 0.15, 0.02, 0.4));
    fp.geom(BOX, mat(0, rR + 0.09, 0.28, -0.9, 0, 0, 0.13, 0.012, 0.3));
    // footpegs
    fd.color(steel); tube2(fd, [sp, piv[1] - 0.06, piv[2] - 0.03], [sp + 0.13, piv[1] - 0.06, piv[2] - 0.03], 0.012);
    // rear shock
    fd.color(v === 'varg' ? 0xd9261c : 0xc9a227); tube(fd, [0, sy - 0.13, 0.33], [0, 0.1, 0.22], 0.022);
    const tl = new THREE.Mesh(BOX, tailMat); tl.scale.set(0.09, 0.03, 0.02); tl.position.set(0, sy + 0.03, -0.555); tl.rotation.x = 0.2; group.add(tl);
    anchors.pegL.set(sp + 0.1, piv[1] - 0.05, piv[2] - 0.03); anchors.pegR.set(-sp - 0.1, piv[1] - 0.05, piv[2] - 0.03);
    anchors.tail.set(0, sy - 0.02, -0.55);
  }
  add(group, fp, paintMat);
  add(group, fd, detailMat);

  // ---- rear end: wheel (+ swingarm on suspended bikes)
  const rearSusp = new THREE.Group(); group.add(rearSusp);
  const rearWheel = new THREE.Group(); rearSusp.add(rearWheel);
  const wopt = style === 'emoto' ? { knobby: true, spokes: 14, disc: 0.05, discR: 0.1, sprocket: 0.11, rim: v === 'varg' ? 0x1a1a1c : 0x2a2b2e }
    : style === 'moped' ? { fat: 1, mag: false, spokes: 12, disc: 0.06, rim: 0x1c1c1e }
    : style === 'mtb' ? { knobby: true, spokes: 14, disc: 0.045, rim: 0x222326 }
    : { spokes: 16, rim: spec.accent === 0x111111 ? 0xdedede : 0x2a2b2e, sprocket: 0.045 };
  add(rearWheel, buildWheel(rR, spec.tireW, wopt), detailMat);
  let swing = null;
  if (style === 'emoto' || v === 'super73') {
    const piv = style === 'emoto' ? [0, 0.07 * big, 0.43 * big] : [0, bb[1] + 0.03, bb[2] - 0.02];
    swing = new THREE.Group(); swing.position.set(piv[0], piv[1], piv[2]); group.add(swing);
    const sb = new Batch(); sb.color(style === 'emoto' ? 0x9a9da2 : 0x1c1d20);
    const len = Math.hypot(piv[1], piv[2]);
    for (const sx of [-1, 1]) box(sb, sx * 0.075, 0, -len / 2, 0.022, 0.05, len);
    if (style === 'emoto') { sb.color(0x2a2b2e); box(sb, -0.058, 0.03, -len / 2, 0.006, 0.01, len * 0.95); box(sb, -0.058, -0.035, -len / 2, 0.006, 0.01, len * 0.95); }
    add(swing, sb, detailMat);
    swing.userData.len = len; swing.userData.piv = piv;
    swing.rotation.x = Math.atan2(-piv[1], piv[2]);
  }

  // ---- front end
  const forkTilt = new THREE.Group(); forkTilt.position.set(headTop[0], headTop[1], headTop[2]); forkTilt.rotation.x = -rake; group.add(forkTilt);
  const fork = new THREE.Group(); forkTilt.add(fork);
  const forkLower = new THREE.Group(); fork.add(forkLower);
  const frontWheel = new THREE.Group(); frontWheel.position.set(0, -forkLen, offset); forkLower.add(frontWheel);
  // wheel must spin about the bike's X axis: fine, the fork only tilts about X too
  add(frontWheel, buildWheel(rF, spec.tireW, { ...wopt, sprocket: 0 }), detailMat);

  const up = new Batch(), upP = new Batch(), low = new Batch();
  const legX = style === 'emoto' ? 0.095 : style === 'moped' ? 0.085 : 0.06;
  const barY = 0.06 + S.barRise, bw = S.barW * (v === 'varg' ? 1.03 : 1);
  if (style === 'bmx') {
    up.color(0xc0c3c8); tube2(up, [legX, -S.head - 0.02, 0], [legX * 0.9, -forkLen, offset], 0.013);
    box(up, 0, -S.head - 0.02, 0, legX * 2 + 0.03, 0.03, 0.04);
    up.color(steelDark); tube(up, [0, -0.02, 0], [0, 0.07, 0.03], 0.018);
    // tall BMX bars with crossbar
    up.color(0xc0c3c8); tube2(up, [0.1, 0.07, 0.03], [0.17, barY - 0.01, 0.0], 0.012);
    tube2(up, [0.17, barY - 0.01, 0.0], [bw + 0.06, barY, -S.barBack], 0.012);
    tube(up, [-0.1, 0.07, 0.03], [0.1, 0.07, 0.03], 0.012); tube(up, [-0.15, barY - 0.07, 0.01], [0.15, barY - 0.07, 0.01], 0.01);
    up.color(spec.accent); tube(up, [-0.1, barY - 0.07, 0.01], [0.1, barY - 0.07, 0.01], 0.028);
  } else {
    const usd = style === 'emoto';
    // stanchions (upper) and lowers
    up.color(usd ? (v === 'varg' ? 0x2a2a2c : 0xc9a227) : 0xb9bcc2);
    tube2(up, [legX, 0.02, 0], [legX, -forkLen * 0.55, offset * 0.5], usd ? 0.026 : 0.016);
    up.color(steelDark); box(up, 0, 0.01, 0, legX * 2 + 0.05, 0.03, 0.07); box(up, 0, -S.head - 0.02, 0, legX * 2 + 0.05, 0.03, 0.07);
    low.color(usd ? 0xb9bcc2 : steelDark); tube2(low, [legX, -forkLen * 0.5, offset * 0.5], [legX, -forkLen, offset], usd ? 0.019 : 0.024);
    low.color(steel); disc(low, 0, -forkLen, offset, 0.012, legX * 2, CYL6);
    // bars
    up.color(steelDark); tube(up, [0, 0.02, 0], [0, 0.07, 0.01], 0.02);
    tube2(up, [0.04, 0.07, 0.01], [0.13, barY, -S.barBack * 0.5], 0.012);
    tube2(up, [0.13, barY, -S.barBack * 0.5], [bw + 0.06, barY + 0.01, -S.barBack], 0.012);
    tube(up, [-0.04, 0.07, 0.01], [0.04, 0.07, 0.01], 0.014);
    if (usd) { up.color(spec.accent); tube(up, [-0.09, barY - 0.01, -0.01], [0.09, barY - 0.01, -0.01], 0.022); }
  }
  up.color(0x101010); tube(up, [bw - 0.06, barY + (style === 'bmx' ? 0 : 0.01), -S.barBack], [bw + 0.07, barY + (style === 'bmx' ? 0 : 0.01), -S.barBack], 0.017); tube(up, [-bw + 0.06, barY + (style === 'bmx' ? 0 : 0.01), -S.barBack], [-bw - 0.07, barY + (style === 'bmx' ? 0 : 0.01), -S.barBack], 0.017);

  let headlight = null;
  if (style === 'emoto') {
    // front fender + number plate / headlight mask in paint
    upP.geom(BOX, mat(0, -forkLen + rF + 0.14, offset + 0.1, rake - 0.12, 0, 0, 0.15, 0.014, 0.62));
    upP.geom(BOX, mat(0, -0.1, 0.1, 0.1, 0, 0, 0.22, 0.26, 0.02));
    headlight = new THREE.Mesh(BOX, lightMat); headlight.scale.set(0.12, 0.07, 0.02); headlight.position.set(0, -0.1, 0.115); headlight.rotation.x = 0.1; fork.add(headlight);
  } else if (style === 'moped') {
    up.color(0x101113); up.geom(CYL12, mat(0, -0.12, 0.11, Math.PI / 2 + rake, 0, 0, 0.085, 0.07, 0.085));
    headlight = new THREE.Mesh(new THREE.CircleGeometry(0.07, 14), lightMat); headlight.position.set(0, -0.12 - Math.sin(rake) * 0.037, 0.11 + Math.cos(rake) * 0.037); headlight.rotation.x = rake; fork.add(headlight);
    if (v === 'super73') low.color(steelDark), low.geom(BOX, mat(0, -forkLen + rF + 0.06, offset, rake, 0, 0, 0.13, 0.012, 0.34));
  } else if (style === 'mtb') {
    low.color(steelDark); box(low, 0, -forkLen * 0.48, offset * 0.5 + 0.03, legX * 2, 0.03, 0.03);
  }
  add(fork, up, detailMat); add(fork, upP, paintMat); add(forkLower, low, detailMat);

  const gripL = new THREE.Object3D(); gripL.position.set(bw, barY + 0.02, -S.barBack); fork.add(gripL);
  const gripR = new THREE.Object3D(); gripR.position.set(-bw, barY + 0.02, -S.barBack); fork.add(gripR);

  return {
    group, spec, style, paintMat, rearSusp, rearWheel, swing, fork, forkLower, frontWheel, crank, crankLen, headlight,
    gripL, gripR, anchors, forkLen, rake, hasRearSusp: !!swing, hasFrontSusp: style !== 'bmx',
    setPaint(hex) { paintMat.color.set(hex ?? spec.paint); },
    dispose() { group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); },
  };
}

// Apply physics state to the model (wheel spin, suspension, steering).
export function poseBike(model, phys, dt) {
  const sp = model.spec;
  model.rearWheel.rotation.x = phys.wheelRotR;
  model.frontWheel.rotation.x = phys.wheelRotF;
  const cr = Math.min(phys.rearPen, sp.susp.tR), cf = Math.min(phys.frontPen, sp.susp.tF);
  if (model.hasRearSusp) {
    model.rearSusp.position.y += (cr - model.rearSusp.position.y) * Math.min(1, dt * 30);
    const p = model.swing.userData.piv;
    model.swing.rotation.x = Math.atan2(model.rearSusp.position.y - p[1], p[2]);
  }
  if (model.hasFrontSusp) model.forkLower.position.y += (cf * 0.9 - model.forkLower.position.y) * Math.min(1, dt * 30);
  // bars turn a lot at walking pace, barely at speed
  const v = Math.abs(phys.speed);
  const target = phys.steer * (0.55 / (1 + v * 0.22)) + (phys.frontContact ? 0 : phys.steer * 0.25);
  model.fork.rotation.y += (target - model.fork.rotation.y) * Math.min(1, dt * 14);
  if (model.crank && phys.effThrottle > 0.05 && !phys.crashed) model.crank.rotation.x += Math.max(2.5, phys.spinR * 0.42) * dt;
}
