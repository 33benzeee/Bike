// Particles (dust, smoke, sparks) and tyre marks.
import * as THREE from 'three';

const MAX = 420;

export class Effects {
  constructor(scene) {
    this.n = 0;
    this.pos = new Float32Array(MAX * 3); this.col = new Float32Array(MAX * 4); this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3); this.life = new Float32Array(MAX); this.max = new Float32Array(MAX);
    this.grav = new Float32Array(MAX); this.grow = new Float32Array(MAX); this.alpha = new Float32Array(MAX);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: 'attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.15, length(d)); if (a * vC.a < 0.01) discard; gl_FragColor = vec4(vC.rgb, vC.a * a); }',
    }));
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);

    // tyre marks: a ring buffer of ground quads
    this.SK = 300; this.sk = 0;
    this.skPos = new Float32Array(this.SK * 12);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.skPos, 3));
    const idx = [];
    for (let k = 0; k < this.SK; k++) idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
    sg.setIndex(idx);
    this.skids = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x0c0c0d, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.skids.frustumCulled = false;
    scene.add(this.skids);
    this._lx = null;
  }

  setScale(h) { this.points.material.uniforms.scale.value = h * 0.9; }

  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a, grav = 0, grow = 0) {
    const k = this.n; this.n = (this.n + 1) % MAX;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.col[k * 4] = r; this.col[k * 4 + 1] = g; this.col[k * 4 + 2] = b; this.col[k * 4 + 3] = a;
    this.life[k] = life; this.max[k] = life; this.size[k] = size; this.grav[k] = grav; this.grow[k] = grow; this.alpha[k] = a;
  }

  dust(x, y, z, n, col, spread = 1) {
    for (let k = 0; k < n; k++) this.spawn(x + (Math.random() - 0.5) * 0.4, y + 0.1, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 2.2 * spread, 0.5 + Math.random() * 1.4, (Math.random() - 0.5) * 2.2 * spread, 0.7 + Math.random() * 0.6, 0.35, col[0], col[1], col[2], 0.5, -0.4, 1.2);
  }

  sparks(x, y, z, n, vx = 0, vz = 0) {
    for (let k = 0; k < n; k++) this.spawn(x, y + 0.05, z, vx * 0.5 + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, vz * 0.5 + (Math.random() - 0.5) * 4, 0.25 + Math.random() * 0.3, 0.07, 1, 0.75 + Math.random() * 0.2, 0.3, 1, 9, 0);
  }

  smoke(x, y, z, n) {
    for (let k = 0; k < n; k++) this.spawn(x, y + 0.05, z, (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.5, 0.3, 0.85, 0.85, 0.85, 0.3, -0.6, 1.6);
  }

  // lay a strip of rubber between the last and the current contact point
  skid(x, y, z, on) {
    if (!on) { this._lx = null; return; }
    if (this._lx !== null) {
      const dx = x - this._lx, dz = z - this._lz, d = Math.hypot(dx, dz);
      if (d < 0.25) return;
      if (d < 3) {
        const nx = (-dz / d) * 0.05, nz = (dx / d) * 0.05, o = this.sk * 12, p = this.skPos;
        p[o] = this._lx - nx; p[o + 1] = this._ly + 0.015; p[o + 2] = this._lz - nz;
        p[o + 3] = this._lx + nx; p[o + 4] = this._ly + 0.015; p[o + 5] = this._lz + nz;
        p[o + 6] = x + nx; p[o + 7] = y + 0.015; p[o + 8] = z + nz;
        p[o + 9] = x - nx; p[o + 10] = y + 0.015; p[o + 11] = z - nz;
        this.sk = (this.sk + 1) % this.SK;
        this.skids.geometry.attributes.position.needsUpdate = true;
      }
    }
    this._lx = x; this._ly = y; this._lz = z;
  }

  update(dt) {
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.col[k * 4 + 3] = 0; this.size[k] = 0; continue; }
      this.vel[k * 3 + 1] -= this.grav[k] * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.size[k] += this.grow[k] * dt;
      this.col[k * 4 + 3] = this.alpha[k] * (this.life[k] / this.max[k]);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true; a.color.needsUpdate = true; a.size.needsUpdate = true;
  }
}
