// Procedural city: an 8x8 grid of blocks on an island, with themed districts.
// Builds render meshes and fills the Terrain with matching height shapes/colliders.
import * as THREE from 'three';
import { Batch, canvasTexture, mulberry, mat, rgb } from './geo.js';
import { SURF } from './terrain.js';

export const N = 8;
export const PITCH = 88;
export const ROAD_HALF = 8;
export const CURB = 0.15;
export const WALK = 4;
export const EDGE = (N / 2) * PITCH + ROAD_HALF; // outer kerb of the ring road
export const roadC = (i) => (i - N / 2) * PITCH;

// L lowrise, M midrise, T towers, K park, D dirt jumps, S skate plaza, R skate park,
// P parking, C construction, V civic plaza, H home / bike shop
const LAYOUT = [
  'LMMPMMLC',
  'MTTMMTML',
  'MTKKTTMM',
  'PMKKTVTM',
  'MTTSTTMP',
  'LMTTHMDL',
  'MMPMRMMM',
  'CLMMLPML',
];

const BLD = [0xc9b8a0, 0x9aa5ad, 0xb5674a, 0xd8d2c4, 0x7d8a96, 0xa89f91, 0x8c5a44, 0xe0d6c2, 0x6f7b85, 0xbfa58a, 0xa8553f, 0xcfc4ae];
const GLASS = [0x7f9bb5, 0x8fa9bd, 0x6d8196, 0xa0b4c4, 0x5f7890, 0x9fb0a8, 0x77889c];
const CARCOL = [0xc8c8c8, 0x1c1c1e, 0x8a1f1f, 0x1f3f8a, 0xeeeeee, 0x4a4f55, 0x2f6b46, 0xd4a017, 0x7a7f86, 0x5a2d82, 0xc2571a, 0xf2f2f2];

function makeTextures() {
  const noise = (ctx, s, n, a, b) => {
    for (let k = 0; k < n; k++) {
      const v = a + Math.random() * (b - a);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  };
  const asphalt = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#d6d6d6'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 9000, 150, 255);
    ctx.strokeStyle = 'rgba(90,90,90,0.5)'; ctx.lineWidth = 1.2;
    for (let k = 0; k < 7; k++) {
      ctx.beginPath(); let x = Math.random() * s, y = Math.random() * s; ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (Math.random() - 0.5) * 90; y += (Math.random() - 0.5) * 90; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120,120,120,0.35)';
    for (let k = 0; k < 5; k++) ctx.fillRect(Math.random() * s, Math.random() * s, 30 + Math.random() * 60, 20 + Math.random() * 40);
  });
  const concrete = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#e9e9e9'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 3000, 190, 255);
    ctx.strokeStyle = 'rgba(110,110,110,0.8)'; ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s / 2, s / 2); ctx.strokeRect(s / 2, 0, s / 2, s / 2);
    ctx.strokeRect(0, s / 2, s / 2, s / 2); ctx.strokeRect(s / 2, s / 2, s / 2, s / 2);
  });
  const grass = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#dcdcdc'; ctx.fillRect(0, 0, s, s);
    for (let k = 0; k < 5000; k++) {
      const v = 150 + Math.random() * 105;
      ctx.fillStyle = `rgba(${v * 0.9},${v},${v * 0.8},0.6)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1.5, 3 + Math.random() * 3);
    }
  });
  const dirt = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#dddddd'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 5000, 140, 255);
    for (let k = 0; k < 40; k++) {
      const v = 120 + Math.random() * 110;
      ctx.fillStyle = `rgba(${v},${v * 0.95},${v * 0.88},0.22)`;
      ctx.beginPath(); ctx.ellipse(Math.random() * s, Math.random() * s, 8 + Math.random() * 26, 6 + Math.random() * 16, Math.random() * 3, 0, 6.2832); ctx.fill();
    }
  });
  // 4x4 windows per repeat. One map for daylight, one emissive for night.
  const cells = [];
  for (let k = 0; k < 16; k++) cells.push(Math.random());
  const windows = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, s, s);
    const c = s / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const r = cells[y * 4 + x];
      const g = ctx.createLinearGradient(0, y * c, 0, y * c + c);
      const b = 40 + r * 50;
      g.addColorStop(0, `rgb(${b + 30},${b + 55},${b + 80})`); g.addColorStop(1, `rgb(${b},${b + 15},${b + 35})`);
      ctx.fillStyle = '#8f8f8f'; ctx.fillRect(x * c + 9, y * c + 11, c - 18, c - 20);
      ctx.fillStyle = g; ctx.fillRect(x * c + 11, y * c + 13, c - 22, c - 24);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x * c + c / 2 - 1, y * c + 13, 2, c - 24);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < 4; y++) ctx.fillRect(0, y * c + c - 4, s, 3);
  }, { aniso: 8 });
  const lit = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, s, s);
    const c = s / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const r = cells[y * 4 + x];
      if (r > 0.42) continue;
      ctx.fillStyle = r < 0.14 ? '#ffe2a0' : r < 0.3 ? '#ffd27a' : '#bfe3ff';
      ctx.fillRect(x * c + 11, y * c + 13, c - 22, c - 24);
    }
  }, { aniso: 8 });
  return { asphalt, concrete, grass, dirt, windows, lit };
}

export function buildCity(terrain, { seed = 7, quality = 2 } = {}) {
  const rnd = mulberry(seed);
  const R = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const tex = makeTextures();
  const group = new THREE.Group();

  const B = {
    ground: new Batch(), walk: new Batch(), grass: new Batch(), dirt: new Batch(), marks: new Batch(),
    walls: new Batch(), props: new Batch(), flat: new Batch(),
  };
  const trees = [], lamps = [], parked = [], blocks = [];
  const spots = { ramps: [], home: null, dealer: null, customs: null };

  terrain.bounds = EDGE + WALK;

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  const P = (s, l, w) => [s.x + s.dirX * l + s.dirZ * w, s.z + s.dirZ * l - s.dirX * w];

  // Ramp / stairs / jump: adds the collision profile and a matching mesh.
  function ramp(x, z, dirX, dirZ, halfW, pts, o = {}) {
    const len = Math.hypot(dirX, dirZ); dirX /= len; dirZ /= len;
    const s = { x, z, dirX, dirZ, halfW, pts, base: o.base || 0, surface: o.surface ?? SURF.wood, steps: o.steps || 0, smooth: !!o.smooth };
    terrain.addProfile(s);
    const b = o.batch || B.props;
    const top = o.color ?? 0xa9824f, side = o.side ?? 0x6e5433;
    // expand into flat/sloped spans
    const spans = [];
    if (s.steps) {
      const [l0, h0] = pts[0], [l1, h1] = pts[pts.length - 1];
      const dl = (l1 - l0) / s.steps;
      for (let k = 0; k < s.steps; k++) { const h = h0 + ((h1 - h0) * (k + 1)) / s.steps; spans.push([l0 + k * dl, h, l0 + (k + 1) * dl, h]); }
    } else {
      for (let k = 1; k < pts.length; k++) {
        const [la, ha] = pts[k - 1], [lb, hb] = pts[k];
        const sub = s.smooth && ha !== hb ? 6 : 1;
        for (let j = 0; j < sub; j++) {
          const f0 = j / sub, f1 = (j + 1) / sub;
          const e0 = s.smooth ? f0 * f0 * (3 - 2 * f0) : f0, e1 = s.smooth ? f1 * f1 * (3 - 2 * f1) : f1;
          spans.push([la + (lb - la) * f0, ha + (hb - ha) * e0, la + (lb - la) * f1, ha + (hb - ha) * e1]);
        }
      }
    }
    const y = (h) => s.base + h;
    const W = halfW;
    let prevH = 0;
    for (let k = 0; k < spans.length; k++) {
      const [la, ha, lb, hb] = spans[k];
      const [ax, az] = P(s, la, -W), [bx, bz] = P(s, lb, -W), [cx, cz] = P(s, lb, W), [dx, dz] = P(s, la, W);
      b.color(top).quad(ax, y(ha), az, bx, y(hb), bz, cx, y(hb), cz, dx, y(ha), dz);
      b.color(side);
      if (ha > 0.01 || hb > 0.01) {
        b.quad(ax, s.base, az, bx, s.base, bz, bx, y(hb), bz, ax, y(ha), az);
        b.quad(cx, s.base, cz, dx, s.base, dz, dx, y(ha), dz, cx, y(hb), cz);
      }
      // riser at the start of this span
      if (Math.abs(ha - prevH) > 0.01) {
        const lo = Math.min(ha, prevH), hi = Math.max(ha, prevH);
        if (ha > prevH) b.quad(dx, y(lo), dz, ax, y(lo), az, ax, y(hi), az, dx, y(hi), dz);
        else b.quad(ax, y(lo), az, dx, y(lo), dz, dx, y(hi), dz, ax, y(hi), az);
      }
      prevH = hb;
      if (k === spans.length - 1 && hb > 0.01) b.quad(bx, s.base, bz, cx, s.base, cz, cx, y(hb), cz, bx, y(hb), bz);
    }
    return s;
  }

  function kicker(x, z, dirX, dirZ, len, h, halfW = 1.1, o = {}) {
    spots.ramps.push({ x, z });
    return ramp(x, z, dirX, dirZ, halfW, [[0, 0], [len * 0.5, h * 0.38], [len, h]], { base: CURB, ...o });
  }

  function platform(x0, z0, x1, z1, h, color, surface = SURF.concrete, base = CURB, batch = B.props) {
    terrain.addRect(x0, z0, x1, z1, base + h, surface);
    batch.color(color).box((x0 + x1) / 2, base, (z0 + z1) / 2, x1 - x0, h, z1 - z0);
  }

  function building(x0, z0, x1, z1, h, color, o = {}) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
    const base = o.base ?? CURB;
    B.walls.color(color).box(cx, base, cz, sx, h, sz, { uvW: 12, uvH: 12.8, top: false });
    B.flat.color(o.roof ?? 0x4a4d52).quad(x0, base + h, z1, x1, base + h, z1, x1, base + h, z0, x0, base + h, z0);
    // parapet + ground-floor band
    B.flat.color(o.band ?? 0x4a4f58).box(cx, base, cz, sx + 0.3, 3.3, sz + 0.3, { top: false });
    B.flat.color(color).box(cx, base + h, cz, sx + 0.4, 0.7, sz + 0.4, { top: 0x55585e });
    const nUnits = Math.min(3, Math.floor((sx * sz) / 350));
    for (let k = 0; k < nUnits; k++) {
      const ux = R(x0 + 3, x1 - 3), uz = R(z0 + 3, z1 - 3), uw = R(2, 4), uh = R(1.2, 2.5), ud = R(2, 4);
      B.flat.color(0x8d9197).box(ux, base + h, uz, uw, uh, ud);
      terrain.addRect(ux - uw / 2, uz - ud / 2, ux + uw / 2, uz + ud / 2, base + h + uh, SURF.metal);
      terrain.addBox(ux, uz, uw / 2, ud / 2, 0, base + h, base + h + uh - (uh > 1.6 ? 0.45 : 0));
    }
    if (h > 60 && rnd() < 0.5) B.flat.color(0x70757c).box(cx, base + h, cz, 0.5, R(8, 16), 0.5);
    if (o.awning) {
      const col = pick([0xb8392e, 0x2e6fb8, 0x2e9c5a, 0xd9a11a, 0x444444]);
      for (const side of o.awning) {
        if (side === 'n') B.flat.color(col).box(cx, base + 2.9, z0 - 0.8, sx * 0.8, 0.25, 1.6);
        if (side === 's') B.flat.color(col).box(cx, base + 2.9, z1 + 0.8, sx * 0.8, 0.25, 1.6);
        if (side === 'w') B.flat.color(col).box(x0 - 0.8, base + 2.9, cz, 1.6, 0.25, sz * 0.8);
        if (side === 'e') B.flat.color(col).box(x1 + 0.8, base + 2.9, cz, 1.6, 0.25, sz * 0.8);
      }
    }
    // the roof is the top of the parapet slab, and it is solid: land on it, ride across it
    const roof = base + h + 0.7;
    terrain.addRect(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, roof, SURF.concrete);
    // the side walls stop just under the roof, so landing hard on top (wheels and frame
    // dipping into the roof for a moment) never shoves the bike sideways off the edge
    terrain.addBox(cx, cz, sx / 2 + 0.2, sz / 2 + 0.2, 0, 0, roof - 0.45);
    if (h > 5) terrain.sightBoxes.push({ x0, z0, x1, z1 });
  }

  function tree(x, z, s = 1) {
    trees.push({ x, z, s: s * R(0.85, 1.25), r: rnd() * 6.28, y: terrain.height(x, z) });
    terrain.addCircle(x, z, 0.24, 0, 4);
  }
  function lamp(x, z, rot) { lamps.push({ x, z, rot }); terrain.addCircle(x, z, 0.11, 0, 6); }
  function bollard(x, z, base = CURB) {
    B.props.color(0xd8b400).box(x, base, z, 0.16, 0.9, 0.16, { top: 0x2a2a2a });
    terrain.addCircle(x, z, 0.1, 0, base + 0.9);
  }
  function crate(x, z, sx, sy, sz, color, rot = 0, base = CURB, top) {
    B.props.color(color).box(x, base, z, sx, sy, sz, { rot, top });
    const q = Math.abs(Math.sin(2 * rot)) < 1e-3, sw = Math.abs(Math.sin(rot)) > 0.5;
    if (q) { const hx = (sw ? sz : sx) / 2, hz = (sw ? sx : sz) / 2; terrain.addRect(x - hx, z - hz, x + hx, z + hz, base + sy, SURF.metal); }
    terrain.addBox(x, z, sx / 2, sz / 2, rot, 0, base + sy - (q ? Math.min(0.45, sy * 0.35) : 0));
  }
  const dumpster = (x, z, rot) => crate(x, z, 1.9, 1.3, 1.1, pick([0x2f5d3a, 0x2b4a7a, 0x555a5f]), rot, CURB, 0x1d1f22);
  function bench(x, z, rot) {
    B.props.color(0x7a5a3a).box(x, CURB + 0.4, z, 1.8, 0.08, 0.5, { rot, bottom: true });
    B.props.color(0x333333).box(x, CURB, z, 1.6, 0.4, 0.08, { rot });
    terrain.addBox(x, z, 0.9, 0.25, rot, 0, CURB + 0.5);
  }
  function cone(x, z, base = 0) {
    B.props.color(0xf26a1b).geom(new THREE.ConeGeometry(0.17, 0.55, 8), mat(x, base + 0.28, z));
  }
  function fence(x0, z0, x1, z1, h = 1.6, color = 0x8a6f4a) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0);
    const rot = Math.atan2(-(z1 - z0), x1 - x0);
    B.props.color(color).box(cx, CURB, cz, len, h, 0.12, { rot });
    terrain.addBox(cx, cz, len / 2, 0.12, rot, 0, CURB + h);
  }
  function parkCar(x, z, rot, y = 0) {
    const type = rnd() < 0.3 ? 1 : 0;
    parked.push({ x, z, rot, y, type, color: pick(CARCOL) });
    terrain.addBox(x, z, 0.95, type ? 2.45 : 2.2, rot, 0, y + (type ? 1.9 : 1.45));
  }

  // ------------------------------------------------------------------
  // ground, roads, markings
  // ------------------------------------------------------------------
  const far = EDGE + WALK;
  B.ground.color(0x5a5d63).flat(-far, -far, far, far, 0, 9);

  for (let i = 0; i <= N; i++) {
    const c = roadC(i);
    for (let j = 0; j < N; j++) {
      const a = roadC(j) + 11.4, b = roadC(j + 1) - 11.4;
      // centre double yellow + parking-lane edge lines, for the N-S and the E-W road
      B.marks.color(0xd9b21c);
      B.marks.flat(c - 0.22, a, c - 0.1, b, 0.02).flat(c + 0.1, a, c + 0.22, b, 0.02);
      B.marks.flat(a, c - 0.22, b, c - 0.1, 0.02).flat(a, c + 0.1, b, c + 0.22, 0.02);
      B.marks.color(0xd8d8d8);
      for (const o of [-5.7, 5.7]) { B.marks.flat(c + o - 0.06, a + 4, c + o + 0.06, b - 4, 0.02); B.marks.flat(a + 4, c + o - 0.06, b - 4, c + o + 0.06, 0.02); }
      // lane dashes
      for (let t = a + 3; t < b - 3; t += 9) {
        for (const o of [-2.95, 2.95]) { B.marks.flat(c + o - 0.05, t, c + o + 0.05, t + 3, 0.02); B.marks.flat(t, c + o - 0.05, t + 3, c + o + 0.05, 0.02); }
      }
      // crosswalks + stop lines at both ends
      for (const [e, dir] of [[a, -1], [b, 1]]) {
        for (let k = -7; k < 7; k += 1.4) {
          B.marks.flat(c + k + 0.2, Math.min(e + dir * 0.4, e + dir * 2.8), c + k + 0.9, Math.max(e + dir * 0.4, e + dir * 2.8), 0.02);
          B.marks.flat(Math.min(e + dir * 0.4, e + dir * 2.8), c + k + 0.2, Math.max(e + dir * 0.4, e + dir * 2.8), c + k + 0.9, 0.02);
        }
        // stop line across the approaching lane (right-hand traffic)
        const sx0 = dir > 0 ? c - 5.6 : c + 0.3, sx1 = dir > 0 ? c - 0.3 : c + 5.6;
        B.marks.flat(sx0, e - 0.5, sx1, e - 0.1, 0.02);
        const sz0 = dir > 0 ? c + 0.3 : c - 5.6, sz1 = dir > 0 ? c + 5.6 : c - 0.3;
        B.marks.flat(e - 0.5, sz0, e - 0.1, sz1, 0.02);
      }
      // kerb-side parked cars
      for (const side of [-1, 1]) {
        for (let t = a + 9; t < b - 9; t += 6.2) {
          if (rnd() < 0.13) parkCar(c + side * 6.85, t + R(-0.4, 0.4), side > 0 ? Math.PI : 0);
          if (rnd() < 0.13) parkCar(t + R(-0.4, 0.4), c + side * 6.85, side > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
      }
    }
  }

  // outer promenade + sea wall
  const e0 = EDGE, e1 = EDGE + WALK;
  for (const [x0, z0, x1, z1] of [[-e1, -e1, e1, -e0], [-e1, e0, e1, e1], [-e1, -e0, -e0, e0], [e0, -e0, e1, e0]]) {
    terrain.addRect(x0, z0, x1, z1, CURB, SURF.concrete);
    B.walk.color(0xb9b6ae).flat(x0, z0, x1, z1, CURB, 3);
  }
  B.walk.color(0x9a9890);
  B.walk.quad(-e0, 0, -e0, e0, 0, -e0, e0, CURB, -e0, -e0, CURB, -e0).quad(e0, 0, e0, -e0, 0, e0, -e0, CURB, e0, e0, CURB, e0);
  B.walk.quad(-e0, 0, e0, -e0, 0, -e0, -e0, CURB, -e0, -e0, CURB, e0).quad(e0, 0, -e0, e0, 0, e0, e0, CURB, e0, e0, CURB, -e0);
  for (const [cx, cz, sx, sz] of [[0, -e1, 2 * e1 + 1, 0.6], [0, e1, 2 * e1 + 1, 0.6], [-e1, 0, 0.6, 2 * e1], [e1, 0, 0.6, 2 * e1]]) {
    B.props.color(0xa7a399).box(cx, CURB, cz, sx, 1.0, sz);
    terrain.addBox(cx, cz, sx / 2 + 0.1, sz / 2 + 0.1, 0, 0, 50);
  }

  // ------------------------------------------------------------------
  // blocks
  // ------------------------------------------------------------------
  function baseBlock(x0, z0, x1, z1, type) {
    terrain.addRect(x0, z0, x1, z1, CURB, SURF.concrete);
    B.walk.color(0xbdbab2).flat(x0, z0, x1, z1, CURB, 3);
    B.walk.color(0x9a9890);
    B.walk.quad(x0, 0, z1, x1, 0, z1, x1, CURB, z1, x0, CURB, z1).quad(x1, 0, z0, x0, 0, z0, x0, CURB, z0, x1, CURB, z0);
    B.walk.quad(x1, 0, z1, x1, 0, z0, x1, CURB, z0, x1, CURB, z1).quad(x0, 0, z0, x0, 0, z1, x0, CURB, z1, x0, CURB, z0);
    // kerb ramps by every crosswalk
    const wedge = (x, z, dx, dz) => ramp(x, z, dx, dz, 1.6, [[0, CURB], [0.75, 0]], { color: 0xa5a29a, side: 0x8d8a82, surface: SURF.concrete, batch: B.walk });
    for (const [x, sx] of [[x0 + 2, 1], [x1 - 2, -1]]) { wedge(x, z0, 0, -1); wedge(x, z1, 0, 1); }
    for (const [z, sz] of [[z0 + 2, 1], [z1 - 2, -1]]) { wedge(x0, z, -1, 0); wedge(x1, z, 1, 0); }
    // street lamps + a few sidewalk trees
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (const t of [-18, 18]) {
      lamp(cx + t, z0 + 0.7, Math.PI); lamp(cx + t, z1 - 0.7, 0);
      lamp(x0 + 0.7, cz + t, -Math.PI / 2); lamp(x1 - 0.7, cz + t, Math.PI / 2);
    }
    if (type !== 'T' && type !== 'P' && type !== 'C' && type !== 'R') {
      for (const t of [-28, -8, 8, 28]) {
        if (rnd() < 0.7) tree(cx + t, z0 + 1.3, 0.8); if (rnd() < 0.7) tree(cx + t, z1 - 1.3, 0.8);
        if (rnd() < 0.7) tree(x0 + 1.3, cz + t, 0.8); if (rnd() < 0.7) tree(x1 - 1.3, cz + t, 0.8);
      }
    }
    if (type !== 'P') terrain.carBlocks.push({ x0: x0 + 0.2, z0: z0 + 0.2, x1: x1 - 0.2, z1: z1 - 0.2 });
  }

  function surfacePatch(x0, z0, x1, z1, kind) {
    const b = kind === 'grass' ? B.grass : kind === 'dirt' ? B.dirt : B.ground;
    const col = kind === 'grass' ? 0x6aab4e : kind === 'dirt' ? 0xa98252 : 0x63666c;
    terrain.addRect(x0, z0, x1, z1, CURB, kind === 'grass' ? SURF.grass : kind === 'dirt' ? SURF.dirt : SURF.asphalt);
    b.color(col).flat(x0, z0, x1, z1, CURB + 0.004, kind === 'asphalt' ? 9 : 5);
  }

  function towers(x0, z0, x1, z1, downtown) {
    const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, a = 2.1; // alley half width
    const hs = () => (downtown ? R(38, 120) : R(22, 60));
    building(ix0, iz0, cx - a, cz - a, hs(), pick(GLASS));
    building(cx + a, iz0, ix1, cz - a, hs(), pick(GLASS));
    building(ix0, cz + a, cx - a, iz1, hs(), pick(GLASS));
    building(cx + a, cz + a, ix1, iz1, hs(), pick(GLASS));
    terrain.cover.push({ x0: cx - a, z0: iz0, x1: cx + a, z1: iz1 }, { x0: ix0, z0: cz - a, x1: ix1, z1: cz + a });
    // bollards keep cars out of the alleys
    for (const o of [-0.95, 0.95]) { bollard(cx + o, iz0 - 0.6); bollard(cx + o, iz1 + 0.6); bollard(ix0 - 0.6, cz + o); bollard(ix1 + 0.6, cz + o); }
    // alley clutter
    for (let k = 0; k < 3; k++) {
      const t = R(8, 26) * (rnd() < 0.5 ? -1 : 1);
      if (rnd() < 0.5) dumpster(cx + (rnd() < 0.5 ? -1.4 : 1.4), cz + t, Math.PI / 2);
      else dumpster(cx + t, cz + (rnd() < 0.5 ? -1.4 : 1.4), 0);
    }
    if (rnd() < 0.6) kicker(cx, cz + R(10, 20), 0, 1, 2.6, 0.75, 0.9);
  }

  function midrise(x0, z0, x1, z1) {
    const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
    const cz = (z0 + z1) / 2, a = 2.6;
    const horizontal = rnd() < 0.5;
    // rows of buildings split by a service alley, with narrow gaps between them
    const row = (r0, r1, flip) => {
      let t = flip ? iz0 : ix0; const end = flip ? iz1 : ix1;
      while (t < end - 8) {
        let w = R(16, 26); if (end - (t + w) < 12) w = end - t;
        const h = R(11, 34), col = pick(BLD);
        if (flip) building(r0, t, r1, t + w, h, col, { awning: rnd() < 0.5 ? [r0 < (x0 + x1) / 2 ? 'w' : 'e'] : null });
        else building(t, r0, t + w, r1, h, col, { awning: rnd() < 0.5 ? [r0 < cz ? 'n' : 's'] : null });
        t += w + 2.4;
      }
    };
    if (horizontal) {
      row(iz0, cz - a, false); row(cz + a, iz1, false);
      for (const o of [-1.1, 1.1]) { bollard(ix0 - 0.6, cz + o); bollard(ix1 + 0.6, cz + o); }
      if (rnd() < 0.7) dumpster((x0 + x1) / 2 + R(-20, 20), cz - 1.9, 0);
      if (rnd() < 0.5) kicker((x0 + x1) / 2 + R(-15, 15), cz, 1, 0, 2.6, 0.7, 0.9);
      terrain.cover.push({ x0: ix0, z0: cz - a, x1: ix1, z1: cz + a });
    } else {
      const cx = (x0 + x1) / 2;
      row(ix0, cx - a, true); row(cx + a, ix1, true);
      for (const o of [-1.1, 1.1]) { bollard(cx + o, iz0 - 0.6); bollard(cx + o, iz1 + 0.6); }
      if (rnd() < 0.7) dumpster(cx - 1.9, cz + R(-20, 20), Math.PI / 2);
      if (rnd() < 0.5) kicker(cx, cz + R(-15, 15), 0, 1, 2.6, 0.7, 0.9);
      terrain.cover.push({ x0: cx - a, z0: iz0, x1: cx + a, z1: iz1 });
    }
  }

  function lowrise(x0, z0, x1, z1) {
    const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, d = 14, g = 1.8;
    const h = () => R(5.5, 10);
    // perimeter shops around a courtyard, with a passage in the middle of each side
    building(ix0, iz0, cx - g, iz0 + d, h(), pick(BLD), { awning: ['n'] });
    building(cx + g, iz0, ix1, iz0 + d, h(), pick(BLD), { awning: ['n'] });
    building(ix0, iz1 - d, cx - g, iz1, h(), pick(BLD), { awning: ['s'] });
    building(cx + g, iz1 - d, ix1, iz1, h(), pick(BLD), { awning: ['s'] });
    building(ix0, iz0 + d + 2.2, ix0 + d, cz - g, h(), pick(BLD), { awning: ['w'] });
    building(ix0, cz + g, ix0 + d, iz1 - d - 2.2, h(), pick(BLD), { awning: ['w'] });
    building(ix1 - d, iz0 + d + 2.2, ix1, cz - g, h(), pick(BLD), { awning: ['e'] });
    building(ix1 - d, cz + g, ix1, iz1 - d - 2.2, h(), pick(BLD), { awning: ['e'] });
    surfacePatch(ix0 + d + 3, iz0 + d + 3, ix1 - d - 3, iz1 - d - 3, 'grass');
    tree(cx - 8, cz - 8); tree(cx + 9, cz + 7); tree(cx + 7, cz - 9); tree(cx - 9, cz + 8);
    bench(cx, cz - 12, 0); bench(cx, cz + 12, 0);
    kicker(cx - 3, cz, 1, 0, 2.4, 0.7, 1);
    platform(cx + 3, cz - 1.5, cx + 9, cz + 1.5, 0.35, 0xa7a49c);
    terrain.cover.push({ x0: cx - g, z0: iz0, x1: cx + g, z1: iz0 + d }, { x0: cx - g, z0: iz1 - d, x1: cx + g, z1: iz1 });
  }

  function park(x0, z0, x1, z1) {
    const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    surfacePatch(ix0, iz0, ix1, iz1, 'grass');
    // crossing paths
    for (const [a0, b0, a1, b1] of [[cx - 1.5, iz0, cx + 1.5, iz1], [ix0, cz - 1.5, ix1, cz + 1.5]]) {
      terrain.addRect(a0, b0, a1, b1, CURB, SURF.concrete);
      B.walk.color(0xcfc9b8).flat(a0, b0, a1, b1, CURB + 0.008, 3);
    }
    // rolling hills you can launch off
    const hills = [];
    for (let k = 0; k < 3; k++) {
      const q = k % 2 ? 1 : -1, q2 = k < 2 ? 1 : -1;
      const m = { x: cx + q * R(13, 20), z: cz + q2 * R(13, 20), r: R(8, 11), h: R(1.3, 2.4), base: CURB, surface: SURF.grass };
      terrain.addMound(m); hills.push(m);
      const seg = 14, ring = 7;
      for (let a = 0; a < ring; a++) for (let s = 0; s < seg; s++) {
        const r0 = (m.r * a) / ring, r1 = (m.r * (a + 1)) / ring, t0 = (s / seg) * 6.2832, t1 = ((s + 1) / seg) * 6.2832;
        const hh = (r) => CURB + 0.01 + m.h * 0.5 * (1 + Math.cos((Math.PI * r) / m.r));
        const p = (r, t) => [m.x + Math.cos(t) * r, hh(r), m.z + Math.sin(t) * r];
        const A = p(r0, t0), Bq = p(r1, t0), C = p(r1, t1), D = p(r0, t1);
        B.grass.color(0x5fa046).quad(A[0], A[1], A[2], D[0], D[1], D[2], C[0], C[1], C[2], Bq[0], Bq[1], Bq[2], A[0] / 5, A[2] / 5, C[0] / 5, C[2] / 5);
      }
    }
    // groves the helicopter can't see into
    for (const [gx, gz] of [[cx - 20, cz + 20], [cx + 21, cz - 21]]) {
      let far = true; for (const m of hills) if (Math.hypot(m.x - gx, m.z - gz) < m.r + 4) far = false;
      if (!far) continue;
      for (let k = 0; k < 7; k++) tree(gx + R(-7, 7), gz + R(-7, 7), 1.25);
      terrain.cover.push({ x0: gx - 8, z0: gz - 8, x1: gx + 8, z1: gz + 8 });
    }
    for (let k = 0; k < 8; k++) {
      const tx = R(ix0 + 2, ix1 - 2), tz = R(iz0 + 2, iz1 - 2);
      if (Math.abs(tx - cx) < 4 || Math.abs(tz - cz) < 4) continue;
      let ok = true; for (const m of hills) if (Math.hypot(m.x - tx, m.z - tz) < m.r) ok = false;
      if (ok) tree(tx, tz, 1.1);
    }
    bench(cx + 2.4, cz + 9, Math.PI / 2); bench(cx - 2.4, cz - 9, Math.PI / 2);
    // fountain in the middle
    B.props.color(0xa9a59b).geom(new THREE.CylinderGeometry(2.4, 2.6, 0.6, 14), mat(cx, CURB + 0.3, cz));
    B.props.color(0x4f9fc4).geom(new THREE.CylinderGeometry(2.1, 2.1, 0.05, 14), mat(cx, CURB + 0.6, cz));
    B.props.color(0xa9a59b).geom(new THREE.CylinderGeometry(0.25, 0.4, 1.6, 8), mat(cx, CURB + 0.8, cz));
    terrain.addCircle(cx, cz, 2.6, 0, CURB + 0.65);
  }

  function dirtPark(x0, z0, x1, z1) {
    const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
    const cx = (x0 + x1) / 2;
    surfacePatch(ix0, iz0, ix1, iz1, 'dirt');
    const D = { base: CURB, surface: SURF.dirt, color: 0x9a744a, side: 0x7a5a38, smooth: true, batch: B.dirt };
    // line A: pump-track rollers
    for (let k = 0; k < 6; k++) ramp(cx - 22, iz0 + 9 + k * 8, 0, 1, 2.2, [[0, 0], [2, 0.55], [4, 0]], D);
    // line B: tabletops, growing
    for (let k = 0; k < 3; k++) { const h = 1.0 + k * 0.3; ramp(cx - 8, iz0 + 8 + k * 18, 0, 1, 2.4, [[0, 0], [3.4, h], [7, h], [11, 0]], D); }
    // line C: gap doubles
    for (let k = 0; k < 2; k++) {
      const z = iz0 + 10 + k * 26;
      ramp(cx + 8, z, 0, 1, 2.4, [[0, 0], [4, 1.5], [4.4, 1.5]], D);
      ramp(cx + 8, z + 9.5, 0, 1, 2.6, [[0, 1.2], [0.4, 1.2], [5.5, 0]], D);
    }
    // the big one
    ramp(cx + 22, iz0 + 14, 0, 1, 2.8, [[0, 0], [6, 2.3], [6.6, 2.3]], D);
    ramp(cx + 22, iz0 + 33, 0, 1, 3.2, [[0, 1.9], [1, 1.9], [9, 0]], D);
    spots.ramps.push({ x: cx + 22, z: iz0 + 14 });
    for (const [a, b, c, d] of [[ix0, iz0, cx - 6, iz0], [cx + 6, iz0, ix1, iz0], [ix0, iz1, cx - 6, iz1], [cx + 6, iz1, ix1, iz1], [ix0, iz0, ix0, iz0 + 26], [ix0, iz1 - 26, ix0, iz1], [ix1, iz0, ix1, iz0 + 26], [ix1, iz1 - 26, ix1, iz1]]) fence(a, b, c, d, 1.3);
    tree(ix0 + 3, iz0 + 3); tree(ix1 - 3, iz1 - 3);
  }

  function skatePlaza(x0, z0, x1, z1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const C = { base: CURB, surface: SURF.concrete, color: 0xc9c5ba, side: 0x9d998f };
    // raised stage: stairs on two sides, banks on the others
    platform(cx - 10, cz - 6, cx + 10, cz + 6, 1.05, 0xb5b1a7);
    ramp(cx - 6, cz - 9.6, 0, 1, 4, [[0, 0], [3.6, 1.05]], { ...C, steps: 7 });
    ramp(cx + 5, cz - 10, 0, 1, 4, [[0, 0], [4, 1.05]], C);
    ramp(cx, cz + 6, 0, 1, 10, [[0, 1.05], [3.6, 0]], { ...C, steps: 7 });
    ramp(cx - 14.5, cz, 1, 0, 6, [[0, 0], [4.5, 1.05]], C);
    ramp(cx + 10, cz, 1, 0, 6, [[0, 1.05], [4.5, 0]], C);
    // fun box and manual pads
    ramp(cx - 22, cz + 20, 1, 0, 2.2, [[0, 0], [2.6, 0.8], [6, 0.8], [8.6, 0]], C);
    platform(cx + 12, cz + 18, cx + 20, cz + 20.4, 0.32, 0xaeaaa0);
    platform(cx + 12, cz + 23, cx + 22, cz + 25.4, 0.5, 0xaeaaa0);
    // kicker gap
    kicker(cx - 24, cz - 22, 1, 0, 3, 1.0, 1.6, C);
    ramp(cx - 15, cz - 22, 1, 0, 1.8, [[0, 0.8], [3.5, 0]], C);
    kicker(cx + 16, cz - 22, 0, 1, 3.2, 1.2, 1.6, C);
    // bank against the edge
    ramp(cx + 24, cz + 2, 1, 0, 7, [[0, 0], [4, 1.5], [4.6, 1.5]], { ...C, smooth: true });
    for (const [bx, bz] of [[cx - 28, cz], [cx + 2, cz + 28], [cx - 2, cz - 28]]) bench(bx, bz, bx === cx - 28 ? Math.PI / 2 : 0);
  }

  // Concrete skate park across the street from the shops: a mini half-pipe, a roll-in tower
  // feeding a funbox and a big quarter wall, a step-up, a spine, banks, rollers, ledges and rails.
  function skatePark(x0, z0, x1, z1) {
    const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const C = { base: CURB, surface: SURF.concrete, color: 0xb7b0a2, side: 0x8c8679 };
    const DECK = 0xa29c8f, STEEL = 0x6f747b, PAINT = 0xd9a11a;
    B.walk.color(0xc9c6bd).flat(ix0, iz0, ix1, iz1, CURB + 0.004, 6);
    // a curved transition: an arc of radius R up to height h, then a flat deck
    const arc = (R, h, n = 8) => { const top = Math.acos(1 - h / R), pts = []; for (let k = 0; k <= n; k++) { const t = (top * k) / n; pts.push([R * Math.sin(t), R * (1 - Math.cos(t))]); } return pts; };
    const quarter = (x, z, dx, dz, halfW, R, h, deck, n = 8) => {
      const pts = arc(R, h, n), L = pts[pts.length - 1][0];
      ramp(x, z, dx, dz, halfW, [...pts, [L + deck, h]], C);
      // steel coping along the lip
      const [lx, lz] = [x + dx * L, z + dz * L];
      B.props.color(STEEL).box(lx, CURB + h - 0.04, lz, dx ? 0.14 : halfW * 2, 0.1, dx ? halfW * 2 : 0.14);
    };
    const spine = (x, z, dx, dz, halfW, R, h) => {
      const up = arc(R, h), L = up[up.length - 1][0];
      ramp(x, z, dx, dz, halfW, [...up, ...up.slice(0, -1).reverse().map(([l, hh]) => [2 * L - l, hh])], C);
      B.props.color(STEEL).box(x + dx * L, CURB + h - 0.04, z + dz * L, dx ? 0.14 : halfW * 2, 0.1, dx ? halfW * 2 : 0.14);
    };

    // ---- west line: mini half-pipe, with a kicker gap above it and rollers below
    quarter(cx - 22, cz - 8, 0, -1, 6, 3.6, 1.6, 3);
    quarter(cx - 22, cz + 8, 0, 1, 6, 3.6, 1.6, 3);
    kicker(cx - 27, cz - 16.4, 1, 0, 3, 1.0, 1.6, C);
    ramp(cx - 20.5, cz - 16.4, 1, 0, 1.8, [[0, 0.8], [3.5, 0]], C);
    for (let k = 0; k < 3; k++) ramp(cx - 22, cz + 17 + k * 4.5, 0, 1, 4, [[0, 0], [2.2, 0.5], [4.4, 0]], { ...C, smooth: true });

    // ---- centre line: roll-in tower, funbox, big quarter wall
    platform(cx - 4, cz - 30, cx + 4, cz - 24, 2.4, DECK);
    ramp(cx - 16, cz - 27, 1, 0, 3, [[0, 0], [12, 2.4]], C); // the way up
    ramp(cx, cz - 24, 0, 1, 4, [[0, 2.4], [6, 0]], { ...C, smooth: true, color: PAINT });
    platform(cx - 3, cz - 2, cx + 3, cz + 2, 1.0, DECK);
    ramp(cx, cz - 7, 0, 1, 3, [[0, 0], [5, 1.0]], C);
    ramp(cx, cz + 2, 0, 1, 3, [[0, 1.0], [5, 0]], C);
    ramp(cx - 8, cz, 1, 0, 2, [[0, 0], [5, 1.0]], C);
    ramp(cx + 3, cz, 1, 0, 2, [[0, 1.0], [5, 0]], C);
    platform(cx + 2.76, cz + 2, cx + 3, cz + 7, 1.0, STEEL, SURF.metal); // rail off the edge of the box
    quarter(cx, cz + 21, 0, 1, 10, 6.2, 2.2, 3.5, 12);

    // ---- east line: step-up, spine, ledge and rail, bank on the wall
    kicker(cx + 20, cz - 24, 0, 1, 3.5, 1.1, 2, C);
    platform(cx + 17, cz - 17.5, cx + 23, cz - 11.5, 1.1, DECK);
    ramp(cx + 20, cz - 11.5, 0, 1, 3, [[0, 1.1], [5, 0]], C);
    spine(cx + 20, cz + 3.2, 0, 1, 5, 3.2, 1.3);
    platform(cx + 14, cz + 12, cx + 24, cz + 14.4, 0.35, DECK);
    platform(cx + 14, cz + 18, cx + 24, cz + 18.25, 0.45, STEEL, SURF.metal);
    ramp(cx + 26, cz + 16, 1, 0, 12, [[0, 0], [4, 1.5], [5.5, 1.5]], { ...C, smooth: true });

    // ---- low wall round the park, with a gap on every side
    for (const [a, b, c, d] of [[ix0, iz0, cx + 6, iz0], [cx + 14, iz0, ix1, iz0], [ix0, iz1, cx + 14, iz1], [cx + 22, iz1, ix1, iz1],
      [ix0, iz0, ix0, cz - 3], [ix0, cz + 3, ix0, iz1], [ix1, iz0, ix1, cz - 9], [ix1, cz - 3, ix1, iz1]]) fence(a, b, c, d, 1.0, 0x8f8b82);
    // gateway sign over the north entrance, readable from both sides
    const gx = cx + 10, gy = CURB + 4.3;
    for (const px of [gx - 4.6, gx + 4.6]) { B.props.color(0x2a2d33).box(px, CURB, iz0, 0.3, 5.2, 0.3); terrain.addCircle(px, iz0, 0.2, 0, CURB + 5.2); }
    const tex = canvasTexture(512, (ctx, sz) => {
      ctx.fillStyle = '#15171c'; ctx.fillRect(0, 0, sz, sz);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd21f'; ctx.font = 'italic 900 150px system-ui, Arial, sans-serif'; ctx.fillText('SKATE', sz / 2, sz * 0.3);
      ctx.fillStyle = '#ffffff'; ctx.fillText('PARK', sz / 2, sz * 0.72);
    }, { repeat: false });
    for (const rot of [0, Math.PI]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(8.9, 1.8), new THREE.MeshBasicMaterial({ map: tex }));
      m.position.set(gx, gy, iz0 + (rot ? -0.02 : 0.02)); m.rotation.y = rot; group.add(m);
    }
    bench(cx + 29, cz - 20, Math.PI / 2); bench(cx - 10, cz + 29.5, 0); bench(cx + 10, cz - 14, 0);
    tree(ix0 + 2.5, iz1 - 2.5); tree(ix1 - 2.5, iz0 + 2.5);
    spots.skate = { x: cx, z: cz };
  }

  function parking(x0, z0, x1, z1) {
    const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    surfacePatch(ix0, iz0, ix1, iz1, 'asphalt');
    // driveways
    ramp(cx, z0, 0, -1, 4, [[0, CURB], [1.2, 0]], { color: 0x55575b, side: 0x44464a, surface: SURF.asphalt, batch: B.walk });
    ramp(cx, z1, 0, 1, 4, [[0, CURB], [1.2, 0]], { color: 0x55575b, side: 0x44464a, surface: SURF.asphalt, batch: B.walk });
    for (let rowX = ix0 + 5; rowX < ix1 - 4; rowX += 14.5) {
      for (let t = iz0 + 4; t < iz1 - 3; t += 3.1) {
        B.marks.color(0xd8d8d8).flat(rowX - 5, t - 1.55, rowX + 5, t - 1.47, CURB + 0.02);
        if (Math.abs(t - cz) < 5) continue;
        if (rnd() < 0.42) parkCar(rowX - 2.6, t, Math.PI / 2, CURB);
        if (rnd() < 0.42) parkCar(rowX + 2.6, t, -Math.PI / 2, CURB);
      }
    }
    lamp(cx - 14, cz, 0); lamp(cx + 14, cz, 0);
    kicker(cx - 6, cz - 1.6, 1, 0, 3, 0.9, 1.2);
    kicker(cx + 6, cz + 1.6, -1, 0, 3, 0.9, 1.2);
    crate(ix1 - 3, iz0 + 3, 2.4, 2.6, 2.4, 0xd9d4c8, 0, CURB, 0x8a2f2a);
  }

  function construction(x0, z0, x1, z1) {
    const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    surfacePatch(ix0, iz0, ix1, iz1, 'dirt');
    for (const [a, b, c, d] of [[ix0, iz0, cx - 5, iz0], [cx + 5, iz0, ix1, iz0], [ix0, iz1, cx - 5, iz1], [cx + 5, iz1, ix1, iz1], [ix0, iz0, ix0, cz - 5], [ix0, cz + 5, ix0, iz1], [ix1, iz0, ix1, cz - 5], [ix1, cz + 5, ix1, iz1]]) fence(a, b, c, d, 2, 0x3f6f9a);
    // shipping containers with plank ramps: ride up, jump the gap
    const cont = (x, z, col) => { terrain.addRect(x - 1.25, z - 3.05, x + 1.25, z + 3.05, CURB + 2.6, SURF.metal); B.props.color(col).box(x, CURB, z, 2.5, 2.6, 6.1); };
    cont(cx - 14, cz - 6, 0xb8452e); cont(cx - 14, cz + 5.5, 0x2e6fb8);
    ramp(cx - 14, cz - 17, 0, 1, 1.1, [[0, 0], [8, 2.6]], { base: CURB });
    ramp(cx - 14, cz + 8.55, 0, 1, 1.1, [[0, 2.6], [8, 0]], { base: CURB });
    cont(cx + 14, cz + 2, 0x3a8a54);
    ramp(cx + 14, cz - 9, 0, 1, 1.1, [[0, 0], [8, 2.6]], { base: CURB });
    spots.ramps.push({ x: cx - 14, z: cz - 17 });
    // dirt piles
    for (const [mx, mz, r, h] of [[cx + 4, cz + 18, 7, 2.2], [cx - 2, cz - 18, 6, 1.6], [cx + 18, cz - 20, 5, 1.4]]) {
      const m = { x: mx, z: mz, r, h, base: CURB, surface: SURF.dirt };
      terrain.addMound(m);
      const seg = 12, ring = 6;
      for (let a = 0; a < ring; a++) for (let s = 0; s < seg; s++) {
        const r0 = (r * a) / ring, r1 = (r * (a + 1)) / ring, t0 = (s / seg) * 6.2832, t1 = ((s + 1) / seg) * 6.2832;
        const hh = (q) => CURB + 0.01 + h * 0.5 * (1 + Math.cos((Math.PI * q) / r));
        const p = (q, t) => [mx + Math.cos(t) * q, hh(q), mz + Math.sin(t) * q];
        const A = p(r0, t0), Bq = p(r1, t0), Cq = p(r1, t1), Dq = p(r0, t1);
        B.dirt.color(0x8f6a42).quad(A[0], A[1], A[2], Dq[0], Dq[1], Dq[2], Cq[0], Cq[1], Cq[2], Bq[0], Bq[1], Bq[2], A[0] / 5, A[2] / 5, Cq[0] / 5, Cq[2] / 5);
      }
    }
    // half-built frame + crane
    for (const px of [-6, 0, 6]) for (const pz of [-6, 0, 6]) { B.props.color(0x8b8f94).box(cx + 20 + px * 0.9, CURB, cz + 14 + pz * 0.9, 0.5, 12, 0.5); terrain.addCircle(cx + 20 + px * 0.9, cz + 14 + pz * 0.9, 0.35, 0, 12); }
    for (const y of [4, 8, 12]) B.flat.color(0x9a9ea3).box(cx + 20, CURB + y, cz + 14, 12, 0.3, 12, { bottom: true });
    B.props.color(0xe0a81c).box(cx - 2, CURB, cz + 2, 1.4, 34, 1.4);
    B.props.color(0xe0a81c).box(cx + 8, CURB + 33, cz + 2, 34, 1.2, 1.2, { bottom: true });
    terrain.addBox(cx - 2, cz + 2, 0.8, 0.8, 0, 0, 34);
    for (let k = 0; k < 5; k++) cone(R(ix0 + 4, ix1 - 4), R(iz0 + 4, iz1 - 4), CURB);
  }

  function civic(x0, z0, x1, z1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const C = { base: CURB, surface: SURF.concrete, color: 0xd6d1c4, side: 0xaaa69b };
    platform(cx - 16, cz - 10, cx + 16, cz + 14, 1.6, 0xcfcabd);
    ramp(cx, cz - 15.5, 0, 1, 12, [[0, 0], [5.5, 1.6]], { ...C, steps: 10 });
    ramp(cx - 22, cz + 2, 1, 0, 3, [[0, 0], [6, 1.6]], C);
    ramp(cx + 16, cz + 2, 1, 0, 3, [[0, 1.6], [6, 0]], C);
    ramp(cx, cz + 14, 0, 1, 5, [[0, 1.6], [5, 0]], { ...C, steps: 10 });
    building(cx - 12, cz + 2, cx + 12, cz + 12, 16, 0xe2dccb, { base: CURB + 1.6, band: 0xbdb7a6, roof: 0x6f7378 });
    for (const px of [-10, -5, 0, 5, 10]) { B.props.color(0xeae5d6).geom(new THREE.CylinderGeometry(0.5, 0.55, 9, 10), mat(cx + px, CURB + 1.6 + 4.5, cz + 0.6)); terrain.addCircle(cx + px, cz + 0.6, 0.55, 0, 12); }
    // monument + planters
    crate(cx, cz - 24, 2.2, 1.2, 2.2, 0x8d8a82);
    B.props.color(0x4a6b5a).geom(new THREE.CylinderGeometry(0.35, 0.6, 3.4, 8), mat(cx, CURB + 2.9, cz - 24));
    for (const px of [-20, 20]) for (const pz of [-24, 22]) { crate(cx + px, cz + pz, 3, 0.6, 3, 0x9d998f, 0, CURB, 0x4c7d3a); tree(cx + px, cz + pz, 0.9); }
    kicker(cx + 22, cz - 20, -1, 0, 3, 0.9, 1.3, C);
  }

  // Home block: the dealership (buy bikes) and the customs garage (mods + looks),
  // with the practice yard in front. Both are entered by riding into their marker.
  function home(x0, z0, x1, z1) {
    const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    surfacePatch(ix0, iz0, ix1, iz1, 'asphalt');
    const sign = (lines, w, h, x, y, z, bg = '#15171c') => {
      const t = canvasTexture(512, (ctx, s) => {
        ctx.fillStyle = bg; ctx.fillRect(0, 0, s, s);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        lines.forEach(([text, col, size], k) => { ctx.fillStyle = col; ctx.font = `italic 900 ${size}px system-ui, Arial, sans-serif`; ctx.fillText(text, s / 2, (s * (k + 0.5)) / lines.length + 6); });
      }, { repeat: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(x, y, z); group.add(m);
    };
    // floor marker you ride into to open a shop
    const marker = (x, z, col) => {
      const g = new THREE.Group(); g.position.set(x, CURB + 0.03, z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.9, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 3.2, 28, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.position.y = 1.6; g.add(ring, beam); group.add(g);
      return g;
    };

    // ---- dealership: glass-fronted showroom
    const dx0 = cx - 30, dx1 = cx - 3, dz0 = iz0 + 2, dz1 = iz0 + 16, dmx = (dx0 + dx1) / 2;
    building(dx0, dz0, dx1, dz1, 7, 0x9fb9cc, { band: 0x1d2a36, roof: 0x30343a, awning: ['s'] });
    sign([['DEALERSHIP', '#ffd21f', 96], ['NEW BIKES', '#ffffff', 60]], 14, 4.4, dmx, CURB + 5.2, dz1 + 0.26);
    // display podium beside the entrance
    const pod = { x: dx0 + 5, z: dz1 + 5.5 };
    B.props.color(0xdadde2).geom(new THREE.CylinderGeometry(2.3, 2.5, 0.22, 24), mat(pod.x, CURB + 0.11, pod.z));
    B.props.color(0xffd21f).geom(new THREE.CylinderGeometry(2.36, 2.36, 0.06, 24), mat(pod.x, CURB + 0.2, pod.z));
    terrain.addCircle(pod.x, pod.z, 2.4, 0, CURB + 0.6);
    spots.dealer = { x: dmx + 3, z: dz1 + 5, r: 2.9, view: { x: pod.x, y: CURB + 0.23, z: pod.z }, marker: marker(dmx + 3, dz1 + 5, 0xffd21f) };

    // ---- customs: a big garage you ride straight into; the door rolls up as you arrive
    const gx0 = cx + 3, gx1 = cx + 31, gz0 = iz0 + 1, gz1 = iz0 + 21, gmx = (gx0 + gx1) / 2, gH = 9, T = 0.6, doorW = 12, doorH = 5.6;
    const wall = (ax, az, bx, bz, y0 = 0, h = gH, col = 0x3a3f47) => {
      B.props.color(col).box((ax + bx) / 2, CURB + y0, (az + bz) / 2, Math.abs(bx - ax), h, Math.abs(bz - az));
      if (y0 < 2) terrain.addBox((ax + bx) / 2, (az + bz) / 2, Math.abs(bx - ax) / 2, Math.abs(bz - az) / 2, 0, 0, CURB + y0 + h);
    };
    wall(gx0, gz0, gx1, gz0 + T);                                   // back
    wall(gx0, gz0, gx0 + T, gz1); wall(gx1 - T, gz0, gx1, gz1);     // sides
    wall(gx0, gz1 - T, gmx - doorW / 2, gz1); wall(gmx + doorW / 2, gz1 - T, gx1, gz1);   // front, either side of the door
    wall(gmx - doorW / 2, gz1 - T, gmx + doorW / 2, gz1, doorH, gH - doorH);              // above the door
    B.props.color(0xffd21f).box(gmx, CURB + doorH - 0.02, gz1 + 0.02, doorW + 1.2, 0.35, 0.1); // door header stripe
    B.flat.color(0x2b2f35).box(gmx, CURB + gH, (gz0 + gz1) / 2, gx1 - gx0 + 0.6, 0.4, gz1 - gz0 + 0.6, { bottom: true });
    // inside: painted floor, light strips, tool chests and a workbench along the walls
    B.walk.color(0x8f949c).flat(gx0 + T, gz0 + T, gx1 - T, gz1 - T, CURB + 0.012, 3);
    B.marks.color(0xffd21f).flat(gmx - 4.2, gz0 + 5.6, gmx + 4.2, gz0 + 5.8, CURB + 0.03).flat(gmx - 4.2, gz0 + 14.2, gmx + 4.2, gz0 + 14.4, CURB + 0.03)
      .flat(gmx - 4.2, gz0 + 5.6, gmx - 4, gz0 + 14.4, CURB + 0.03).flat(gmx + 4, gz0 + 5.6, gmx + 4.2, gz0 + 14.4, CURB + 0.03);
    const strip = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
    for (const lx of [-8, 0, 8]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 13), strip); l.position.set(gmx + lx, CURB + gH - 0.25, (gz0 + gz1) / 2); group.add(l); }
    for (const [tx, col] of [[-11, 0xc0392b], [-8.2, 0xc0392b], [8.2, 0x2f6fb8], [11, 0x2f6fb8]]) crate(gmx + tx, gz0 + T + 0.7, 2.4, 1.3, 1, col, 0, CURB, 0x22252a);
    crate(gx0 + T + 0.8, gz0 + 9, 1.2, 1, 5, 0x7a5a3a, 0, CURB, 0x9a7a52); crate(gx1 - T - 0.8, gz0 + 9, 1.2, 1, 5, 0x7a5a3a, 0, CURB, 0x9a7a52);
    sign([['CUSTOMS', '#ffd21f', 150]], 12, 2.6, gmx, CURB + doorH + 1.75, gz1 + 0.06);
    sign([['MODS', '#ffffff', 110], ['PAINT · WRAPS', '#ffd21f', 64]], 9, 4, gmx, CURB + 5.4, gz0 + T + 0.06, '#22262c');
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.18), new THREE.MeshLambertMaterial({ map: canvasTexture(128, (ctx, s) => { ctx.fillStyle = '#b9bec6'; ctx.fillRect(0, 0, s, s); ctx.fillStyle = '#8b9099'; for (let y = 0; y < s; y += 16) ctx.fillRect(0, y, s, 3); }) }));
    door.material.map.repeat.set(1, 3);
    door.position.set(gmx, CURB + doorH / 2, gz1 - T / 2); door.castShadow = true; group.add(door);
    terrain.sightBoxes.push({ x0: gx0, z0: gz0, x1: gx1, z1: gz1 });
    terrain.cover.push({ x0: gx0, z0: gz0, x1: gx1, z1: gz1 });
    spots.customs = { x: gmx, z: gz0 + 10, r: 3.4, view: { x: gmx, y: CURB, z: gz0 + 10 }, door, doorY: CURB + doorH / 2, doorH, doorX: gmx, doorZ: gz1, marker: marker(gmx, gz0 + 10, 0x34d17a) };

    ramp(cx, z1, 0, 1, 5, [[0, CURB], [1.2, 0]], { color: 0x55575b, side: 0x44464a, surface: SURF.asphalt, batch: B.walk });
    ramp(x0, cz + 10, -1, 0, 5, [[0, CURB], [1.2, 0]], { color: 0x55575b, side: 0x44464a, surface: SURF.asphalt, batch: B.walk });
    // practice yard
    kicker(cx - 18, cz + 12, 1, 0, 3, 0.8, 1.4);
    ramp(cx - 10.5, cz + 12, 1, 0, 1.6, [[0, 0.7], [3.4, 0]], { base: CURB });
    platform(cx + 6, cz + 10, cx + 16, cz + 12.4, 0.3, 0xaeaaa0);
    ramp(cx + 16, cz + 24, -1, 0, 2, [[0, 0], [3.2, 0.8]], { base: CURB, steps: 5, color: 0xc9c5ba, side: 0x9d998f, surface: SURF.concrete });
    platform(cx + 6.8, cz + 22, cx + 12.8, cz + 26, 0.8, 0xb5b1a7);
    ramp(cx + 3.6, cz + 24, 1, 0, 2, [[0, 0], [3.2, 0.8]], { base: CURB, color: 0xc9c5ba, side: 0x9d998f, surface: SURF.concrete });
    for (let k = 0; k < 6; k++) cone(cx - 20 + k * 3.2, cz + 26 + (k % 2) * 1.6, CURB);
    tree(ix0 + 3, iz1 - 3); tree(ix1 - 3, iz1 - 3);
    spots.home = { x: cx, z: z1 + 5.5, yaw: Math.PI / 2 };
  }

  const kinds = { L: lowrise, M: midrise, K: park, D: dirtPark, S: skatePlaza, R: skatePark, P: parking, C: construction, V: civic, H: home };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const type = LAYOUT[j][i];
      const x0 = roadC(i) + ROAD_HALF, x1 = roadC(i + 1) - ROAD_HALF;
      const z0 = roadC(j) + ROAD_HALF, z1 = roadC(j + 1) - ROAD_HALF;
      baseBlock(x0, z0, x1, z1, type);
      if (type === 'T') towers(x0, z0, x1, z1, true);
      else kinds[type](x0, z0, x1, z1);
      blocks.push({ x0, z0, x1, z1, type });
    }
  }

  // street ramps: a few planks leaning on the kerb for sidewalk gaps
  for (let k = 0; k < 26; k++) {
    const i = 1 + Math.floor(rnd() * (N - 1)), j = Math.floor(rnd() * N);
    const along = roadC(j) + PITCH / 2 + R(-22, 22), side = rnd() < 0.5 ? -1 : 1;
    const c = roadC(i) + side * (ROAD_HALF - 0.1);
    if (rnd() < 0.5) ramp(c - side * 1.9, along, side, 0, 0.8, [[0, 0], [2, 0.5]], {});
    else ramp(along, c - side * 1.9, 0, side, 0.8, [[0, 0], [2, 0.5]], {});
  }

  // ------------------------------------------------------------------
  // meshes
  // ------------------------------------------------------------------
  const L = (o) => new THREE.MeshLambertMaterial({ vertexColors: true, ...o });
  const mats = {
    ground: L({ map: tex.asphalt }), walk: L({ map: tex.concrete }), grass: L({ map: tex.grass }), dirt: L({ map: tex.dirt }),
    marks: L({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    walls: L({ map: tex.windows, emissiveMap: tex.lit, emissive: 0xffffff, emissiveIntensity: 0 }),
    props: L({}), flat: L({ side: THREE.DoubleSide }),
  };
  group.add(B.ground.mesh(mats.ground), B.walk.mesh(mats.walk), B.grass.mesh(mats.grass), B.dirt.mesh(mats.dirt, { cast: true }));
  group.add(B.marks.mesh(mats.marks), B.walls.mesh(mats.walls, { cast: true }), B.props.mesh(mats.props, { cast: true }), B.flat.mesh(mats.flat, { cast: true }));

  // water
  const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: 0x2f6f8f }));
  water.rotation.x = -Math.PI / 2; water.position.y = -1.2; water.matrixAutoUpdate = false; water.updateMatrix();
  group.add(water);
  mats.water = water.material;

  // instanced trees
  {
    const b = new Batch();
    b.color(0x6b4a2f).geom(new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6), mat(0, 1.2, 0));
    b.color(0x3f8a3a).geom(new THREE.IcosahedronGeometry(1.7, 0), mat(0, 3.6, 0, 0, 0, 0, 1, 0.9, 1));
    b.color(0x4c9a40).geom(new THREE.IcosahedronGeometry(1.2, 0), mat(0.8, 4.6, 0.3));
    b.color(0x357a34).geom(new THREE.IcosahedronGeometry(1.25, 0), mat(-0.7, 4.2, -0.5));
    const im = new THREE.InstancedMesh(b.geometry(), L({}), trees.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    trees.forEach((t, k) => {
      im.setMatrixAt(k, m.copy(mat(t.x, t.y, t.z, 0, t.r, 0, t.s)));
      im.setColorAt(k, col.setHSL(0.27 + rnd() * 0.07, 0.35 + rnd() * 0.3, 0.5 + rnd() * 0.2));
    });
    im.castShadow = quality > 0; im.receiveShadow = false;
    group.add(im);
  }
  // instanced street lamps
  let lampHeads = null, lampPools = null;
  {
    const b = new Batch();
    b.color(0x3a3d42).geom(new THREE.CylinderGeometry(0.07, 0.1, 6, 6), mat(0, 3, 0));
    b.color(0x3a3d42).box(0, 5.9, 0.9, 0.12, 0.12, 2, { bottom: true });
    const im = new THREE.InstancedMesh(b.geometry(), L({}), lamps.length);
    const hb = new Batch();
    hb.color(0xffffff).box(0, 5.78, 1.7, 0.3, 0.1, 0.7, { bottom: true });
    lampHeads = new THREE.InstancedMesh(hb.geometry(), new THREE.MeshBasicMaterial({ color: 0x8f8f86 }), lamps.length);
    // pools of light on the ground, switched on at dusk
    const glow = canvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,225,160,1)'); g.addColorStop(0.4, 'rgba(255,210,140,0.45)'); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    }, { repeat: false });
    const pg = new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2).translate(0, 0.03, 1.7);
    lampPools = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), lamps.length);
    lampPools.visible = false; lampPools.renderOrder = 2;
    lamps.forEach((l, k) => { const m = mat(l.x, CURB, l.z, 0, l.rot, 0); im.setMatrixAt(k, m); lampHeads.setMatrixAt(k, m); lampPools.setMatrixAt(k, m); });
    group.add(im, lampHeads, lampPools);
  }

  group.traverse((o) => { if (o.isMesh && !o.matrixAutoUpdate) o.updateMatrix(); });

  return { group, mats, parked, blocks, spots, lampHeads, lampPools, lamps, carColors: CARCOL };
}
