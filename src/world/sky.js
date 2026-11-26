// Sky dome, sun/moon, fog and the time-of-day presets.
import * as THREE from 'three';

export const TIMES = {
  day: { label: 'Day', top: 0x2f74d0, horizon: 0xbfdcf2, sun: 0xfff1dc, sunI: 2.6, hemiSky: 0xd6e9ff, hemiGround: 0x8a8378, hemiI: 1.9, fog: 0xc3dcf0, fogNear: 160, fogFar: 950, glow: 0, dir: [0.45, 0.8, 0.35], water: 0x2f7396, lamps: 0x8f8f86, exposure: 1.15 },
  sunset: { label: 'Golden hour', top: 0x2c4a86, horizon: 0xf6b06a, sun: 0xffb46e, sunI: 2.6, hemiSky: 0xf1cdb0, hemiGround: 0x6e6068, hemiI: 1.5, fog: 0xeab183, fogNear: 130, fogFar: 850, glow: 0.3, pools: 0.12, dir: [-0.72, 0.3, 0.42], water: 0x4a6a8a, lamps: 0xfff0c8, exposure: 1.15 },
  night: { label: 'Night', top: 0x04060e, horizon: 0x18203a, sun: 0x9db2ff, sunI: 1.3, hemiSky: 0x55639a, hemiGround: 0x2a2a3a, hemiI: 2.6, pools: 0.85, fog: 0x0f1528, fogNear: 70, fogFar: 520, glow: 1.0, dir: [0.3, 0.75, -0.4], water: 0x0b1626, lamps: 0xffe6b0, exposure: 1.25 },
};

export class Sky {
  constructor(scene, renderer, quality) {
    this.scene = scene; this.renderer = renderer;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(2600, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vDir; uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol;
          void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.55));
            float s = max(dot(normalize(vDir), sunDir), 0.0); c += sunCol * (pow(s, 350.0) * 1.6 + pow(s, 12.0) * 0.22);
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      })
    );
    this.dome.frustumCulled = false; this.dome.renderOrder = -10;
    scene.add(this.dome);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = quality > 0;
    const s = this.sun.shadow;
    s.mapSize.set(quality > 1 ? 2048 : 1024, quality > 1 ? 2048 : 1024);
    const ext = quality > 1 ? 70 : 48;
    s.camera.left = -ext; s.camera.right = ext; s.camera.top = ext; s.camera.bottom = -ext;
    s.camera.near = 10; s.camera.far = 420; s.bias = -0.0006; s.normalBias = 0.04;
    s.camera.updateProjectionMatrix();
    scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.Fog(0xffffff, 100, 900);
    this.dir = new THREE.Vector3();
    this.night = false; this.name = 'day';
  }

  apply(name, city) {
    this.name = name;
    this.applyPalette(TIMES[name] || TIMES.day, city, name === 'night');
  }

  // any palette shaped like a TIMES entry (the cycle and the weather blend their own)
  applyPalette(t, city, night) {
    this.night = !!night;
    const u = this.dome.material.uniforms;
    u.top.value.set(t.top); u.hor.value.set(t.horizon); u.sunCol.value.set(t.sun);
    this.dir.set(t.dir[0], t.dir[1], t.dir[2]).normalize();
    u.sunDir.value.copy(this.dir);
    this.sun.color.set(t.sun); this.sun.intensity = t.sunI;
    this.hemi.color.set(t.hemiSky); this.hemi.groundColor.set(t.hemiGround); this.hemi.intensity = t.hemiI;
    this.scene.fog.color.set(t.fog); this.scene.fog.near = t.fogNear; this.scene.fog.far = t.fogFar;
    this.renderer.toneMappingExposure = t.exposure;
    if (city) {
      city.mats.walls.emissiveIntensity = t.glow;
      city.mats.water.color.set(t.water);
      if (city.lampHeads) city.lampHeads.material.color.set(t.lamps);
      if (city.lampPools) { city.lampPools.visible = !!t.pools; city.lampPools.material.opacity = t.pools || 0; }
    }
  }

  // keep the dome and the shadow frustum centred on the player
  update(x, y, z) {
    this.dome.position.set(x, 0, z);
    const sx = Math.round(x / 2) * 2, sz = Math.round(z / 2) * 2;
    this.sun.target.position.set(sx, y, sz);
    this.sun.position.set(sx + this.dir.x * 200, y + this.dir.y * 200, sz + this.dir.z * 200);
    this.sun.target.updateMatrixWorld();
  }
}
