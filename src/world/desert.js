// The desert: the second map. Dunes and hills ringed by mountains, a highway over them, a
// motocross park with big doubles and tabletops, one huge gap jump, and a mountain-bike
// trail down a long hill with its own small jumps and a dirt jump line at the bottom.
// Like the city it fills the Terrain (a height grid, jump profiles, colliders) and returns
// the meshes, the spawn point and a map picture for the HUD.
import * as THREE from 'three';
import { Batch, canvasTexture, mat } from './geo.js';
import { SURF } from './terrain.js';

export const HALF = 480;
const CELL = 4, NG = (HALF * 2) / CELL + 1;

// ---- noise ------------------------------------------------------------------------
const hash = (i, j, s) => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function vnoise(x, z, s) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- layout -----------------------------------------------------------------------
// x runs east, z runs south (north is up on the map).
const HILLS = [
  { x: 150, z: 175, r: 95, h: 18 }, { x: -120, z: 230, r: 115, h: 25 }, { x: 330, z: 270, r: 85, h: 16 },
  { x: -380, z: 200, r: 90, h: 20 }, { x: 390, z: -60, r: 70, h: 14 }, { x: -40, z: -120, r: 60, h: 9 },
];
// the mountain-bike hill: a broad slope rising north from the highway to a summit
const MTB = { x: -250, z0: -40, z1: -290, w: 55, fall: 45, h: 22 };

function mtbHill(x, z) {
  const dx = Math.abs(x - MTB.x);
  if (dx > MTB.w + MTB.fall || z > MTB.z0 || z < MTB.z1 - 50) return 0;
  const across = 1 - sstep(MTB.w, MTB.w + MTB.fall, dx);
  const along = z >= MTB.z1 ? (MTB.z0 - z) / (MTB.z0 - MTB.z1) : 1 - sstep(0, 50, MTB.z1 - z);
  return MTB.h * along * across;
}

// the ground before anything is built on it
function nat(x, z) {
  let h = 6.5 * vnoise(x / 140, z / 140, 1) + 2.4 * vnoise(x / 46, z / 46, 2) + 0.6 * vnoise(x / 15, z / 15, 3);
  h += 1.8 * Math.pow(Math.abs(Math.sin(x * 0.02 + z * 0.011 + 3 * vnoise(x / 90, z / 90, 4))), 3); // dune ridges
  for (const k of HILLS) { const d2 = ((x - k.x) ** 2 + (z - k.z) ** 2) / (k.r * k.r); if (d2 < 1) h += k.h * (1 - d2) ** 2; }
  h = Math.max(h, mtbHill(x, z) + 1.5 * vnoise(x / 30, z / 30, 5));
  // the mountains around the edge
  const e = Math.max(Math.abs(x), Math.abs(z)) - 380;
  if (e > 0) h += e * e * 0.0062 * (0.55 + 0.9 * vnoise(x / 70, z / 70, 6));
  return h;
}

const HIGHWAY = [[-432, 62], [-360, 40], [-230, 12], [-120, 0], [-30, 2], [60, -6], [140, -16], [230, 14], [340, 0], [432, -24]];
const MX_ROAD = [[30, 0], [44, -50], [36, -110], [52, -150], [60, -180]];
const SEND_ROAD = [[226, 12], [240, -40], [250, -90], [250, -118]];
const FIRE_ROAD = [[-200, 9], [-204, -60], [-197, -130], [-206, -200], [-226, -262], [-252, -288]];
const TRAIL = [[-258, -287], [-280, -258], [-291, -222], [-272, -190], [-262, -160], [-281, -128], [-291, -102], [-277, -84], [-268, -72], [-268, -60]];
const CAMP = { x0: -26, z0: 22, x1: 26, z1: 72 };
const MX = { x0: -4, z0: -372, x1: 140, z1: -176 };
const SEND = { x0: 230, z0: -365, x1: 270, z1: -112 };
const DJ = { x0: -282, z0: -58, x1: -254, z1: -8 }; // the dirt jump line at the bottom of the trail

// Catmull-Rom through the points, resampled every `step` metres: [{ x, z, dx, dz, s }]
function spline(pts, step) {
  const raw = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  raw.push(pts[pts.length - 1]);
  const out = []; let s = 0, next = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i) s += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    if (s >= next || i === raw.length - 1) { out.push({ x: raw[i][0], z: raw[i][1], s }); next = s + step; }
  }
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    out[i].dx = (b.x - a.x) / l; out[i].dz = (b.z - a.z) / l;
  }
  return out;
}

function makeTextures() {
  const noise = (ctx, s, n, a, b, w = 2) => {
    for (let k = 0; k < n; k++) {
      const v = a + Math.random() * (b - a);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.2 + Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * w, 1 + Math.random() * w);
    }
  };
  const sand = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#e4e4e4'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 7000, 170, 255);
    ctx.strokeStyle = 'rgba(150,150,150,0.25)'; ctx.lineWidth = 2; // wind ripples
    for (let y = 6; y < s; y += 11) { ctx.beginPath(); for (let x = 0; x <= s; x += 8) ctx.lineTo(x, y + Math.sin((x / s) * 6.283 * 2 + y) * 3); ctx.stroke(); }
  });
  const dirt = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#dddddd'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 6000, 130, 255, 3);
    for (let k = 0; k < 30; k++) {
      const v = 120 + Math.random() * 110;
      ctx.fillStyle = `rgba(${v},${v},${v},0.2)`;
      ctx.beginPath(); ctx.ellipse(Math.random() * s, Math.random() * s, 6 + Math.random() * 20, 4 + Math.random() * 12, Math.random() * 3, 0, 6.2832); ctx.fill();
    }
  });
  const asphalt = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#d0d0d0'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 6000, 140, 255);
    ctx.strokeStyle = 'rgba(80,80,80,0.5)'; ctx.lineWidth = 1;
    for (let k = 0; k < 5; k++) { ctx.beginPath(); let x = Math.random() * s, y = Math.random() * s; ctx.moveTo(x, y); for (let j = 0; j < 5; j++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; ctx.lineTo(x, y); } ctx.stroke(); }
  });
  const wood = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) { ctx.fillStyle = 'rgba(90,90,90,0.55)'; ctx.fillRect(0, y, s, 2); }
    noise(ctx, s, 900, 150, 230, 6);
  });
  return { sand, dirt, asphalt, wood };
}

export function buildDesert(terrain) {
  const group = new THREE.Group();
  const tex = makeTextures();
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const R = (a, b) => a + rnd() * (b - a);
  terrain.bounds = HALF;
  terrain.fieldMaxSlope = 2.5; // smooth mountainsides: let the tyres feel how steep they really are

  // ---- the ground: natural height on the grid, then flattened where things are built
  const H = new Float32Array(NG * NG);
  const gx = (i) => -HALF + i * CELL;
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) H[j * NG + i] = nat(gx(i), gx(j));
  const surf = new Uint8Array((NG - 1) * (NG - 1)).fill(SURF.dirt);
  terrain.setField(-HALF, -HALF, CELL, NG, H, surf, SURF.dirt);
  const gh = (x, z) => terrain.fieldHeight(x, z);
  const busy = new Float32Array(NG * NG).fill(1e9); // distance to the nearest built thing (for props)
  const kind = new Uint8Array(NG * NG); // ground colour: 0 sand, 1 packed dirt, 2 road shoulder, 3 trail

  // flat building pads (rectangles), blended into the dunes
  function pad(r, blend, k = 1) {
    const t = (gh(r.x0, r.z0) + gh(r.x1, r.z0) + gh(r.x0, r.z1) + gh(r.x1, r.z1) + 2 * gh((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2)) / 6;
    r.y = t;
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
      const x = gx(i), z = gx(j);
      const d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
      if (d > blend) continue;
      const v = j * NG + i, w = 1 - sstep(0, blend, d);
      H[v] += (t - H[v]) * w;
      busy[v] = Math.min(busy[v], d);
      if (d < 2) kind[v] = k;
    }
  }
  pad(CAMP, 26); pad(MX, 34); pad(SEND, 34); pad(DJ, 14);

  // roads and trails: a centre line whose height is the smoothed ground under it, with the
  // ground levelled across it and blended back into the dunes either side
  const ways = [
    { pts: HIGHWAY, halfW: 4.2, smooth: 45, blend: 12, surf: SURF.asphalt, kind: 'road' },
    { pts: MX_ROAD, halfW: 3.6, smooth: 30, blend: 10, surf: SURF.asphalt, kind: 'road' },
    { pts: SEND_ROAD, halfW: 3.6, smooth: 30, blend: 10, surf: SURF.asphalt, kind: 'road' },
    { pts: FIRE_ROAD, halfW: 2.4, smooth: 16, blend: 7, surf: SURF.dirt, kind: 'fire' },
    { pts: TRAIL, halfW: 1.1, smooth: 7, blend: 5, surf: SURF.dirt, kind: 'trail' },
  ];
  for (const w of ways) {
    const S = (w.S = spline(w.pts, 2));
    const raw = S.map((p) => gh(p.x, p.z));
    const n = Math.round(w.smooth / 2);
    S.forEach((p, i) => { let a = 0, c = 0; for (let k = -n; k <= n; k++) { const q = raw[Math.min(S.length - 1, Math.max(0, i + k))]; a += q; c++; } p.y = a / c; });
    const flat = w.halfW + 1.5, rad = flat + w.blend;
    const minD = new Float32Array(NG * NG).fill(1e9), tgt = new Float32Array(NG * NG);
    for (const p of S) {
      const i0 = Math.max(0, Math.floor((p.x - rad + HALF) / CELL)), i1 = Math.min(NG - 1, Math.ceil((p.x + rad + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((p.z - rad + HALF) / CELL)), j1 = Math.min(NG - 1, Math.ceil((p.z + rad + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = j * NG + i, d = Math.hypot(gx(i) - p.x, gx(j) - p.z);
        if (d < minD[v]) { minD[v] = d; tgt[v] = p.y; }
      }
    }
    for (let v = 0; v < NG * NG; v++) {
      const d = minD[v]; if (d > rad) continue;
      const wgt = d <= flat ? 1 : 1 - sstep(flat, rad, d);
      H[v] += (tgt[v] - H[v]) * wgt;
      busy[v] = Math.min(busy[v], d);
      if (d < w.halfW + 2) kind[v] = w.kind === 'trail' ? 3 : w.kind === 'fire' ? 1 : 2;
    }
    w.minD = minD;
    if (w.surf === SURF.asphalt) {
      for (let j = 0; j < NG - 1; j++) for (let i = 0; i < NG - 1; i++) {
        const v = j * NG + i;
        if ((minD[v] + minD[v + 1] + minD[v + NG] + minD[v + NG + 1]) / 4 < w.halfW) surf[j * (NG - 1) + i] = SURF.asphalt;
      }
    }
  }

  // ---- ground mesh: the same triangles the physics uses
  {
    const pos = new Float32Array(NG * NG * 3), col = new Float32Array(NG * NG * 3), uv = new Float32Array(NG * NG * 2);
    const c = new THREE.Color(), sand = new THREE.Color(0xd9b685), rust = new THREE.Color(0xb7794a), packed = new THREE.Color(0xb48b60), trail = new THREE.Color(0x96663f), shoulder = new THREE.Color(0xa58a6c), rock = new THREE.Color(0x9a6a4c);
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
      const v = j * NG + i, x = gx(i), z = gx(j), y = H[v];
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      uv[v * 2] = x / 7; uv[v * 2 + 1] = z / 7;
      const sx = (H[j * NG + Math.min(NG - 1, i + 1)] - H[j * NG + Math.max(0, i - 1)]) / (2 * CELL);
      const sz = (H[Math.min(NG - 1, j + 1) * NG + i] - H[Math.max(0, j - 1) * NG + i]) / (2 * CELL);
      const slope = Math.hypot(sx, sz);
      c.copy(sand).lerp(rust, sstep(0.12, 0.45, slope) * 0.8 + 0.2 * vnoise(x / 25, z / 25, 9));
      if (y > 30) c.lerp(rock, sstep(30, 60, y) * 0.7);
      const k = kind[v];
      if (k === 1) c.lerp(packed, 0.75); else if (k === 2) c.lerp(shoulder, 0.5); else if (k === 3) c.lerp(trail, 0.6);
      const m = 0.9 + 0.14 * vnoise(x / 6, z / 6, 10);
      col[v * 3] = c.r * m; col[v * 3 + 1] = c.g * m; col[v * 3 + 2] = c.b * m;
    }
    const idx = new Uint32Array((NG - 1) * (NG - 1) * 6);
    let n = 0;
    for (let j = 0; j < NG - 1; j++) for (let i = 0; i < NG - 1; i++) {
      const a = j * NG + i, b = a + 1, d = a + NG, e = d + 1;
      idx[n++] = a; idx[n++] = e; idx[n++] = b; // (0,0) (1,1) (1,0)
      idx[n++] = a; idx[n++] = d; idx[n++] = e; // (0,0) (0,1) (1,1)
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex.sand, vertexColors: true }));
    m.receiveShadow = true; m.matrixAutoUpdate = false;
    group.add(m);
    // the desert floor carries on past the mountains
    const far = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: 0xc9a877 }));
    far.rotation.x = -Math.PI / 2; far.position.y = -1; far.matrixAutoUpdate = false; far.updateMatrix();
    group.add(far);
  }

  // ---- road surfaces: ribbons laid on the levelled ground
  const roadB = new Batch(), dirtRoadB = new Batch(), marksB = new Batch();
  for (const w of ways) {
    const S = w.S, b = w.kind === 'road' ? roadB : dirtRoadB, lift = w.kind === 'road' ? 0.05 : 0.035;
    b.color(w.kind === 'road' ? 0x4a4a4e : w.kind === 'fire' ? 0xc29b6c : 0x8f5f3a);
    const edge = (p, off) => { const x = p.x + p.dz * off, z = p.z - p.dx * off; return [x, gh(x, z) + lift, z]; };
    for (let i = 1; i < S.length; i++) {
      const a = S[i - 1], c = S[i];
      const [ax, ay, az] = edge(a, -w.halfW), [bx, by, bz] = edge(c, -w.halfW), [cx, cy, cz] = edge(c, w.halfW), [dx, dy, dz] = edge(a, w.halfW);
      b.quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, 0, a.s / 8, 1, c.s / 8);
    }
    if (w.kind !== 'road') continue;
    // painted lines: dashed yellow centre, solid white edges
    const stripe = (off, half, on, col) => {
      marksB.color(col);
      for (let i = 1; i < S.length; i++) {
        const a = S[i - 1], c = S[i];
        if (on && (a.s % 9) > 4.5) continue;
        const p = (q, o) => { const x = q.x + q.dz * o, z = q.z - q.dx * o; return [x, gh(x, z) + 0.075, z]; };
        const [ax, ay, az] = p(a, off - half), [bx, by, bz] = p(c, off - half), [cx, cy, cz] = p(c, off + half), [dx, dy, dz] = p(a, off + half);
        marksB.quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      }
    };
    stripe(0, 0.08, true, 0xf2c230);
    stripe(-w.halfW + 0.35, 0.08, false, 0xeeeeee); stripe(w.halfW - 0.35, 0.08, false, 0xeeeeee);
  }
  const off = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  group.add(roadB.mesh(new THREE.MeshLambertMaterial({ map: tex.asphalt, vertexColors: true, ...off })));
  group.add(dirtRoadB.mesh(new THREE.MeshLambertMaterial({ map: tex.dirt, vertexColors: true, ...off })));
  group.add(marksB.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));

  // ---- jumps ----------------------------------------------------------------------
  // A jump line is a list of parts laid out along (dx, dz) from (x, z). Heights are above the
  // ground under the centre line; each solid run (between gaps) becomes one terrain profile
  // and one mesh.
  const dirtB = new Batch(), woodB = new Batch(), propB = new Batch();
  const features = []; // for the map
  function jumpLine(x, z, dx, dz, halfW, parts, o = {}) {
    const len = Math.hypot(dx, dz); dx /= len; dz /= len;
    let l = 0, h = 0, run = null, runWood = false;
    const runs = [];
    const add = (dl, nh) => { if (!run) { run = [[l, h]]; runWood = false; } l += dl; h = nh; run.push([l, h]); };
    const close = () => { if (run) { runs.push({ pts: run, wood: runWood }); run = null; } };
    const kick = (H, ang) => {
      const Rr = H / (1 - Math.cos(ang)), n = 8, l0 = l;
      for (let k = 1; k <= n; k++) { const f = (ang * k) / n; add(l0 + Rr * Math.sin(f) - l, Rr * (1 - Math.cos(f))); }
      return l;
    };
    const down = (slope) => { add(h / slope, 0); close(); };
    const land = (ang) => { // the landing: down at `ang`, rounding out at the bottom
      const H0 = h, t = Math.tan(ang);
      add(0.5, H0); add((H0 * 0.8) / t, H0 * 0.2); add((H0 * 0.2) / t + H0 * 0.6, 0); close();
    };
    for (const p of parts) {
      if (p.flat) { close(); l += p.flat; }
      else if (p.roller) { for (let k = 1; k <= 6; k++) add(p.len / 6, p.roller * Math.sin((Math.PI * k) / 6) ** 2); close(); }
      else if (p.table) {
        // tabletop: kick, a flat top, then the landing
        kick(p.table, p.ang); add(p.top, p.table); land(p.land || p.ang * 0.8);
      } else if (p.double) {
        // takeoff and a separate landing: `gap` is lip to the top of the landing
        const lip = kick(p.double, p.ang); add(0.3, p.double); down(1.3);
        const lh = p.lh ?? p.double, face = lh / 1.4;
        l = lip + p.gap - face - 0.3; h = 0;
        add(face, lh); land(p.land || p.ang * 0.8);
      } else if (p.drop) {
        // wooden deck: a ramp up, a flat top, then off the end; a dirt landing below
        add(p.drop * 2.6, p.drop); runWood = true; add(p.deck, p.drop); add(0.02, 0); close();
        l += p.gap; h = 0; add(0.9, p.drop * 0.55); land(0.36);
      } else if (p.whoops) { for (let k = 0; k < p.whoops; k++) { for (let q = 1; q <= 6; q++) add(p.len / 6, p.h * Math.sin((Math.PI * q) / 6) ** 2); } close(); }
      else if (p.stepup) {
        // kick up onto a raised table, then roll off its far end
        const lip = kick(p.lip, p.ang); add(0.3, p.lip); down(1.3);
        l = lip + p.gap - p.stepup / 1.4 - 0.3; h = 0; add(p.stepup / 1.4, p.stepup); add(p.top, p.stepup); land(0.42);
      }
    }
    close();
    const P = (l2, w) => [x + dx * l2 + dz * w, z + dz * l2 - dx * w];
    for (const r of runs) {
      // dense points, each lifted onto the ground under it
      const pts = [];
      for (let k = 0; k < r.pts.length; k++) {
        const [la, ha] = r.pts[k];
        if (k) {
          const [lp, hp] = r.pts[k - 1], n = Math.max(1, Math.ceil((la - lp) / 1.2));
          for (let q = 1; q < n; q++) { const f = q / n, ll = lp + (la - lp) * f; pts.push([ll, hp + (ha - hp) * f]); }
        }
        pts.push([la, ha]);
      }
      const abs = pts.map(([ll, hh]) => { const [px, pz] = P(ll, 0); return [ll, gh(px, pz) + hh, hh]; });
      terrain.addProfile({ x, z, dirX: dx, dirZ: dz, halfW, pts: abs.map(([ll, y]) => [ll, y]), surface: r.wood ? SURF.wood : SURF.dirt });
      const b = r.wood ? woodB : dirtB, top = r.wood ? 0xb08552 : o.top ?? 0xb07e4f, side = r.wood ? 0x6e5032 : o.side ?? 0x9c7048;
      for (let k = 1; k < abs.length; k++) {
        const [la, ya, ha] = abs[k - 1], [lb, yb, hb] = abs[k];
        if (ha < 0.01 && hb < 0.01) continue;
        const [ax, az] = P(la, -halfW), [bx, bz] = P(lb, -halfW), [cx, cz] = P(lb, halfW), [ddx, ddz] = P(la, halfW);
        b.color(top).quad(ax, ya, az, bx, yb, bz, cx, yb, cz, ddx, ya, ddz, 0, la / 3, 1, lb / 3);
        const ga = ya - ha - 0.4, gb = yb - hb - 0.4;
        // dirt sides lean out a little; the deck has straight sides
        const sl = r.wood ? 0 : 0.35;
        const [ax2, az2] = P(la, -halfW - ha * sl), [bx2, bz2] = P(lb, -halfW - hb * sl), [cx2, cz2] = P(lb, halfW + hb * sl), [dx2, dz2] = P(la, halfW + ha * sl);
        b.color(side);
        b.quad(ax2, ga, az2, bx2, gb, bz2, bx, yb, bz, ax, ya, az, 0, 0, (lb - la) / 3, (ha + 0.4) / 3);
        b.quad(cx2, gb, cz2, dx2, ga, dz2, ddx, ya, ddz, cx, yb, cz, 0, 0, (lb - la) / 3, (ha + 0.4) / 3);
        if (k === abs.length - 1 && hb > 0.05) b.quad(bx, gb, bz, cx, gb, cz, cx, yb, cz, bx, yb, bz);
      }
      if (r.wood) { // posts under the deck
        for (let k = 0; k < abs.length; k += 3) { const [ll, yy, hh] = abs[k]; if (hh < 0.3) continue; for (const s of [-1, 1]) { const [px, pz] = P(ll, s * (halfW - 0.1)); woodB.color(0x5b4128).box(px, yy - hh - 0.3, pz, 0.14, hh + 0.25, 0.14); } }
      }
      const [x0, z0] = P(r.pts[0][0], 0), [x1, z1] = P(r.pts[r.pts.length - 1][0], 0);
      features.push({ x0, z0, x1, z1, w: halfW * 2, wood: r.wood });
    }
    return l;
  }

  // the MX park: four lanes heading north from the start line
  const mxStart = MX.z1 - 8, N_ = [0, -1];
  jumpLine(14, mxStart, ...N_, 3, [{ flat: 20 }, { roller: 0.6, len: 5 }, { flat: 6 }, { roller: 0.6, len: 5 }, { flat: 18 }, { table: 1.2, ang: 0.42, top: 6 }, { flat: 22 }, { table: 1.9, ang: 0.5, top: 9 }, { flat: 22 }, { table: 2.4, ang: 0.52, top: 11 }]);
  jumpLine(48, mxStart, ...N_, 3.2, [{ flat: 28 }, { double: 2.2, ang: 0.49, gap: 10 }, { flat: 22 }, { double: 3, ang: 0.52, gap: 15 }, { flat: 22 }, { double: 3, ang: 0.54, gap: 19 }]);
  jumpLine(84, mxStart, ...N_, 3.6, [{ flat: 44 }, { table: 3.4, ang: 0.55, top: 18, land: 0.44 }, { flat: 28 }, { double: 4, ang: 0.57, gap: 26, land: 0.44 }]);
  jumpLine(120, mxStart, ...N_, 3, [{ flat: 24 }, { whoops: 10, len: 4.2, h: 0.65 }, { flat: 22 }, { stepup: 3, lip: 1.6, ang: 0.52, gap: 8, top: 10 }]);
  // the big send: a long run-up, then a 26 m gap
  jumpLine(250, SEND.z1 - 6, ...N_, 4, [{ flat: 140 }, { double: 4.6, ang: 0.55, gap: 26, land: 0.45 }], { top: 0xa57449, side: 0x946640 });
  // the trail: features placed along it, then the dirt jump line at the bottom
  const tS = ways[4].S;
  const along = (s) => { let i = 0; while (i < tS.length - 1 && tS[i].s < s) i++; return tS[i]; };
  const trailFeat = (s, parts) => { const p = along(s); jumpLine(p.x, p.z, p.dx, p.dz, 1.15, parts, { top: 0x9a6b40, side: 0x8a6040 }); };
  trailFeat(22, [{ roller: 0.45, len: 4 }, { flat: 1.5 }, { roller: 0.45, len: 4 }, { flat: 1.5 }, { roller: 0.45, len: 4 }]);
  trailFeat(55, [{ table: 0.8, ang: 0.42, top: 2.5, land: 0.38 }]);
  trailFeat(90, [{ drop: 1.1, deck: 4, gap: 1.6 }]);
  trailFeat(128, [{ double: 0.9, ang: 0.45, gap: 3.6, land: 0.4 }]);
  trailFeat(170, [{ table: 1, ang: 0.45, top: 3.2, land: 0.4 }]);
  trailFeat(212, [{ double: 1, ang: 0.47, gap: 4, land: 0.4 }]);
  jumpLine((DJ.x0 + DJ.x1) / 2, DJ.z0 - 4, 0, 1, 1.5, [{ flat: 6 }, { double: 1.1, ang: 0.49, gap: 4, land: 0.42 }, { flat: 4 }, { double: 1.1, ang: 0.49, gap: 4, land: 0.42 }, { flat: 4 }, { double: 1.2, ang: 0.5, gap: 4.4, land: 0.42 }, { flat: 4 }, { double: 1.3, ang: 0.5, gap: 4.8, land: 0.42 }], { top: 0x9a6b40, side: 0x8a6040 });

  const dirtMat = new THREE.MeshLambertMaterial({ map: tex.dirt, vertexColors: true });
  group.add(dirtB.mesh(dirtMat, { cast: true }), woodB.mesh(new THREE.MeshLambertMaterial({ map: tex.wood, vertexColors: true }), { cast: true }));

  // ---- props ------------------------------------------------------------------------
  const solidBox = (x, z, sx, sy, sz, col, rot = 0, base) => {
    const y = base ?? gh(x, z);
    propB.color(col).box(x, y - 0.3, z, sx, sy + 0.3, sz, { rot });
    terrain.addBox(x, z, sx / 2, sz / 2, rot, y - 1, y + sy);
    terrain.sightBoxes.push({ x0: x - sx / 2, z0: z - sz / 2, x1: x + sx / 2, z1: z + sz / 2 });
  };
  const post = (x, z, h, col = 0x6b4a2f, r = 0.07, solid = true) => { const y = gh(x, z); propB.color(col).box(x, y - 0.2, z, r * 2, h + 0.2, r * 2); if (solid) terrain.addCircle(x, z, r + 0.02, y - 1, y + h); };
  // signs: text on a board between two posts
  const signs = [];
  function sign(lines, w, h, x, z, rot, up = 2.2) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round((512 * h) / w);
    const c = cv.getContext('2d');
    c.fillStyle = '#2a2420'; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = '#e9c46a'; c.lineWidth = 10; c.strokeRect(8, 8, cv.width - 16, cv.height - 16);
    let y = cv.height / (lines.length + 1);
    for (const [t, col, size] of lines) { c.fillStyle = col; c.font = `900 ${size}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, cv.width / 2, y); y += cv.height / (lines.length + 1); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const g = gh(x, z);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }));
    m.position.set(x, g + up + h / 2, z); m.rotation.y = rot; m.castShadow = true;
    // the same face on the back, so it reads the right way round from both sides
    const back = new THREE.Mesh(m.geometry, new THREE.MeshLambertMaterial({ map: t }));
    back.position.copy(m.position); back.rotation.y = rot + Math.PI; back.position.x -= Math.sin(rot) * 0.02; back.position.z -= Math.cos(rot) * 0.02;
    m.material.side = THREE.FrontSide;
    group.add(m, back); signs.push(m);
    const ox = Math.cos(rot) * (w / 2 - 0.15), oz = -Math.sin(rot) * (w / 2 - 0.15);
    post(x - ox, z - oz, up + h, 0x4a3a2a, 0.1); post(x + ox, z + oz, up + h, 0x4a3a2a, 0.1);
  }

  // base camp: a trailer, a shade canopy, a water tank, barrels and the spawn
  {
    const cx = 0, cz = 46, y = CAMP.y;
    solidBox(cx + 15, cz + 6, 3, 3, 9, 0xe8e2d4, 0.15, y);
    propB.color(0x3d7fa6).box(cx + 15, y + 1.2, cz + 6, 3.06, 0.4, 9.06, { rot: 0.15 });
    for (const [px, pz] of [[-15, -2], [-7, -2], [-15, 6], [-7, 6]]) post(cx + px, cz + pz, 3.2, 0x8a8f96, 0.08);
    propB.color(0xd2482f).box(cx - 11, y + 3.2, cz + 2, 9.4, 0.12, 9.4);
    for (const [px, pz] of [[-20, 14], [-17.6, 14], [-20, 16.4], [-17.6, 16.4]]) post(cx + px, cz + pz, 4, 0x6f7378, 0.1);
    propB.color(0x9fa6ad).geom(new THREE.CylinderGeometry(1.8, 1.8, 3, 16), mat(cx - 18.8, y + 5.5, cz + 15.2));
    for (let k = 0; k < 5; k++) { const bx = cx + 20 + (k % 3) * 1.1, bz = cz - 6 + Math.floor(k / 3) * 1.1; propB.color(k % 2 ? 0x2f6fb8 : 0xc0392b).geom(new THREE.CylinderGeometry(0.42, 0.42, 1.2, 12), mat(bx, y + 0.6, bz)); terrain.addCircle(bx, bz, 0.42, y - 1, y + 1.2); }
    sign([['DESERT CAMP', '#e9c46a', 96], ['MX PARK ↑ · BIG SEND → · TRAIL ←', '#ffffff', 40]], 9, 2.6, cx, cz + 24, 0, 1.2);
  }
  // MX park: a start banner, lane boards and tyre walls at the far end
  {
    const y = MX.y;
    sign([['MX PARK', '#ffb000', 120], ['1 TABLES · 2 DOUBLES · 3 BIG · 4 WHOOPS', '#ffffff', 38]], 14, 3.2, 66, MX.z1 + 2, 0, 3);
    const lanes = [[14, '1'], [48, '2'], [84, '3'], [120, '4']];
    for (const [lx, n] of lanes) sign([[n, '#ffffff', 220]], 2.2, 2.2, lx - 5.5, mxStart - 4, 0, 0.6);
    for (let k = 0; k < 28; k++) { const tx = -2 + k * 5, tz = MX.z0 + 4; if (lanes.some(([lx]) => Math.abs(tx - lx) < 6)) continue; propB.color(0x1d1d1f).geom(new THREE.TorusGeometry(0.42, 0.2, 6, 12).rotateX(Math.PI / 2), mat(tx, y + 0.2, tz)).geom(new THREE.TorusGeometry(0.42, 0.2, 6, 12).rotateX(Math.PI / 2), mat(tx, y + 0.6, tz)); terrain.addCircle(tx, tz, 0.62, y - 1, y + 0.8); }
  }
  sign([['BIG SEND', '#ff6a2a', 130], ['26 m gap · motor bikes, full gas', '#ffffff', 40]], 9, 2.6, 238, SEND.z1 - 2, 0, 1.5);
  {
    const top = along(4);
    sign([['RIDGE TRAIL', '#7fd17a', 110], ['MTB · rollers, tables, a drop, doubles', '#ffffff', 36]], 8, 2.4, top.x + 5, top.z + 2, Math.atan2(top.dx, top.dz), 1.2);
    sign([['DIRT JUMPS', '#7fd17a', 110]], 6, 1.6, DJ.x1 + 4, DJ.z0 - 6, Math.PI / 2, 1.2);
    // marker posts along the trail
    for (let i = 4; i < tS.length - 2; i += 6) { const p = tS[i], sd = i % 12 ? 1 : -1; post(p.x + p.dz * 2.8 * sd, p.z - p.dx * 2.8 * sd, 1.1, 0x7a5a3a, 0.05, false); } // thin stakes: you'd knock them over
    const fr = ways[3].S[2];
    sign([['FIRE ROAD ↑', '#e9c46a', 90], ['climb to the ridge trail', '#ffffff', 40]], 6, 1.8, fr.x + 5, fr.z, Math.PI / 2, 1);
  }

  // the highway ends at the mountains: barriers across it
  for (const end of [0, 1]) {
    const S = ways[0].S, p = end ? S[S.length - 1] : S[0], q = end ? S[S.length - 4] : S[3];
    const dx = p.x - q.x, dz = p.z - q.z, l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l, rot = Math.atan2(ux, uz);
    for (let k = -2; k <= 2; k++) {
      const bx = p.x + uz * k * 2, bz = p.z - ux * k * 2, y = gh(bx, bz);
      propB.color(k % 2 ? 0xd23a2a : 0xeeeeee).box(bx, y - 0.1, bz, 1.9, 1.05, 0.6, { rot });
      terrain.addBox(bx, bz, 0.95, 0.3, rot, y - 1, y + 0.95);
    }
    sign([['ROAD CLOSED', '#ffffff', 110]], 5, 1.3, p.x + ux * 1.5, p.z + uz * 1.5, rot, 1.1);
  }

  // cacti, rocks and dry bushes, kept off the roads, the trail and the jumps
  const free = (x, z, r) => {
    const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
    if (i < 1 || j < 1 || i >= NG - 1 || j >= NG - 1) return false;
    return busy[j * NG + i] > r && H[j * NG + i] < 34;
  };
  const cacti = [], rocks = [], bushes = [];
  for (let k = 0; k < 1400 && cacti.length < 230; k++) { const x = R(-420, 420), z = R(-420, 420); if (free(x, z, 9)) cacti.push({ x, z, s: R(0.7, 1.35), r: R(0, 6.28), arms: rnd() }); }
  for (let k = 0; k < 1400 && rocks.length < 170; k++) { const x = R(-440, 440), z = R(-440, 440); if (free(x, z, 8)) rocks.push({ x, z, s: R(0.6, 2.4), r: R(0, 6.28) }); }
  for (let k = 0; k < 1400 && bushes.length < 320; k++) { const x = R(-440, 440), z = R(-440, 440); if (free(x, z, 5)) bushes.push({ x, z, s: R(0.5, 1.2), r: R(0, 6.28) }); }
  const inst = (b, list, place, material) => {
    const im = new THREE.InstancedMesh(b.geometry(), material || new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
    const col = new THREE.Color();
    list.forEach((t, k) => { const [m, c] = place(t); im.setMatrixAt(k, m); if (c !== undefined) im.setColorAt(k, col.setHex(c)); });
    im.castShadow = true; group.add(im);
  };
  {
    const b = new Batch().color(0x4f7a3a);
    b.geom(new THREE.CylinderGeometry(0.26, 0.3, 3.4, 8), mat(0, 1.7, 0)).geom(new THREE.SphereGeometry(0.26, 8, 4, 0, 6.283, 0, 1.6), mat(0, 3.4, 0));
    b.geom(new THREE.CylinderGeometry(0.17, 0.17, 0.8, 7), mat(0.5, 1.5, 0, 0, 0, Math.PI / 2)).geom(new THREE.CylinderGeometry(0.17, 0.17, 1.2, 7), mat(0.85, 2.05, 0)).geom(new THREE.SphereGeometry(0.17, 7, 3, 0, 6.283, 0, 1.6), mat(0.85, 2.65, 0));
    b.geom(new THREE.CylinderGeometry(0.15, 0.15, 0.7, 7), mat(-0.45, 2.1, 0, 0, 0, Math.PI / 2)).geom(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 7), mat(-0.75, 2.5, 0)).geom(new THREE.SphereGeometry(0.15, 7, 3, 0, 6.283, 0, 1.6), mat(-0.75, 2.95, 0));
    inst(b, cacti, (t) => { const y = gh(t.x, t.z); terrain.addCircle(t.x, t.z, 0.3 * t.s, y - 1, y + 3.4 * t.s); return [mat(t.x, y - 0.1, t.z, 0, t.r, 0, t.s)]; });
  }
  {
    const b = new Batch().color(0xffffff).geom(new THREE.IcosahedronGeometry(1, 0), mat(0, 0, 0, 0, 0, 0, 1, 0.62, 0.85));
    const cols = [0x9a5d3c, 0xa8704c, 0x8a5a40, 0xb38360];
    inst(b, rocks, (t) => { const y = gh(t.x, t.z); terrain.addCircle(t.x, t.z, 0.8 * t.s, y - 1, y + 0.5 * t.s); return [mat(t.x, y + 0.05 * t.s, t.z, 0, t.r, 0, t.s), cols[Math.floor(t.s * 7) % 4]]; }, new THREE.MeshLambertMaterial({ map: tex.dirt }));
  }
  {
    const b = new Batch().color(0x8d7a4a).geom(new THREE.IcosahedronGeometry(0.6, 0), mat(0, 0.35, 0, 0, 0, 0, 1, 0.7, 1)).color(0x7a6a3c).geom(new THREE.IcosahedronGeometry(0.45, 0), mat(0.4, 0.3, 0.2));
    inst(b, bushes, (t) => [mat(t.x, gh(t.x, t.z), t.z, 0, t.r, 0, t.s)]);
  }
  group.add(propB.mesh(new THREE.MeshLambertMaterial({ vertexColors: true }), { cast: true }));
  group.traverse((o) => { if (o.isMesh && !o.matrixAutoUpdate) o.updateMatrix(); });

  // ---- map picture for the HUD: shaded relief, roads, the trail and the jumps
  const drawMap = (c, size) => {
    const img = c.createImageData(size, size), d = img.data, k = (HALF * 2) / size;
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const x = -HALF + (px + 0.5) * k, z = -HALF + (py + 0.5) * k;
      const h = gh(x, z), hx = gh(x + k, z) - h, hz = gh(x, z + k) - h;
      const shade = Math.max(0.55, Math.min(1.25, 1 + (hx * 0.7 + hz * 0.7) / k * 1.4)); // lit from the north-west
      const t = Math.min(1, h / 45), o = (py * size + px) * 4;
      d[o] = (196 - 60 * t) * shade; d[o + 1] = (160 - 70 * t) * shade; d[o + 2] = (112 - 50 * t) * shade; d[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    const T = (x, z) => [(x + HALF) / k, (z + HALF) / k];
    for (const r of [CAMP, MX, SEND, DJ]) { const [a, b] = T(r.x0, r.z0), [e, f] = T(r.x1, r.z1); c.fillStyle = 'rgba(150,108,70,0.55)'; c.fillRect(a, b, e - a, f - b); }
    for (const w of ways) {
      c.strokeStyle = w.kind === 'road' ? '#3b3b40' : w.kind === 'fire' ? '#d8b483' : '#6a3f22';
      c.lineWidth = w.kind === 'road' ? 5 : w.kind === 'fire' ? 3 : 2.5; c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath(); w.S.forEach((p, i) => { const [a, b] = T(p.x, p.z); if (i) c.lineTo(a, b); else c.moveTo(a, b); }); c.stroke();
    }
    c.lineCap = 'butt';
    for (const f of features) { c.strokeStyle = f.wood ? '#c8a070' : '#5b3518'; c.lineWidth = Math.max(2, f.w / k); const [a, b] = T(f.x0, f.z0), [e, g] = T(f.x1, f.z1); c.beginPath(); c.moveTo(a, b); c.lineTo(e, g); c.stroke(); }
  };

  const spots = {
    home: { x: 0, z: 40, yaw: Math.PI },
    pois: [
      { x: 66, z: MX.z1 - 4, name: 'the MX park', color: '#ffb000', letter: 'M' },
      { x: 250, z: SEND.z1 - 4, name: 'the Big Send', color: '#ff6a2a', letter: 'B' },
      { x: tS[0].x, z: tS[0].z, name: 'the top of the ridge trail', color: '#7fd17a', letter: 'T' },
      { x: (DJ.x0 + DJ.x1) / 2, z: DJ.z0 - 6, name: 'the dirt jumps', color: '#7fd17a', letter: 'D' },
    ],
  };
  const dummy = new THREE.MeshLambertMaterial();
  return { group, mats: { walls: dummy, water: dummy }, parked: [], blocks: [], spots, lampHeads: null, lampPools: null, lamps: [], carColors: [0xffffff], desert: true, map: { world: HALF * 2, draw: drawMap }, paths: { trail: tS, fire: ways[3].S } };
}
