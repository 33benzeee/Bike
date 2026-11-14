// Camera rig: chase, far chase, first-person and handlebar views.
import * as THREE from 'three';
import { circleVsObstacle } from './world/terrain.js';

export const CAM_MODES = [
  { id: 'chase', label: 'Chase' },
  { id: 'far', label: 'Far chase' },
  { id: 'first', label: 'First person' },
  { id: 'bars', label: 'Handlebar cam' },
];

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _h = { nx: 0, nz: 0 };
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export class CameraRig {
  constructor(camera, terrain) {
    this.camera = camera; this.terrain = terrain;
    this.mode = 0; this.yaw = 0; this.side = 0; this.shake = 0; this.fov = 65; this.snap = true;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.orbit = 0;
  }

  get id() { return CAM_MODES[this.mode].id; }
  next() { this.mode = (this.mode + 1) % CAM_MODES.length; this.snap = true; return CAM_MODES[this.mode]; }
  set(id) { const i = CAM_MODES.findIndex((m) => m.id === id); if (i >= 0) { this.mode = i; this.snap = true; } }
  kick(a) { this.shake = Math.min(1, this.shake + a); }

  _blocked(x, z) {
    let hit = false;
    this.terrain.query(x, z, 0.5, (o) => { if (!hit && o.y1 > 4 && circleVsObstacle(o, x, z, 0.35, _h) > 0) hit = true; });
    return hit;
  }

  // menu / garage orbit
  orbitAround(dt, x, y, z, dist = 5.5, height = 1.6, speed = 0.25) {
    this.orbit += dt * speed;
    this.camera.position.set(x + Math.sin(this.orbit) * dist, y + height, z + Math.cos(this.orbit) * dist);
    this.camera.lookAt(x, y + 0.7, z);
    this.camera.fov += (50 - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
    this.snap = true;
  }

  update(dt, phys, model, rider) {
    const cam = this.camera, id = this.id;
    const speed = Math.abs(phys.speed);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake * 0.12;
    let fovT = 64 + Math.min(22, speed * 0.75);

    if (phys.crashed) {
      // watch the rider tumble
      const r = phys.rag;
      _t.set(r.x, r.y + 0.5, r.z);
      _v.set(r.x - Math.sin(this.yaw) * 5.5, r.y + 2.6, r.z - Math.cos(this.yaw) * 5.5);
      this.pos.lerp(_v, Math.min(1, dt * 3)); this.look.lerp(_t, Math.min(1, dt * 6));
      cam.position.copy(this.pos); cam.lookAt(this.look);
      fovT = 60;
    } else if (id === 'chase' || id === 'far') {
      const far = id === 'far';
      // follow where the bike is going, not every twitch of the bars
      const travel = speed > 2.5 ? Math.atan2(phys.vx, phys.vz) : phys.yaw;
      const want = phys.yaw + angDiff(travel, phys.yaw) * 0.5;
      this.yaw += angDiff(want, this.yaw) * Math.min(1, dt * (far ? 2.6 : 3.6));
      const wheelie = phys.wheelieT > 0.15 || (phys.pitch < -0.25 && phys.frontContact);
      this.side += ((wheelie && !far ? 1 : 0) - this.side) * Math.min(1, dt * 2.2);
      const dist = (far ? 9 : 4.7) + speed * 0.045, height = (far ? 4.4 : 1.75) - this.side * 0.5;
      const sx = Math.sin(this.yaw), sz = Math.cos(this.yaw);
      _t.set(phys.x + sx * 1.2, phys.y + 0.45, phys.z + sz * 1.2);
      // swing out to the right during wheelies so you can read the angle
      const off = this.side * 1.9;
      let cx = phys.x - sx * dist - sz * off, cz = phys.z - sz * dist + sx * off;
      // pull in if a building is in the way
      if (this._blocked(cx, cz)) {
        for (let f = 0.85; f > 0.15; f -= 0.14) {
          cx = phys.x - sx * dist * f - sz * off * f; cz = phys.z - sz * dist * f + sx * off * f;
          if (!this._blocked(cx, cz)) break;
        }
      }
      const gy = this.terrain.height(cx, cz);
      _v.set(cx, Math.max(phys.y - 0.6 + height, gy + 0.5), cz);
      if (this.snap) { this.pos.copy(_v); this.look.copy(_t); this.snap = false; }
      this.pos.x += (_v.x - this.pos.x) * Math.min(1, dt * 9);
      this.pos.z += (_v.z - this.pos.z) * Math.min(1, dt * 9);
      this.pos.y += (_v.y - this.pos.y) * Math.min(1, dt * 5);
      this.look.lerp(_t, Math.min(1, dt * 12));
      cam.position.copy(this.pos);
      cam.position.x += (Math.random() - 0.5) * sh; cam.position.y += (Math.random() - 0.5) * sh;
      cam.lookAt(this.look);
      cam.rotation.z += -phys.lean * 0.12;
    } else {
      this.yaw = phys.yaw;
      if (id === 'first') {
        rider.headWorld(_v);
        const hx = Math.sin(phys.yaw), hz = Math.cos(phys.yaw);
        cam.position.set(_v.x + hx * 0.1, _v.y + 0.04, _v.z + hz * 0.1);
        cam.rotation.set(phys.pitch * 0.45 - 0.1, phys.yaw + Math.PI - phys.steer * 0.08, phys.lean * 0.65, 'YXZ');
        fovT += 12;
      } else {
        // bolted to the bars: you feel every degree
        _v.set(0, 0.42, -0.12); model.fork.localToWorld(_v);
        cam.position.copy(_v);
        cam.rotation.set(phys.pitch * 0.9 - 0.12, phys.yaw + Math.PI, phys.lean * 0.9, 'YXZ');
        fovT += 16;
      }
      cam.position.y += (Math.random() - 0.5) * sh;
      this.pos.copy(cam.position); this.snap = false;
    }
    this.fov += (fovT - this.fov) * Math.min(1, dt * 3);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
