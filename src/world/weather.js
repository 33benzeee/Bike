// Day/night cycle and weather. A full day is 24 real minutes: 12 of daylight (06:00-18:00)
// and 12 of night, so one game hour passes every real minute. Weather drifts between clear,
// cloudy, fog, rain, thunderstorms and storms, blending over about half a minute; rain brings
// falling streaks, darker skies, closer fog and wet roads, and storms add lightning and thunder.
import * as THREE from 'three';
import { TIMES } from './sky.js';

const MIN_PER_HOUR = 1; // real minutes per game hour

const SUNRISE = { ...TIMES.sunset, label: 'Sunrise', top: 0x35508c, horizon: 0xf4b98a, fog: 0xe6bc98 };
// key palettes through the day (hour, palette)
const KEYS = [[0, TIMES.night], [4.9, TIMES.night], [6.1, SUNRISE], [7.6, TIMES.day], [16.4, TIMES.day], [17.9, TIMES.sunset], [19.2, TIMES.night], [24, TIMES.night]];

export const WEATHERS = {
  clear: { label: 'Clear', cloud: 0, rain: 0, bolt: 0, fog: 0, wind: 0, chance: 45, min: 3, max: 6 },
  cloudy: { label: 'Cloudy', cloud: 0.6, rain: 0, bolt: 0, fog: 0.15, wind: 0.2, chance: 20, min: 2, max: 5 },
  fog: { label: 'Fog', cloud: 0.55, rain: 0, bolt: 0, fog: 1, wind: 0, chance: 7, min: 2, max: 4 },
  rain: { label: 'Rain', cloud: 0.85, rain: 0.55, bolt: 0, fog: 0.35, wind: 0.3, chance: 15, min: 2, max: 5 },
  thunder: { label: 'Thunderstorm', cloud: 1, rain: 0.8, bolt: 0.55, fog: 0.45, wind: 0.5, chance: 9, min: 2, max: 4 },
  storm: { label: 'Storm', cloud: 1, rain: 1, bolt: 1, fog: 0.6, wind: 1, chance: 4, min: 1.5, max: 3 },
};

const _a = new THREE.Color(), _b = new THREE.Color();
const mixHex = (a, b, f) => _a.set(a).lerp(_b.set(b), f).getHex();
const lerp = (a, b, f) => a + (b - a) * f;

// the base sky for an hour of the day, blended between the key palettes
function paletteAt(h) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, A] = KEYS[i], [h1, B] = KEYS[i + 1], f = h1 > h0 ? Math.min(1, Math.max(0, (h - h0) / (h1 - h0))) : 0;
  const out = {};
  for (const k of ['top', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'fog', 'water', 'lamps']) out[k] = mixHex(A[k], B[k], f);
  for (const k of ['sunI', 'hemiI', 'fogNear', 'fogFar', 'glow', 'pools', 'exposure']) out[k] = lerp(A[k] || 0, B[k] || 0, f);
  // the sun (or the moon at night) crosses the sky
  const day = h >= 6 && h < 18, a = ((day ? h - 6 : (h + 6) % 24) / 12) * Math.PI;
  out.dir = [Math.cos(a) * 0.85, Math.max(0.14, Math.sin(a) * (day ? 0.9 : 0.75)), day ? 0.35 : -0.4];
  out.night = h < 6.2 || h >= 17.85;
  return out;
}

export class Weather {
  constructor(scene, quality) {
    this.hour = 9; // a new session starts mid-morning
    this.kind = 'clear'; this.next = 'clear'; this.left = 4 * 60;
    this.mix = { cloud: 0, rain: 0, bolt: 0, fog: 0, wind: 0 };
    this.flash = 0; this.boltT = 6; this.thunder = []; this.windA = 0.4;
    this.onThunder = null; this.onChange = null;
    // rain: streaks in a box that follows the camera, animated entirely on the GPU
    const N = quality > 1 ? 4200 : quality > 0 ? 3000 : 1600;
    const seed = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      for (let e = 0; e < 2; e++) { seed.set([x, y, z], (i * 2 + e) * 3); end[i * 2 + e] = e; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainN = N;
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xaebfd0) } },
      vertexShader: `attribute float aEnd; uniform float uTime; uniform vec3 uCam; uniform vec2 uWind;
        varying float vEnd;
        void main() {
          vec3 box = vec3(44.0, 26.0, 44.0);
          vec3 vel = vec3(uWind.x, -17.0, uWind.y);
          vec3 o = uCam - box * 0.5;
          vec3 p = o + mod(position * box + vel * uTime - o, box);
          p -= normalize(vel) * aEnd * 0.8;
          vEnd = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vEnd;
        void main() { gl_FragColor = vec4(uColor, uOpacity * (0.35 + 0.65 * vEnd)); }`,
    });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false; this.rain.renderOrder = 5; this.rain.visible = false;
    scene.add(this.rain);
  }

  get label() { return WEATHERS[this.kind].label; }
  // grip multiplier for wet roads
  get grip() { return 1 - 0.2 * this.mix.rain; }
  get clock() { const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60); return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`; }

  _pick() {
    const tot = Object.values(WEATHERS).reduce((s, w) => s + w.chance, 0);
    let r = Math.random() * tot;
    for (const [k, w] of Object.entries(WEATHERS)) { r -= w.chance; if (r <= 0) return k; }
    return 'clear';
  }

  // force a weather (and how long it should last, in minutes)
  set(kind, minutes) {
    if (!WEATHERS[kind]) return;
    this.kind = kind; const w = WEATHERS[kind];
    this.left = (minutes ?? w.min + Math.random() * (w.max - w.min)) * 60;
    if (this.onChange) this.onChange(kind);
  }

  // dt: seconds. cycle: is the clock running. dynamic: does the weather change by itself.
  update(dt, cam, { cycle = true, dynamic = true } = {}) {
    if (cycle) this.hour = (this.hour + dt / (60 * MIN_PER_HOUR)) % 24;
    if (dynamic) {
      this.left -= dt;
      if (this.left <= 0) this.set(this._pick());
    } else if (this.kind !== 'clear') this.set('clear', 999);
    // blend towards the current weather over ~30 s
    const w = WEATHERS[this.kind], k = Math.min(1, dt / 30);
    for (const key of ['cloud', 'rain', 'bolt', 'fog', 'wind']) this.mix[key] += (w[key] - this.mix[key]) * (key === 'rain' ? k * 1.4 : k);
    // lightning: a bright double flicker, thunder a moment later
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.mix.bolt > 0.25) {
      this.boltT -= dt * this.mix.bolt;
      if (this.boltT <= 0) {
        this.boltT = 3 + Math.random() * 9;
        this.flash = 1; this._flicker = 0.12;
        this.thunder.push({ t: 0.4 + Math.random() * 2.6, v: 0.5 + Math.random() * 0.5 });
      }
    }
    if (this._flicker > 0) { this._flicker -= dt; if (this._flicker <= 0 && Math.random() < 0.7) this.flash = 0.8; }
    for (let i = this.thunder.length - 1; i >= 0; i--) {
      const th = this.thunder[i]; th.t -= dt;
      if (th.t <= 0) { this.thunder.splice(i, 1); if (this.onThunder) this.onThunder(th.v * this.mix.bolt); }
    }
    // rain streaks
    const r = this.mix.rain;
    this.windA += (Math.sin(performance.now() * 0.00007) * 0.6 - this.windA) * Math.min(1, dt);
    this.rain.visible = r > 0.02;
    if (this.rain.visible) {
      const u = this.rainMat.uniforms, wind = 2 + this.mix.wind * 9;
      u.uTime.value = (u.uTime.value + dt) % 1000; u.uCam.value.copy(cam);
      u.uWind.value.set(Math.cos(this.windA) * wind, Math.sin(this.windA) * wind);
      u.uOpacity.value = 0.5 + 0.3 * r;
      this.rain.geometry.setDrawRange(0, Math.floor(this.rainN * 2 * Math.min(1, r * 1.1)));
    }
  }

  // the sky palette right now: the hour's palette (or a fixed one) with the weather laid over it
  palette(fixed) {
    const base = fixed ? { ...fixed, night: fixed === TIMES.night } : paletteAt(this.hour);
    const m = this.mix, c = m.cloud, dark = Math.min(1, c * 0.75 + m.rain * 0.25);
    const p = { ...base };
    // overcast greys, darker the heavier the weather
    const grey = base.night ? 0x161b28 : mixHex(0x8b939c, 0x4c545d, m.rain), greyTop = base.night ? 0x0a0d14 : mixHex(0x6b737d, 0x343a42, m.rain);
    p.top = mixHex(base.top, greyTop, c * 0.85);
    p.horizon = mixHex(base.horizon, grey, c * 0.8);
    p.fog = mixHex(base.fog, grey, Math.max(c * 0.8, m.fog));
    p.sun = mixHex(base.sun, 0xc8ccd2, c * 0.6);
    p.sunI = base.sunI * (1 - 0.82 * c);
    p.hemiI = base.hemiI * (1 - 0.5 * dark) + this.flash * 3.5;
    p.hemiSky = mixHex(base.hemiSky, 0xb8c0c8, c * 0.5);
    p.fogNear = base.fogNear * (1 - 0.65 * Math.max(m.fog, m.rain * 0.6));
    p.fogFar = base.fogFar * (1 - 0.72 * Math.max(m.fog, m.rain * 0.55, c * 0.3));
    p.exposure = base.exposure * (1 - 0.22 * dark) + this.flash * 0.4;
    p.glow = Math.max(base.glow || 0, Math.max(0, dark - 0.6) * 0.9);
    p.pools = Math.max(base.pools || 0, dark > 0.7 ? 0.4 : 0);
    if (this.flash > 0) { p.top = mixHex(p.top, 0xdde6ff, this.flash * 0.7); p.horizon = mixHex(p.horizon, 0xe8eeff, this.flash * 0.6); }
    // street lights and headlights come on in the dark or a heavy storm
    p.night = base.night || dark > 0.85;
    return p;
  }
}
