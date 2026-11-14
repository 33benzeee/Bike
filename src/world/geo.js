// Geometry batching helpers: build big static meshes with vertex colours so the
// whole city renders in a handful of draw calls.
import * as THREE from 'three';

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export function rgb(hex, out = []) {
  _c.set(hex);
  out[0] = _c.r; out[1] = _c.g; out[2] = _c.b;
  return out;
}

export class Batch {
  constructor() {
    this.p = []; this.n = []; this.c = []; this.uv = []; this.i = [];
    this.v = 0;
    this._col = [1, 1, 1];
  }

  color(hex) {
    rgb(hex, this._col);
    return this;
  }

  _vert(x, y, z, nx, ny, nz, u, v) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz);
    this.c.push(this._col[0], this._col[1], this._col[2]);
    this.uv.push(u, v);
    return this.v++;
  }

  // a,b,c,d counter-clockwise when seen from the front
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = dx - ax, vy = dy - ay, vz = dz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const i0 = this._vert(ax, ay, az, nx, ny, nz, u0, v0);
    this._vert(bx, by, bz, nx, ny, nz, u1, v0);
    this._vert(cx, cy, cz, nx, ny, nz, u1, v1);
    this._vert(dx, dy, dz, nx, ny, nz, u0, v1);
    this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    return this;
  }

  // horizontal quad facing up
  flat(x0, z0, x1, z1, y, uvScale = 1) {
    return this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, x0 / uvScale, z1 / uvScale, x1 / uvScale, z0 / uvScale);
  }

  // Box centred on (x, z), sitting on y0, rotated about Y.
  // opts: rot, top (hex colour for the lid or false), bottom, uvW/uvH (metres per repeat on sides)
  box(x, y0, z, sx, sy, sz, opts = {}) {
    const rot = opts.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
    const hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
    const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const [ax, az] = P(-hx, hz), [bx, bz] = P(hx, hz), [cx, cz] = P(hx, -hz), [dx, dz] = P(-hx, -hz);
    const uw = opts.uvW || 1, uh = opts.uvH || 1;
    const u = sx / uw, w = sz / uw, v = sy / uh;
    if (opts.sides !== false) {
      this.quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, 0, 0, u, v);
      this.quad(bx, y0, bz, cx, y0, cz, cx, y1, cz, bx, y1, bz, 0, 0, w, v);
      this.quad(cx, y0, cz, dx, y0, dz, dx, y1, dz, cx, y1, cz, 0, 0, u, v);
      this.quad(dx, y0, dz, ax, y0, az, ax, y1, az, dx, y1, dz, 0, 0, w, v);
    }
    if (opts.top !== false) {
      const keep = this._col;
      if (opts.top !== undefined && opts.top !== true) this._col = rgb(opts.top);
      this.quad(ax, y1, az, bx, y1, bz, cx, y1, cz, dx, y1, dz, 0, 0, 0.02, 0.02);
      this._col = keep;
    }
    if (opts.bottom) this.quad(dx, y0, dz, cx, y0, cz, bx, y0, bz, ax, y0, az);
    return this;
  }

  // append any BufferGeometry, transformed by a Matrix4, painted in the current colour
  geom(g, m) {
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const base = this.v;
    if (m) _nm.getNormalMatrix(m);
    for (let k = 0; k < pos.count; k++) {
      _v.fromBufferAttribute(pos, k);
      _n.fromBufferAttribute(nor, k);
      if (m) { _v.applyMatrix4(m); _n.applyMatrix3(_nm).normalize(); }
      this._vert(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0);
    }
    if (g.index) { const ix = g.index; for (let k = 0; k < ix.count; k++) this.i.push(base + ix.getX(k)); }
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    return this;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }

  mesh(material, { cast = false, receive = true } = {}) {
    const m = new THREE.Mesh(this.geometry(), material);
    m.castShadow = cast; m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    return m;
  }
}

// ---- matrix helpers for composing props --------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Euler();
export function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
// matrix that stretches a unit-height Y cylinder from point a to point b
export function between(ax, ay, az, bx, by, bz, radius = 1) {
  _d.set(bx - ax, by - ay, bz - az);
  const len = _d.length() || 1e-6;
  _q.setFromUnitVectors(UP, _d.divideScalar(len));
  return _m.compose(_p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(radius, len, radius)).clone();
}

// ---- canvas textures -----------------------------------------------------
export function canvasTexture(size, draw, { repeat = true, srgb = true, aniso = 4 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
