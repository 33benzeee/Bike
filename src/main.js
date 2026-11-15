// Wheelie Works — game bootstrap and main loop.
import * as THREE from 'three';
import { Terrain, circleVsObstacle } from './world/terrain.js';
import { buildCity, CURB } from './world/city.js';
import { Sky, TIMES } from './world/sky.js';
import { BikePhysics } from './physics.js';
import { BIKE_BY_ID, MOD_BY_ID, PAINT_PARTS, PRICES, effectiveSpec, lookOf, modPrice, modState, setModEquipped, newEntry } from './bikes.js';
import { buildBike, poseBike } from './bikeModel.js';
import { Rider } from './rider.js';
import { Input } from './input.js';
import { CameraRig, CAM_MODES } from './camera.js';
import { detectDevice } from './device.js';
import { Traffic } from './traffic.js';
import { Cops, HEAT_REWARD } from './cops.js';
import { Tricks } from './tricks.js';
import { Save } from './progress.js';
import { Effects } from './effects.js';
import { GameAudio } from './audio.js';
import { Hud, money } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { TouchControls } from './ui/touch.js';

const QUALITY = {
  low: { pr: 1.5, shadows: 0, traffic: 20, aa: false },
  med: { pr: 2, shadows: 1, traffic: 30, aa: true },
  high: { pr: 3, shadows: 2, traffic: 44, aa: true },
};
const HEAT_NOTE = ['', 'A cruiser is on you', 'Backup is rolling', 'Roadblocks ahead', 'Bike cops — alleys won\'t save you', 'Helicopter! Find cover'];
const DUST = { 2: [0.42, 0.55, 0.3], 3: [0.62, 0.48, 0.32] };

class Game {
  constructor() {
    this.device = detectDevice();
    this.save = new Save();
    const st = this.save.data.settings;
    document.body.classList.add('device-' + this.device.type);
    document.documentElement.style.setProperty('--u', this.device.type === 'tablet' ? '1.3' : '1');

    let q = st.quality;
    if (!QUALITY[q]) q = this.device.type === 'desktop' ? 'high' : 'med';
    this.q = { ...QUALITY[q] }; this.qName = q;

    const canvas = document.getElementById('game');
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.aa, powerPreference: 'high-performance' }));
    this.pr = Math.min(window.devicePixelRatio || 1, this.q.pr);
    renderer.setPixelRatio(this.pr);
    renderer.shadowMap.enabled = this.q.shadows > 0; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.12, 3200);
    this.terrain = new Terrain();
    this.city = buildCity(this.terrain, { quality: this.q.shadows });
    this.scene.add(this.city.group);
    this.sky = new Sky(this.scene, renderer, this.q.shadows);
    this.sky.apply(st.time, this.city);

    this.phys = new BikePhysics(this.terrain);
    this.input = new Input();
    this.rig = new CameraRig(this.camera, this.terrain);
    this.rig.set(st.camera);
    this.rider = new Rider();
    this.effects = new Effects(this.scene);
    this.audio = new GameAudio(); this.audio.setVolume(st.volume, st.mute);
    this.traffic = new Traffic(this.scene, this.terrain, this.city, this.q.traffic, this.q.shadows > 1);
    this.cops = new Cops(this.scene, this.terrain);
    this.tricks = new Tricks();
    this.hud = new Hud(this.city);
    this.touch = new TouchControls(this.input);
    this.menus = new Menus(this);

    // headlight for night riding
    this.lamp = new THREE.SpotLight(0xfff0d0, 0, 60, 0.55, 0.6, 1.4);
    this.scene.add(this.lamp, this.lamp.target);

    this.trickOn = [false, false, false, false]; this.trickHeld = [false, false, false, false]; this.trickUp = false; this.trickDownT = 0;
    this.inp = { throttle: 0, brake: 0, steer: 0, lean: 0, hop: false, assist: st.assist, comDX: 0, comDY: 0, wobble: 0 };
    this.state = 'title'; this.prevState = 'title';
    this.model = null; this.preview = null; this.previewId = null;
    this.safe = []; this.safeT = 0; this.dustT = 0; this.hitCop = false; this.nearT = 0;
    this.fps = { t: 0, n: 0, low: 0 }; this.frameN = 0; this.hinted = false; this.respawnGrace = 0;
    this._v = new THREE.Vector3();

    this._wire();
    this.setBike(this.save.data.bike, false);
    this._updateControlsMode();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play') this.pause(); });
    this.resize();
    this.menus.show('title');
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---- wiring --------------------------------------------------------------
  _wire() {
    const { tricks, cops, traffic, hud, save, audio } = this;
    tricks.onPopup = (name, pts) => { hud.popup(name, pts); if (pts >= 40) audio.trick(); };
    tricks.onBank = (total, names, mult) => {
      const cash = Math.max(1, Math.round(total / 8));
      save.earn(cash);
      hud.popup(`BANKED ${total.toLocaleString('en-US')}`, 0); hud.popup(`+${money(cash)}`, 0);
      audio.bank(total > 3000);
    };
    tricks.onLost = (total) => { hud.popup(`COMBO LOST  ${total.toLocaleString('en-US')}`, 0); audio.lost(); };
    tricks.onStat = (name, v) => save.stat(name, v);
    save.onChallenge = (c) => { hud.toast('CHALLENGE COMPLETE', c.name, `${c.desc} · +${money(c.reward)}`); audio.bank(true); };
    traffic.onNearMiss = (car, gap) => { if (this.state !== 'play' || this.phys.crashed) return; tricks.nearMiss(gap); if (cops.watcher) cops.suspicion += 0.2; };
    traffic.onHonk = () => audio.honk();
    cops.onWanted = () => { hud.banner('WANTED', HEAT_NOTE[1], 'red', 2.2); audio.wanted(); };
    cops.onHeat = (h) => { hud.banner(`HEAT ${h}`, HEAT_NOTE[h], 'red', 2.4); audio.wanted(); };
    cops.onEscape = (h) => {
      const r = HEAT_REWARD[h];
      save.earn(r); save.stat('escape', h);
      hud.banner('ESCAPED', `Heat ${h} · +${money(r)}`, 'grn', 3); audio.escaped();
    };
    cops.onBusted = () => {
      const fine = Math.min(save.cash, Math.max(100, Math.round(save.cash * 0.15)));
      save.earn(-fine);
      tricks.crash();
      hud.banner('BUSTED', fine ? `Fined ${money(fine)}` : 'They let you off with a warning', 'red', 3.2); audio.busted();
      this.respawn(true);
    };
    this.input.onMode = () => { this._updateControlsMode(); if (this.menus.current === 'title' || this.menus.current === 'pause' || this.menus.current === 'controls') this.menus.refresh(); };
    document.getElementById('btn-cam').addEventListener('click', (e) => { this.input.press('camera'); e.currentTarget.blur(); });
    document.getElementById('btn-pause').addEventListener('click', (e) => { this.input.press('pause'); e.currentTarget.blur(); });
    this.renderer.domElement.addEventListener('pointerdown', () => this.audio.start());
    document.getElementById('rotate-skip').addEventListener('click', () => { document.body.classList.add('portrait-ok'); this.resize(); });
  }

  _updateControlsMode() {
    const pref = this.save.data.settings.controls;
    const touch = pref === 'touch' || (pref === 'auto' && (this.input.mode === 'touch' || (this.device.type !== 'desktop' && this.input.mode !== 'gamepad' && this.input.mode !== 'keyboard') || (this.device.type !== 'desktop' && !this._keyed)));
    this.touchOn = touch;
    this.touch.show(touch && this.state === 'play');
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.effects.setScale(h * this.pr);
  }

  // ---- bikes ----------------------------------------------------------------
  lookFor(id) { return lookOf(this.save.entry(id)); }
  specOf(id) { return effectiveSpec(BIKE_BY_ID[id], this.save.entry(id)); }

  setBike(id, keepPos) {
    const old = this.phys, at = this.foot || old, x = at.x, z = at.z, yaw = at.yaw;
    if (this.model) { this.rider.endRagdoll(this.model.group); this.scene.remove(this.model.group); this.model.group.remove(this.rider.group); this.model.dispose(); }
    const spec = this.specOf(id);
    this.model = buildBike(spec, this.lookFor(id));
    this.scene.add(this.model.group); this.model.group.add(this.rider.group);
    this.phys.setSpec(spec);
    const h = this.city.spots.home;
    if (keepPos) this.phys.reset(x, z, yaw); else this.phys.reset(h.x, h.z, h.yaw);
    this.rig.snap = true; this.safe.length = 0;
    this.burnout = false;
    this._footUI(false); this._tricksOff();
    const bp = document.getElementById('burn'); if (bp) { bp.classList.add('hidden'); document.getElementById('t-burn').classList.remove('on'); }
  }

  buyBike(id) {
    const b = BIKE_BY_ID[id], s = this.save;
    if (s.owns(id) || s.cash < b.price) return false;
    s.data.cash -= b.price; s.data.owned[id] = newEntry(); s.persist();
    this.selectBike(id);
    this.hud.toast('NEW RIDE', b.name, b.brand);
    return true;
  }

  selectBike(id) {
    if (!this.save.owns(id)) return;
    this.save.data.bike = id; this.save.persist();
    this.setBike(id, this.prevState !== 'title');
    this.model.group.visible = false;
  }

  // ---- performance mods -----------------------------------------------------
  _respec(id) {
    this.save.persist();
    if (id === this.save.data.bike) { const spec = this.specOf(id); this.phys.setSpec(spec); this.model.spec = spec; }
  }

  buyMod(id, modId) {
    const s = this.save, e = s.entry(id), b = BIKE_BY_ID[id], mod = MOD_BY_ID[modId];
    if (!e || !mod || modState(e, mod) !== 'buy') return false;
    const price = modPrice(b, mod);
    if (s.cash < price) return false;
    s.data.cash -= price; e.mods[modId] = 1; setModEquipped(e, modId, true);
    this._respec(id);
    return true;
  }

  toggleMod(id, modId) {
    const e = this.save.entry(id);
    if (!e || !e.mods[modId]) return false;
    setModEquipped(e, modId, e.mods[modId] !== 2);
    this._respec(id);
    return true;
  }

  setSusp(id, tune) { const e = this.save.entry(id); if (!e) return; e.susp = tune; this._respec(id); }

  // ---- appearance ---------------------------------------------------------------
  _relook(id) {
    this.save.persist();
    const look = this.lookFor(id);
    if (id === this.save.data.bike) this.model.setLook(look);
    if (this.preview && this.previewId === id) this.preview.setLook(look);
  }
  // show an unsaved design on the garage preview only
  previewLook(look) { if (this.preview) this.preview.setLook(look); }
  _pay(price) { if (this.save.cash < price) return false; this.save.data.cash -= price; return true; }

  // part = a paint slot id or 'all'; color = hex number, or null to go back to stock (free)
  buyPaint(id, part, color) {
    const e = this.save.entry(id);
    if (!e) return false;
    const slots = part === 'all' ? PAINT_PARTS.map((p) => p.id) : [part];
    if (color === null) { for (const k of slots) delete e.look.colors[k]; this._relook(id); return true; }
    if (!this._pay(part === 'all' ? PRICES.paintAll : PRICES.paint)) return false;
    for (const k of slots) e.look.colors[k] = color;
    this._relook(id);
    return true;
  }

  buyWrap(id, wrapId, color) {
    const e = this.save.entry(id);
    if (!e) return false;
    if (!wrapId) { e.look.wrap = null; this._relook(id); return true; }
    if (!e.look.wraps[wrapId]) { if (!this._pay(PRICES.wrap)) return false; e.look.wraps[wrapId] = true; }
    e.look.wrap = { id: wrapId, color };
    this._relook(id);
    return true;
  }

  buyLeds(id, mode, color) {
    const e = this.save.entry(id);
    if (!e) return false;
    if (!e.look.leds.owned) { if (!this._pay(PRICES.leds)) return false; e.look.leds.owned = true; }
    e.look.leds.mode = mode; e.look.leds.color = color;
    this._relook(id);
    return true;
  }

  buyFlag(id, flagId) {
    const e = this.save.entry(id);
    if (!e) return false;
    if (flagId && !e.look.flag.owned) { if (!this._pay(PRICES.flag)) return false; e.look.flag.owned = true; }
    e.look.flag.id = flagId || null;
    this._relook(id);
    return true;
  }

  buyPlate(id, text) {
    const e = this.save.entry(id);
    if (!e) return false;
    text = String(text || '').toUpperCase().replace(/[^A-Z0-9 \-]/g, '').slice(0, 10).trim();
    if (text && !e.look.plate.owned) { if (!this._pay(PRICES.plate)) return false; e.look.plate.owned = true; }
    e.look.plate.text = text;
    this._relook(id);
    return true;
  }

  previewBike(id) {
    if (this.preview) { this.scene.remove(this.preview.group); this.preview.dispose(); }
    this.preview = buildBike(this.specOf(id), this.lookFor(id)); this.previewId = id;
    const h = this.city.spots.home, g = this.preview.group;
    g.position.set(h.shopX, CURB + this.preview.spec.rR, h.shopZ + 7);
    g.rotation.set(0, 0.6, -0.12, 'YXZ');
    this.scene.add(g);
  }

  // ---- state changes ------------------------------------------------------
  startRide() {
    this.audio.start();
    this.state = 'play'; this.menus.hide(); this.hud.show(true); this.input.enabled = true; this.input.queue.length = 0;
    this.rig.set(this.save.data.settings.camera);
    this._updateControlsMode();
    if (!this.hinted) {
      this.hinted = true;
      this.hud.hint(this.touchOn ? 'Hold <b>GAS</b> and press <b>WHEELIE</b> to lift the front · <b>BRAKE</b> brings it back down'
        : 'Hold <kbd>W</kbd> and tap <kbd>Shift</kbd> to wheelie · <kbd>S</kbd> brings it down · <kbd>1</kbd>–<kbd>4</kbd> tricks · <kbd>C</kbd> camera', 9);
    }
  }
  pause() { if (this.state !== 'play') return; this.state = 'pause'; this.tricks.bankNow(); this.menus.show('pause'); this.touch.show(false); this.input.enabled = false; }
  resume() { this.state = 'play'; this.menus.hide(); this.hud.show(true); this.input.enabled = true; this.input.queue.length = 0; this._updateControlsMode(); this.last = performance.now(); }
  toTitle() { this.tricks.bankNow(); this.cops.reset(this.phys.x, this.phys.z); this.respawn(true, true); this.state = 'title'; this.hud.show(false); this.touch.show(false); this.menus.show('title'); }

  openGarage() {
    this.prevState = this.state;
    this.state = 'garage'; this.hud.show(false); this.touch.show(false);
    this.model.group.visible = false; this.rig.orbit = 0.4;
  }
  closeGarage() {
    if (this.preview) { this.scene.remove(this.preview.group); this.preview.dispose(); this.preview = null; }
    this.model.group.visible = true; this.rig.snap = true;
    this.state = this.prevState === 'title' ? 'title' : 'pause';
  }

  applySetting(key, val) {
    const st = this.save.data.settings;
    if (val === 'true') val = true; else if (val === 'false') val = false;
    st[key] = val; this.save.persist();
    if (key === 'time') this.sky.apply(val, this.city);
    else if (key === 'assist') this.inp.assist = val;
    else if (key === 'camera') this.rig.set(val);
    else if (key === 'volume' || key === 'mute') this.audio.setVolume(st.volume, st.mute);
    else if (key === 'controls') this._updateControlsMode();
    else if (key === 'quality') { try { localStorage.setItem('wheelie-works-save-v2', JSON.stringify(this.save.data)); } catch (e) { /* ignore */ } location.reload(); }
  }

  // returns { ok, msg } for the cheat-code screen
  applyCheat(raw) {
    const code = String(raw || '').trim().toUpperCase(), s = this.save;
    if (!code) return { ok: false, msg: 'Type a code first.' };
    if (code === 'BBV33') { s.earn(25000); return { ok: true, msg: `Cha-ching. +${money(25000)} — you now have ${money(s.cash)}.` }; }
    if (code === 'NOCOPS') {
      this.noCops = !this.noCops;
      if (this.noCops) this.cops.reset(this.phys.x, this.phys.z);
      return { ok: true, msg: this.noCops ? 'Cops are ignoring you until you reload or enter NOCOPS again.' : 'Cops are back on duty.' };
    }
    return { ok: false, msg: `"${code}" isn't a code.` };
  }

  wipeSave() { this.save.reset(); location.reload(); }

  respawn(home, quiet) {
    const p = this.phys, h = this.city.spots.home;
    this._footUI(false); this._tricksOff();
    this.rider.endRagdoll(this.model.group);
    const s = !home && this.safe.length ? this.safe[Math.max(0, this.safe.length - 3)] : null;
    if (s) p.reset(s.x, s.z, s.yaw); else p.reset(h.x, h.z, h.yaw);
    if (home) this.cops.reset(h.x, h.z);
    this.rig.snap = true; this.respawnGrace = 1.5;
    if (!quiet) this.audio.ui();
  }

  // ---- main loop ------------------------------------------------------------
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const raw = (now - this.last) / 1000; this.last = now;
    if (this.manual) return;
    this.tick(Math.min(0.05, Math.max(0.001, raw)), raw);
  }

  // one simulation + render step (also driven directly by automated tests)
  tick(dt, raw = dt) {
    this.frameN++;
    if (this.frameN === 2) document.getElementById('loading').style.display = 'none';

    const s = this.input.update();
    if (this.input.mode === 'keyboard') this._keyed = true;
    const st = this.save.data.settings;
    const p = this.phys, model = this.model;

    if (this.state === 'play') this._play(dt, s, st);
    else {
      // menus: world keeps ticking, bike rests
      if (this.input.take('pause') || this.input.take('confirm')) { if (this.state === 'pause') this.resume(); else if (this.state === 'title' && this.menus.current === 'title') this.startRide(); }
      this.input.queue.length = 0;
      if (this.state !== 'pause') {
        this.inp.throttle = 0; this.inp.brake = 0.4; this.inp.steer = 0; this.inp.lean = 0; this.inp.hop = false; this.inp.stoppie = false; this.inp.burnout = false;
        p.step(dt, this.inp, null); p.events.length = 0;
        if (!p.crashed && Math.abs(p.speed) < 0.4) { p.vx = 0; p.vz = 0; }
        this.traffic.update(dt, p, null);
        this._visual(dt, { one: false, no: false, stand: false, drag: false });
      }
      if (this.state === 'garage' && this.preview) {
        const g = this.preview.group;
        this.rig.orbitAround(dt, g.position.x, g.position.y - 0.2, g.position.z, 3.6 + this.preview.spec.wheelbase * 0.6, 1.0, 0.35);
      } else if (this.state === 'title') this.rig.orbitAround(dt, p.x, p.y - 0.4, p.z, 5.2, 1.3, 0.16);
      this.audio.update(dt, { speed: 0, wheelSpeed: 0, topSpeed: 10, throttle: 0, electric: true, active: false });
      this.sky.update(this.camera.position.x, 0, this.camera.position.z);
    }
    this.time = (this.time || 0) + dt;
    this.model.animate(this.time, this.phys.crashed ? 0 : this.phys.speed);
    if (this.preview) this.preview.animate(this.time, 0);
    this.effects.update(dt);
    if (!this.skipRender) this.renderer.render(this.scene, this.camera);
    this._adapt(raw);
  }

  _play(dt, s, st) {
    const p = this.phys, inp = this.inp, input = this.input, model = this.model, spec = model.spec, hud = this.hud;

    // ---- one-shot actions
    if (input.take('pause')) { this.pause(); return; }
    if (input.take('camera')) { const m = this.rig.next(); st.camera = m.id; this.save.persist(); hud.camName(m.label); }
    if (input.take('mute')) { this.applySetting('mute', !st.mute); hud.camName(st.mute ? 'Sound off' : 'Sound on'); }
    if (input.take('time')) { const k = Object.keys(TIMES); const n = k[(k.indexOf(st.time) + 1) % k.length]; this.applySetting('time', n); hud.camName(TIMES[n].label); }
    if (input.take('garage')) {
      if (this.cops.wanted) hud.hint('Lose the cops before you hit the garage', 3);
      else { this.pause(); this.menus.sel = this.save.data.bike; this.openGarage(); this.menus.show('garage'); return; }
    }
    if (input.take('burn')) {
      if (spec.drive.type !== 'electric') { this.burnout = false; hud.hint('Burnouts need a motor — try an e-bike or e-moto', 3); }
      else { this.burnout = !this.burnout; hud.camName(this.burnout ? 'Burnout mode on' : 'Burnout mode off'); }
      document.getElementById('burn').classList.toggle('hidden', !this.burnout);
      document.getElementById('t-burn').classList.toggle('on', this.burnout);
    }
    if (input.take('reset')) {
      if (this.foot) this._callBike();
      else if (p.crashed) { if (p.crashT > 0.5) this._getUp(); }
      else { this.tricks.crash(); this.respawn(false); }
    }
    if (input.take('mount')) this._mount();
    input.take('confirm');

    // ---- rider pose feeds back into the physics (tricks shift weight and wobble)
    const w = this.rider.w, tk = this.trickOn;
    // tricks are switches: tap to start, tap again to stop
    for (let i = 0; i < 4; i++) {
      if (s.tricks[i] && !this.trickHeld[i] && !p.crashed) {
        tk[i] = !tk[i];
        if (tk[i] && i < 2) tk[1 - i] = false; // one-hander and no-hander can't both be on
        this._trickUI();
      }
      this.trickHeld[i] = s.tricks[i];
    }
    // ...and they switch themselves off when the wheelie or jump ends, or you crash
    const up = p.wheelieT > 0.2 || p.airTime > 0.3;
    if (up) { this.trickUp = true; this.trickDownT = 0; }
    else if (this.trickUp && p.frontContact && p.rearContact) { this.trickDownT += dt; if (this.trickDownT > 0.35) { this.trickUp = false; this._tricksOff(); } }
    if (p.crashed) this._tricksOff();

    inp.throttle = s.throttle; inp.brake = s.brake; inp.steer = s.steer; inp.lean = s.lean; inp.hop = s.hop; inp.assist = st.assist;
    let frontLever = s.stoppie;
    // what your hands and feet are doing limits what you can control
    if (w.no > 0.5) {
      // no hands on the bars: no throttle grip, no brake levers, no pulling, body-lean steering only
      if (spec.drive.type === 'electric') inp.throttle = 0;
      inp.brake = 0; frontLever = false; inp.hop = false; inp.steer *= 0.35;
      if (inp.lean > 0) inp.lean = 0;
    } else if (w.one > 0.5) {
      // one hand: you can't yank the bars or hop
      inp.hop = false; if (inp.lean > 0) inp.lean = 0;
    }
    if (w.stand > 0.5 && w.air < 0.5) {
      // standing on the seat: feet are off the pedals
      if (spec.drive.type === 'pedal') inp.throttle = 0;
      inp.hop = false;
    }
    if (s.hop && !inp.hop) { p._hopHeld = false; p.hopCharge = 0; }
    inp.burnout = !!this.burnout && w.no < 0.5;
    // the stoppie button is the front brake on its own: on the ground it lifts the
    // tail, in a wheelie it only stops the front wheel spinning
    inp.stoppie = frontLever;
    inp.comDX = -w.no * 0.035 + w.drag * 0.02; inp.comDY = w.stand * (1 - w.air) * 0.16;
    inp.wobble = Math.min(1, w.one * 0.25 + w.no * 0.5 + w.stand * 0.75 + w.drag * 0.2);

    // ---- simulate
    const dyn = this.traffic.dyn.concat(this.cops.dyn);
    p.step(dt, inp, dyn);

    const hx = Math.sin(p.yaw), hz = Math.cos(p.yaw);
    const groundY = this.terrain.height(p.x, p.z);
    this.hitCop = false;
    for (const e of p.events) {
      if (e.type === 'land') { this.audio.land(e.impact); this.rig.kick(Math.min(1, e.impact / 9)); if (e.impact > 3) this.effects.dust(p.x, groundY, p.z, Math.min(10, e.impact | 0), DUST[p.surface] || [0.6, 0.6, 0.6]); }
      else if (e.type === 'hop') this.audio.hop();
      else if (e.type === 'bump') { this.audio.bump(); this.rig.kick(0.3); if (e.cop) this.hitCop = true; else if (e.ref) this.traffic.bumped(e.ref); }
      else if (e.type === 'crash') {
        this.audio.crash(); this.rig.kick(1); this.tricks.crash();
        if (e.cop) this.hitCop = true; else if (e.ref) this.traffic.bumped(e.ref);
        this.effects.sparks(p.x, groundY + 0.3, p.z, 16, p.vx, p.vz); this.effects.dust(p.x, groundY, p.z, 8, [0.6, 0.6, 0.6]);
        const msg = { loopout: 'LOOPED OUT', endo: 'OVER THE BARS', hit: 'WRECKED', slam: 'SLAMMED', sideways: 'HIGH-SIDED', slide: 'LOW-SIDED' }[e.reason] || 'CRASHED';
        hud.banner(msg, '', 'yel', 2);
      }
    }
    const sm = st.assist === 0 ? 1.4 : st.assist === 2 ? 0.6 : 1;
    this.tricks.scoreMult = sm; this.tricks.heatMult = this.cops.wanted ? 1 + 0.25 * this.cops.heat : 1;
    this.tricks.update(dt, p, w, spec);
    p.events.length = 0;

    // ---- crashes and respawns
    // No automatic respawn: once the tumble is over you get up and walk.
    if (p.crashed) {
      if (!this.foot && (p.crashT > 4 || (p.crashT > 1.4 && this.rider.ragdollSpeed() < 0.7))) this._getUp();
      if (this.foot) this._walk(dt, s, dyn);
    }
    else {
      this.safeT += dt;
      if (this.safeT > 0.5 && p.rearContact && p.frontContact && Math.abs(p.speed) > 2.5 && Math.abs(p.lean) < 0.5 && Math.abs(p.pitch) < 0.12) {
        this.safeT = 0; this.safe.push({ x: p.x, z: p.z, yaw: p.yaw }); if (this.safe.length > 8) this.safe.shift();
      }
      if (p.y < -3) this.respawn(false, true);
    }
    if (this.respawnGrace > 0) this.respawnGrace -= dt;
    this.save.stat('topSpeed', Math.abs(p.speed));

    // ---- world (follows the rider: on the bike, or on foot)
    const pp = this.foot || p;
    this.traffic.update(dt, pp, this.cops.units);
    const offence = p.crashed ? 0 : p.wheelieT > 0.5 ? 1 : (p.frontContact && !p.rearContact && p.pitch < -0.2) ? 0.8 : p.rearLocked ? 0.3 : p.airTime > 0.6 ? 0.5 : 0;
    this.cops.update(dt, { x: pp.x, y: pp.y, z: pp.z, vx: pp.vx, vz: pp.vz, speed: pp.speed, crashed: p.crashed && !this.foot && this.respawnGrace <= 0, offence, emoto: spec.cls === 'emoto' && !this.foot, hitCop: this.hitCop, groundY: this.foot ? this.foot.y : groundY, topSpeed: spec.drive.topSpeed }, this.traffic);

    if (this.noCops) { this.cops.suspicion = 0; if (this.cops.wanted) this.cops.reset(pp.x, pp.z); }

    // ---- effects
    const rx = p.x + hx * p.rsR, rz = p.z + hz * p.rsR, ry = this.terrain.height(rx, rz);
    const sliding = (p.rearLocked || p.slipRear) && p.rearContact && !p.crashed;
    this.effects.skid(rx, ry, rz, sliding && p.surface < 2);
    this.dustT -= dt;
    if (this.dustT <= 0 && !p.crashed) {
      this.dustT = 0.05;
      if (p.rearContact && DUST[p.surface] && Math.abs(p.speed) > 4) this.effects.dust(rx, ry, rz, 1, DUST[p.surface], 0.6);
      if (p.slipRear && p.rearContact && p.surface < 2) this.effects.smoke(rx, ry, rz, p.burning ? 3 : 1);
      if (w.drag > 0.8 && p.wheelieT > 0.2 && Math.abs(p.speed) > 3) this.effects.sparks(rx + hz * 0.34 - hx * 0.25, ry, rz - hx * 0.34 - hz * 0.25, 2, p.vx, p.vz);
      if (this.tricks.zone === 2) { this._v.copy(model.anchors.tail); model.group.localToWorld(this._v); this.effects.sparks(this._v.x, ry, this._v.z, 3, p.vx, p.vz); }
    }

    this._visual(dt, { one: tk[0], no: tk[1], stand: tk[2], drag: tk[3] });
    this.rider.setFirstPerson(this.rig.id === 'first' && !p.crashed);
    if (this.foot) this.rig.foot(dt, this.foot); else this.rig.update(dt, p, model, this.rider);
    this.sky.update(pp.x, pp.y, pp.z);

    // headlight
    if (this.sky.night && !p.crashed) {
      this.lamp.intensity = 220;
      this.lamp.position.set(p.x + hx * 0.8, p.y + 0.5, p.z + hz * 0.8);
      this.lamp.target.position.set(p.x + hx * 14, p.y - 0.8 + Math.sin(p.pitch) * 10, p.z + hz * 14);
      this.lamp.target.updateMatrixWorld();
    } else this.lamp.intensity = 0;

    // ---- audio
    let siren = 0, heli = 0;
    if (this.cops.wanted) for (const u of this.cops.units) {
      const d = Math.hypot(u.x - pp.x, u.z - pp.z);
      if (u.heli) heli = Math.max(heli, 1 - d / 260); else if (u.chasing || u.state === 'block') siren = Math.max(siren, 1 - d / 230);
    }
    this.audio.update(dt, { speed: p.speed, wheelSpeed: p.spinR * spec.rR, topSpeed: spec.drive.topSpeed, throttle: p.effThrottle, electric: spec.drive.type === 'electric', big: spec.variant === 'varg', grounded: p.rearContact || p.frontContact, surface: p.surface, skid: sliding, siren: Math.max(0, siren), heli: Math.max(0, heli), active: !p.crashed });

    // ---- HUD
    const cp = this.cops;
    hud.update(dt, {
      speed: pp.speed, units: st.units, cash: this.save.cash, heat: cp.heat, wanted: cp.wanted, seen: cp.seen, hidden: cp.hidden,
      evade: cp.evadeNeed ? cp.evade / cp.evadeNeed : 0, suspicion: cp.suspicion, watcher: cp.watcher, bust: cp.bust,
      combo: this.tricks.combo, label: this.tricks.label, zone: this.tricks.zone,
      wheelie: { show: !p.crashed && p.rearContact && !p.frontContact && p.pitch > 0.12, pitch: p.pitch, bp: p.balanceAngle(), loop: spec.loopAngle },
    });
    if (this.frameN % 2 === 0) hud.minimap(pp.x, pp.z, pp.yaw, cp.units, cp.wanted);
  }

  // ---- trick switches --------------------------------------------------------
  _tricksOff() {
    if (!this.trickOn.some(Boolean)) return;
    this.trickOn.fill(false); this._trickUI();
  }

  _trickUI() {
    const names = ['ONE-HANDER', 'NO-HANDER', 'SEAT STANDER', 'FOOT DRAG'];
    const btns = document.getElementById('tricks').children, on = [];
    for (let i = 0; i < 4; i++) { btns[i].classList.toggle('lit', this.trickOn[i]); if (this.trickOn[i]) on.push(names[i]); }
    const pill = document.getElementById('trk');
    pill.classList.toggle('hidden', !on.length);
    pill.firstChild.textContent = on.join(' + ') + ' ON';
  }

  // ---- on foot ---------------------------------------------------------------
  _footUI(on) {
    const was = document.body.classList.contains('onfoot');
    if (!on) { this.foot = null; this.nearBike = false; }
    document.body.classList.toggle('onfoot', on);
    document.getElementById('t-reset').textContent = on ? 'CALL BIKE' : 'RESET';
    document.getElementById('t-mount').classList.add('hidden');
    if (!on && was) this.hud.hintEl.classList.remove('show'); // only clear our own walking hints
  }

  // the tumble is over: stand up where you landed
  _getUp() {
    const p = this.phys, r = p.rag;
    this.foot = { x: r.x, y: this.terrain.height(r.x, r.z), z: r.z, yaw: p.yaw, speed: 0, vx: 0, vz: 0, phase: 0, rise: 0, callT: 0 };
    this.rider.beginWalk(this.scene);
    this._footUI(true); this.rig.snap = false;
    this.hud.hint(this.touchOn ? 'Walk back to your bike with the stick and GAS · <b>CALL BIKE</b> brings it to you'
      : 'Walk back to your bike (<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>) · <kbd>R</kbd> brings the bike to you', 6);
  }

  _walk(dt, s, dyn) {
    const f = this.foot, T = this.terrain, p = this.phys, hit = this._hit || (this._hit = { nx: 0, nz: 0 });
    f.rise = Math.min(1, f.rise + dt * 2);
    f.callT = Math.max(0, f.callT - dt);
    const can = f.rise >= 1 ? 1 : 0;
    f.yaw += s.steer * 2.9 * dt * can;
    const want = (s.throttle - s.brake * 0.55) * 4.8 * can;
    f.speed += Math.max(-14 * dt, Math.min(10 * dt, want - f.speed));
    let nx = f.x + Math.sin(f.yaw) * f.speed * dt, nz = f.z + Math.cos(f.yaw) * f.speed * dt;
    if (T.height(nx, nz) - f.y > 0.6) { nx = f.x; nz = f.z; f.speed = 0; } // too tall to step onto
    const push = (o) => {
      if (o.carOnly || o.y1 < f.y + 0.45) return;
      const pen = circleVsObstacle(o, nx, nz, 0.32, hit);
      if (pen > 0) { nx += hit.nx * pen; nz += hit.nz * pen; }
    };
    T.query(nx, nz, 0.6, push);
    for (const o of dyn) push(o);
    f.vx = (nx - f.x) / dt; f.vz = (nz - f.z) / dt; f.x = nx; f.z = nz;
    f.y += (T.height(f.x, f.z) - f.y) * Math.min(1, dt * 12);
    f.phase += Math.abs(f.speed) * dt * 2.7;
    // close enough to pick the bike up?
    const near = Math.hypot(p.x - f.x, p.z - f.z) < 2.8;
    if (near !== this.nearBike) {
      this.nearBike = near;
      document.getElementById('t-mount').classList.toggle('hidden', !near);
      if (near && !this.touchOn) this.hud.hint('Press <kbd>F</kbd> to get on', 600); else if (!near) this.hud.hintEl.classList.remove('show');
    }
  }

  _mount() {
    const f = this.foot, p = this.phys;
    if (!f || Math.hypot(p.x - f.x, p.z - f.z) > 2.8) return;
    const x = p.x, z = p.z, yaw = f.yaw;
    this._footUI(false);
    this.rider.endRagdoll(this.model.group);
    p.reset(x, z, yaw);
    this.respawnGrace = 1; this.rig.snap = false; this.audio.ui();
  }

  // "respawn bike": drops the bike next to you
  _callBike() {
    const f = this.foot, p = this.phys;
    if (!f || f.callT > 0) return;
    f.callT = 1.5;
    p.x = f.x - Math.cos(f.yaw) * 1.3; p.z = f.z + Math.sin(f.yaw) * 1.3;
    p.y = this.terrain.height(p.x, p.z) + 0.3; p.vx = p.vy = p.vz = 0; p.yaw = f.yaw; p.bikeYawVel = 0;
    this.effects.dust(p.x, p.y - 0.3, p.z, 8, [0.8, 0.8, 0.8]);
    this.audio.ui();
  }

  // place the bike + rider meshes from the physics state
  _visual(dt, tr) {
    const p = this.phys, model = this.model, g = model.group, sp = model.spec;
    const hx = Math.sin(p.yaw), hz = Math.cos(p.yaw);
    if (p.crashed) {
      if (!this.foot) this.rider.beginRagdoll(this.scene, g, p, this.terrain);
      g.position.set(p.x - hx * sp.wheelbase * 0.4, p.y - 0.05, p.z - hz * sp.wheelbase * 0.4);
      g.rotation.set(-p.pitch, p.yaw, -p.lean, 'YXZ');
      g.updateMatrixWorld(true);
      poseBike(model, p, dt);
      if (this.foot) this.rider.updateWalk(dt, this.foot); else this.rider.updateRagdoll(dt, p.rag);
      return;
    }
    const r = sp.rR;
    const lean = p.lean + this.rider.w.stop * 0.09;
    const sl = Math.sin(lean), cl = Math.cos(lean);
    let y = p.y + p.ryR - r * (1 - cl);
    if (!model.hasRearSusp) y += Math.min(p.rearPen, sp.susp.tR);
    g.position.set(p.x + hx * p.rsR + hz * r * sl, y, p.z + hz * p.rsR - hx * r * sl);
    g.rotation.set(-p.pitch, p.yaw, -lean, 'YXZ');
    g.updateMatrixWorld(true);
    poseBike(model, p, dt);
    const rx = p.x + hx * p.rsR, rz = p.z + hz * p.rsR;
    this.rider.update(dt, p, model, tr, this.terrain.height(rx + hz * 0.34, rz - hx * 0.34));
  }

  // drop resolution, then shadows, if the frame rate can't keep up
  _adapt(raw) {
    if (this.state !== 'play' || this.save.data.settings.quality !== 'auto') return;
    const f = this.fps; f.t += raw; f.n++;
    if (f.t < 2.5) return;
    const fps = f.n / f.t; f.t = 0; f.n = 0;
    if (fps < 27) f.low++; else f.low = 0;
    if (f.low >= 2) {
      f.low = 0;
      // sharpness comes first: shed shadows before resolution, and never go blurry
      if (this.renderer.shadowMap.enabled && this.sky.sun.castShadow) { this.sky.sun.castShadow = false; }
      else if (this.pr > 1.5) { this.pr = Math.max(1.5, this.pr - 0.25); this.resize(); }
    }
  }
}

window.__game = new Game();
