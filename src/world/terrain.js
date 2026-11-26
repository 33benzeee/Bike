// Terrain: analytic height shapes + obstacle colliders on a spatial hash grid.
// Pure JS (no three.js) so the physics can be simulated and tested headlessly.

const CELL = 16;

export const SURF = { asphalt: 0, concrete: 1, grass: 2, dirt: 3, wood: 4, metal: 5 };
export const SURF_GRIP = [1.0, 0.96, 0.68, 0.8, 0.9, 0.82];
export const SURF_ROLL = [0.012, 0.014, 0.05, 0.036, 0.016, 0.013];

const key = (ix, iz) => (ix + 2048) * 4096 + (iz + 2048);

// wheel sample offsets (fractions of radius) and the matching circle heights
const WS = [-0.96, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 0.96];
const WC = WS.map((f) => Math.sqrt(1 - f * f));

export class Terrain {
  constructor() {
    this.hCells = new Map();
    this.oCells = new Map();
    this.obstacles = [];
    this.sightBoxes = []; // tall axis-aligned boxes that block line of sight
    this.cover = []; // rects hidden from the helicopter
    this.carBlocks = []; // axis-aligned rects cars cannot enter
    this.surface = 0;
    this._stamp = 0;
    this.bounds = 400;
    this.field = null; // optional rolling ground under everything (the desert): see setField
  }

  // A height grid (cell metres, n x n points from x0,z0) that the shapes sit on. Inside a cell
  // the ground is two flat triangles split along the (0,0)-(1,1) diagonal, the same way the
  // ground mesh is drawn. surf: one SURF value per cell. Outside the grid the ground is flat
  // at the edge height.
  setField(x0, z0, cell, n, h, surf, baseSurf) {
    this.field = { x0, z0, cell, n, h, surf, baseSurf };
  }

  fieldHeight(x, z) {
    const f = this.field, n = f.n;
    let gx = (x - f.x0) / f.cell, gz = (z - f.z0) / f.cell;
    if (gx < 0) gx = 0; else if (gx > n - 1.001) gx = n - 1.001;
    if (gz < 0) gz = 0; else if (gz > n - 1.001) gz = n - 1.001;
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = j * n + i, H = f.h;
    const h00 = H[k], h11 = H[k + n + 1];
    this.surface = f.surf[(j * (n - 1)) + i];
    return fx >= fz ? h00 + fx * (H[k + 1] - h00) + fz * (h11 - H[k + 1]) : h00 + fz * (H[k + n] - h00) + fx * (h11 - H[k + n]);
  }

  _insert(map, item, minX, maxX, minZ, maxZ) {
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let c = map.get(k);
        if (!c) map.set(k, (c = []));
        c.push(item);
      }
    }
  }

  // ---- height shapes -------------------------------------------------
  addRect(x0, z0, x1, z1, h, surface = SURF.concrete) {
    const s = { t: 0, x0, z0, x1, z1, h, surface };
    this._insert(this.hCells, s, x0, x1, z0, z1);
    return s;
  }

  // Oriented strip. pts = [[l, h], ...] along (dirX, dirZ) from the origin (x, z).
  // steps > 0 quantises the rise into stairs; smooth eases between points.
  addProfile({ x, z, dirX, dirZ, halfW, pts, base = 0, surface = SURF.concrete, steps = 0, smooth = false }) {
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len; dirZ /= len;
    const s = { t: 1, x, z, dx: dirX, dz: dirZ, halfW, pts, base, surface, steps, smooth, l0: pts[0][0], l1: pts[pts.length - 1][0] };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const l of [s.l0, s.l1]) {
      for (const w of [-halfW, halfW]) {
        const px = x + dirX * l + dirZ * w, pz = z + dirZ * l - dirX * w;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
      }
    }
    this._insert(this.hCells, s, minX, maxX, minZ, maxZ);
    return s;
  }

  addMound({ x, z, r, h, base = 0, surface = SURF.grass }) {
    const s = { t: 2, x, z, r, h, base, surface };
    this._insert(this.hCells, s, x - r, x + r, z - r, z + r);
    return s;
  }

  height(x, z) {
    const c = this.hCells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let h = 0, surf = 0;
    if (this.field) { h = this.fieldHeight(x, z); surf = this.surface; }
    if (c) {
      for (let i = 0; i < c.length; i++) {
        const s = c[i];
        let v;
        if (s.t === 0) {
          if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
          v = s.h;
        } else if (s.t === 1) {
          const px = x - s.x, pz = z - s.z;
          const l = px * s.dx + pz * s.dz;
          if (l < s.l0 || l > s.l1) continue;
          const w = px * s.dz - pz * s.dx;
          if (w < -s.halfW || w > s.halfW) continue;
          const pts = s.pts;
          let j = 1;
          while (j < pts.length - 1 && pts[j][0] < l) j++;
          const a = pts[j - 1], b = pts[j];
          let f = b[0] > a[0] ? (l - a[0]) / (b[0] - a[0]) : 0;
          if (s.steps > 0) f = Math.min(1, Math.ceil(f * s.steps - 1e-6) / s.steps);
          else if (s.smooth) f = f * f * (3 - 2 * f);
          v = s.base + a[1] + (b[1] - a[1]) * f;
        } else {
          const px = x - s.x, pz = z - s.z;
          const d2 = px * px + pz * pz;
          if (d2 >= s.r * s.r) continue;
          v = s.base + s.h * 0.5 * (1 + Math.cos((Math.PI * Math.sqrt(d2)) / s.r));
        }
        if (v >= h) { h = v; surf = s.surface; }
      }
    }
    this.surface = surf;
    return h;
  }

  // Lowest height the centre of a wheel (radius r, rolling along hx,hz) can sit at.
  _envelope(x, z, hx, hz, r) {
    let best = -Infinity;
    for (let i = 0; i < WS.length; i++) {
      const d = WS[i] * r;
      const v = this.height(x + hx * d, z + hz * d) + WC[i] * r;
      if (v > best) { best = v; if (i === 5) this._surf = this.surface; }
    }
    return best;
  }

  // Wheel contact query. out: { hc, ns, ny, surface }
  wheel(x, z, hx, hz, r, out) {
    const h0 = this.height(x, z);
    const surf = this.surface;
    const hb = this.height(x - hx * r, z - hz * r);
    const hf = this.height(x + hx * r, z + hz * r);
    out.surface = surf;
    if (h0 === hb && h0 === hf) {
      const hm1 = this.height(x - hx * r * 0.5, z - hz * r * 0.5);
      const hm2 = this.height(x + hx * r * 0.5, z + hz * r * 0.5);
      if (hm1 === h0 && hm2 === h0) { out.hc = h0 + r; out.ns = 0; out.ny = 1; return; }
    }
    const e = 0.06;
    const c = this._envelope(x, z, hx, hz, r);
    const a = this._envelope(x - hx * e, z - hz * e, hx, hz, r);
    const b = this._envelope(x + hx * e, z + hz * e, hx, hz, r);
    let slope = (b - a) / (2 * e);
    if (slope > 0.8) slope = 0.8; else if (slope < -0.8) slope = -0.8;
    const inv = 1 / Math.sqrt(1 + slope * slope);
    out.hc = c; out.ns = -slope * inv; out.ny = inv;
  }

  // ---- obstacles -----------------------------------------------------
  // Oriented box. rot = rotation about Y (three.js convention).
  addBox(x, z, hx, hz, rot = 0, y0 = 0, y1 = 100, extra = null) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const o = { t: 0, x, z, hx, hz, c, s, y0, y1, stamp: 0 };
    if (extra) Object.assign(o, extra);
    const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    this._insert(this.oCells, o, x - ex, x + ex, z - ez, z + ez);
    this.obstacles.push(o);
    return o;
  }

  addCircle(x, z, r, y0 = 0, y1 = 100, extra = null) {
    const o = { t: 1, x, z, r, y0, y1, stamp: 0 };
    if (extra) Object.assign(o, extra);
    this._insert(this.oCells, o, x - r, x + r, z - r, z + r);
    this.obstacles.push(o);
    return o;
  }

  // Calls cb(obstacle) once for each obstacle whose cells overlap the query circle.
  query(x, z, r, cb) {
    const stamp = ++this._stamp;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const c = this.oCells.get(key(ix, iz));
        if (!c) continue;
        for (let i = 0; i < c.length; i++) {
          const o = c[i];
          if (o.stamp === stamp) continue;
          o.stamp = stamp;
          cb(o);
        }
      }
    }
  }

  // Is the straight line between two points blocked by a building?
  losBlocked(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const boxes = this.sightBoxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (x0 < b.x0 || x0 > b.x1) continue; }
      else {
        let a = (b.x0 - x0) / dx, c = (b.x1 - x0) / dx;
        if (a > c) { const t = a; a = c; c = t; }
        if (a > t0) t0 = a; if (c < t1) t1 = c;
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (z0 < b.z0 || z0 > b.z1) continue; }
      else {
        let a = (b.z0 - z0) / dz, c = (b.z1 - z0) / dz;
        if (a > c) { const t = a; a = c; c = t; }
        if (a > t0) t0 = a; if (c < t1) t1 = c;
        if (t0 > t1) continue;
      }
      return true;
    }
    return false;
  }

  inCover(x, z) {
    for (let i = 0; i < this.cover.length; i++) {
      const c = this.cover[i];
      if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return true;
    }
    return false;
  }
}

// Circle (px,pz,pr) vs obstacle. Returns penetration depth (>0 when touching) and
// writes the outward normal into out.nx/out.nz.
export function circleVsObstacle(o, px, pz, pr, out) {
  if (o.t === 1) {
    const dx = px - o.x, dz = pz - o.z;
    const d = Math.hypot(dx, dz);
    const pen = o.r + pr - d;
    if (pen <= 0) return 0;
    if (d > 1e-6) { out.nx = dx / d; out.nz = dz / d; } else { out.nx = 1; out.nz = 0; }
    return pen;
  }
  // into box-local space
  const dx = px - o.x, dz = pz - o.z;
  const lx = dx * o.c - dz * o.s;
  const lz = dx * o.s + dz * o.c;
  const cx = Math.max(-o.hx, Math.min(o.hx, lx));
  const cz = Math.max(-o.hz, Math.min(o.hz, lz));
  let nx = lx - cx, nz = lz - cz;
  let d = Math.hypot(nx, nz), pen;
  if (d > 1e-6) {
    pen = pr - d;
    if (pen <= 0) return 0;
    nx /= d; nz /= d;
  } else {
    // centre is inside the box: push out through the nearest face
    const ex = o.hx - Math.abs(lx), ez = o.hz - Math.abs(lz);
    if (ex < ez) { nx = lx >= 0 ? 1 : -1; nz = 0; pen = ex + pr; }
    else { nx = 0; nz = lz >= 0 ? 1 : -1; pen = ez + pr; }
  }
  out.nx = nx * o.c + nz * o.s;
  out.nz = -nx * o.s + nz * o.c;
  return pen;
}
