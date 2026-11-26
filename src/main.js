// Wheelie Works — game bootstrap and main loop.
import * as THREE from 'three';
import { Terrain, circleVsObstacle } from './world/terrain.js';
import { buildCity, CURB } from './world/city.js';
import { buildDesert } from './world/desert.js';
import { Sky, TIMES } from './world/sky.js';
import { Weather } from './world/weather.js';
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
import { Jobs } from './jobs.js';
import { loadBikeModels, applyGlb, drawScreen } from './bikeGlb.js';
import { HELMET_BY_ID, CASE_PRICE, DUPLICATE_REFUND, rollCase, applyHelmet, animateHelmet, buildHelmet, loadHelmetModel, upgradeHelmet } from './helmets.js';
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
    // two maps: the city, or the desert (no traffic, cops, jobs or shops out there)
    this.desert = st.map === 'desert';
    this.city = this.desert ? buildDesert(this.terrain) : buildCity(this.terrain, { quality: this.q.shadows });
    this.scene.add(this.city.group);
    this.sky = new Sky(this.scene, renderer, this.q.shadows);
    this.sky.apply(st.time === 'cycle' ? 'day' : st.time, this.city);
    this.weather = new Weather(this.scene, this.q.shadows);

    this.phys = new BikePhysics(this.terrain);
    this.input = new Input();
    this.rig = new CameraRig(this.camera, this.terrain);
    this.rig.set(st.camera);
    this.rider = new Rider(); this.rider.terrain = this.terrain;
    this.effects = new Effects(this.scene);
    this.audio = new GameAudio(); this.audio.setVolume(st.volume, st.mute);
    this.traffic = new Traffic(this.scene, this.terrain, this.city, this.desert ? 0 : this.q.traffic, this.q.shadows > 1);
    this.cops = new Cops(this.scene, this.terrain);
    if (this.desert) {
      this.traffic.group.visible = false; this.cops.disable();
      document.querySelector('#mapscreen .maplegend').innerHTML = '<span><i style="background:#ffb000"></i>MX park</span><span><i style="background:#ff6a2a"></i>Big Send</span><span><i style="background:#7fd17a"></i>Ridge trail · dirt jumps</span><span><i style="background:#ff4fd8"></i>Waypoint</span>';
      document.querySelector('#loading p').textContent = 'Building the desert…';
    }
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

    this.waypoints = []; this.shop = null; this.shopLock = null;
    this.beacons = [];
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 90, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      b.geometry.translate(0, 45, 0); b.visible = false; this.scene.add(b); this.beacons.push(b);
    }
    this._wire();
    this.setBike(this.save.data.bike, false);
    this._wearHelmet();
    this.jobs = new Jobs(this);
    if (this.desert) this.jobs.disable();
    this.weather.onThunder = (v) => this.audio.thunder(v);
    this.weather.onChange = (kind) => {
      if (this.state !== 'play') return;
      const msg = { rain: 'It\'s starting to rain: wet roads, less grip', thunder: 'Thunderstorm rolling in: wet roads, less grip', storm: 'Storm warning: heavy rain and wind, roads are slippery', fog: 'Fog is rolling in' }[kind];
      if (msg) this.hud.hint(msg, 4);
    };
    // detailed bike models load in the background and replace the built-in look when ready
    // the detailed helmet model replaces the built-in helmet when it arrives
    loadHelmetModel().then((ok) => {
      if (!ok) return;
      upgradeHelmet(this.rider.helm); this._wearHelmet();
      if (this.helmetShow && upgradeHelmet(this.helmetShow)) applyHelmet(this.helmetShow.shell, this.helmetShow.visor, this.helmetShow.def, this.helmetShow.eyes);
    });
    loadBikeModels().then(() => {
      if (this.model) applyGlb(this.model);
      if (this.preview) applyGlb(this.preview);
    });
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
    cops.onOfficer = () => { hud.popup('OFFICER ON FOOT — MOVE!', 0); audio.wanted(); };
    cops.onEscape = (h) => {
      const r = HEAT_REWARD[h];
      save.earn(r); save.stat('escape', h);
      hud.banner('ESCAPED', `Heat ${h} · +${money(r)}`, 'grn', 3); audio.escaped();
    };
    cops.onBusted = (heat, tackled) => {
      const fine = Math.min(save.cash, Math.max(100, Math.round(save.cash * 0.15)));
      save.earn(-fine);
      tricks.crash(); this.jobs.busted();
      hud.banner(tackled ? 'TACKLED' : 'BUSTED', fine ? `${tackled ? 'An officer ran you down · f' : 'F'}ined ${money(fine)}` : 'They let you off with a warning', 'red', 3.2); audio.busted();
      this._startBust(); // cuffed, camera circles, then back to the shop
    };
    this.input.onMode = () => { this._updateControlsMode(); if (this.menus.current === 'title' || this.menus.current === 'pause' || this.menus.current === 'controls') this.menus.refresh(); };
    // move cam: drag on the game view (anywhere the controls aren't) to look around
    const cv = this.renderer.domElement; let lp = null;
    cv.addEventListener('pointerdown', (e) => {
      if (this.state !== 'play' || this.rig.id !== 'move' || lp) return;
      lp = { id: e.pointerId, x: e.clientX, y: e.clientY }; this.rig.dragging = true;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    });
    cv.addEventListener('pointermove', (e) => { if (!lp || e.pointerId !== lp.id) return; this.rig.lookBy(e.clientX - lp.x, e.clientY - lp.y); lp.x = e.clientX; lp.y = e.clientY; });
    const lookEnd = (e) => { if (lp && e.pointerId === lp.id) { lp = null; this.rig.dragging = false; } };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) cv.addEventListener(ev, lookEnd);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    document.getElementById('btn-cam').addEventListener('click', (e) => { this.input.press('camera'); e.currentTarget.blur(); });
    document.getElementById('btn-pause').addEventListener('click', (e) => { this.input.press('pause'); e.currentTarget.blur(); });
    this.renderer.domElement.addEventListener('pointerdown', () => this.audio.start());
    document.getElementById('minimap').addEventListener('click', () => this.input.press('map'));
    document.getElementById('map-close').addEventListener('click', () => this.closeMap());
    document.getElementById('map-clear').addEventListener('click', () => this.clearWaypoints());
    document.getElementById('bigmap').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); this.mapTap(e.clientX - r.left, e.clientY - r.top); });
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
    const v = this.city.spots[this.shop || 'dealer'].view, g = this.preview.group;
    g.position.set(v.x, v.y + this.preview.spec.rR, v.z);
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
  toTitle() { this.jobs.cancel(); this.tricks.bankNow(); this.cops.reset(this.phys.x, this.phys.z); this.respawn(true, true); this.state = 'title'; this.hud.show(false); this.touch.show(false); this.menus.show('title'); }

  // ---- shops: ride into the marker at the dealership or inside the customs garage
  openShop(kind) {
    if (this.state !== 'play') return;
    if (this.cops.wanted) { if (!this._shopWarn) { this._shopWarn = true; this.hud.hint('Lose the cops first — the shops are closed to wanted riders', 3); } return; }
    if (this.jobs.mode && this.jobs.mode !== 'delivery') this.jobs.cancel(); // walking into a shop forfeits a race
    this.shop = kind; this.shopLock = kind; if (this.dash) this.dash.battery = 1; // charged while you browse
    this.tricks.bankNow(); this._tricksOff();
    this.prevState = 'play'; this.state = 'garage';
    this.hud.show(false); this.touch.show(false); this.input.enabled = false;
    this.model.group.visible = false; this.rig.orbit = kind === 'customs' ? 2.6 : 0.4;
    // park the bike so it isn't still rolling when you come back out
    const p = this.phys; if (!p.crashed) { p.vx = p.vz = 0; p.pitchVel = 0; }
    this.audio.ui();
    this.menus.sel = this.save.data.bike;
    if (kind === 'customs' && this.menus.gtab === 'bike') this.menus.gtab = 'perf';
    this.menus.show(kind);
  }

  closeShop() {
    if (this.preview) { this.scene.remove(this.preview.group); this.preview.dispose(); this.preview = null; }
    this.model.group.visible = true; this.rig.snap = true;
    this.shop = null;
    this.previewHelmet(null);
    this.resume();
  }

  // ---- helmets ------------------------------------------------------------------
  _wearHelmet() {
    const h = this.save.data.helmets;
    if (!HELMET_BY_ID[h.on] || !h.owned[h.on]) h.on = 'white';
    applyHelmet(this.rider.helmetMat, this.rider.visorMat, HELMET_BY_ID[h.on], this.rider.helmetEyes);
  }

  equipHelmet(id) {
    const h = this.save.data.helmets;
    if (!h.owned[id] || !HELMET_BY_ID[id]) return false;
    h.on = id; this.save.persist(); this._wearHelmet();
    return true;
  }

  // Buy and open one case. The result is saved straight away, whatever the animation does.
  openCase() {
    const s = this.save, h = s.data.helmets;
    if (s.cash < CASE_PRICE) return null;
    s.data.cash -= CASE_PRICE;
    const helmet = rollCase(), dup = !!h.owned[helmet.id];
    if (dup) s.data.cash += DUPLICATE_REFUND; else h.owned[helmet.id] = true;
    s.persist();
    return { helmet, dup, refund: dup ? DUPLICATE_REFUND : 0 };
  }

  // show a helmet floating above the bike in Customs (null hides it)
  previewHelmet(id) {
    if (!id) { if (this.helmetShow) this.helmetShow.group.visible = false; return; }
    if (!this.helmetShow) { this.helmetShow = buildHelmet(); upgradeHelmet(this.helmetShow); this.helmetShow.group.scale.setScalar(2.1); this.scene.add(this.helmetShow.group); }
    const hs = this.helmetShow;
    hs.def = HELMET_BY_ID[id]; applyHelmet(hs.shell, hs.visor, hs.def, hs.eyes); hs.group.visible = true;
  }

  // ---- full-screen map and waypoints ---------------------------------------------
  openMap() {
    if (this.state !== 'play') return;
    this.state = 'map'; this.input.enabled = false; this.touch.show(false);
    document.getElementById('mapscreen').classList.remove('hidden');
    const note = document.querySelector('#mapscreen .maptitle small');
    if (!this._mapNote) this._mapNote = note.textContent;
    note.textContent = this._mapNote;
    this._drawMap();
  }
  closeMap() { document.getElementById('mapscreen').classList.add('hidden'); this.resume(); }
  _drawMap() {
    const pp = this.foot || this.phys;
    this.hud.bigMap(document.getElementById('bigmap'), pp.x, pp.z, pp.yaw, this.cops.units, this.cops.wanted, this.waypoints);
  }
  // tap the map: remove the waypoint under the finger, otherwise drop a new one
  mapTap(cx, cy) {
    const w = this.hud.bigMapToWorld(cx, cy);
    if (!w) return;
    // a tap on a marker (shop, job, race, sprocket) puts the waypoint exactly on it
    const big = this.hud._big, sp = this.city.spots, ex = this.hud.extra;
    const reach = (22 * Math.max(1, document.getElementById('bigmap').width / 700)) / big.sc; // a bit more than the badge, in metres
    const marks = [...ex.pois, ...(sp.pois || [])];
    if (sp.dealer) marks.push({ x: sp.dealer.x, z: sp.dealer.z, name: 'Dealership' }, { x: sp.customs.x, z: sp.customs.z, name: 'Customs' });
    if (sp.skate) marks.push({ x: sp.skate.x, z: sp.skate.z, name: 'the skate park' });
    if (ex.target) marks.push({ x: ex.target.x, z: ex.target.z, name: 'your job target' });
    let hit = null, best = reach;
    for (const m of marks) { const d = Math.hypot(m.x - w.x, m.z - w.z); if (d < best) { best = d; hit = m; } }
    const note = document.querySelector('#mapscreen .maptitle small');
    if (hit) {
      const at = this.waypoints.findIndex((q) => Math.hypot(q.x - hit.x, q.z - hit.z) < 1);
      if (at >= 0) { this.waypoints.splice(at, 1); note.textContent = `waypoint removed from ${hit.name}`; }
      else { if (this.waypoints.length >= 6) this.waypoints.shift(); this.waypoints.push({ x: hit.x, z: hit.z, r: 4.5 }); note.textContent = `waypoint set on ${hit.name}`; }
    } else {
      const near = this.waypoints.findIndex((q) => Math.hypot(q.x - w.x, q.z - w.z) < 22);
      if (near >= 0) this.waypoints.splice(near, 1);
      else { if (this.waypoints.length >= 6) this.waypoints.shift(); this.waypoints.push(w); }
      note.textContent = this._mapNote;
    }
    this.audio.ui(); this._syncBeacons(); this._drawMap();
  }
  clearWaypoints() { this.waypoints.length = 0; this._syncBeacons(); this._drawMap(); }
  _syncBeacons() {
    this.beacons.forEach((b, i) => {
      const w = this.waypoints[i];
      b.visible = !!w;
      if (w) b.position.set(w.x, this.terrain.height(w.x, w.z), w.z);
    });
    if (!this.waypoints.length) document.getElementById('wpd').classList.add('hidden');
  }

  applySetting(key, val) {
    const st = this.save.data.settings;
    if (val === 'true') val = true; else if (val === 'false') val = false;
    st[key] = val; this.save.persist();
    if (key === 'time' && val !== 'cycle') this.sky.apply(val, this.city);
    else if (key === 'assist') this.inp.assist = val;
    else if (key === 'camera') this.rig.set(val);
    else if (key === 'volume' || key === 'mute') this.audio.setVolume(st.volume, st.mute);
    else if (key === 'controls') this._updateControlsMode();
    else if (key === 'quality' || key === 'map') { try { localStorage.setItem('wheelie-works-save-v2', JSON.stringify(this.save.data)); } catch (e) { /* ignore */ } location.reload(); }
  }

  // returns { ok, msg } for the cheat-code screen
  applyCheat(raw) {
    const code = String(raw || '').trim().toUpperCase(), s = this.save;
    if (!code) return { ok: false, msg: 'Type a code first.' };
    if (code === 'BBV33') { s.earn(25000); return { ok: true, msg: `Cha-ching. +${money(25000)} — you now have ${money(s.cash)}.` }; }
    if (code === 'SPROCKETS') {
      const J = this.jobs, on = J.toggleReveal(), left = J.tokens.length - J.seasonFound();
      return { ok: true, msg: on ? (left ? `The ${left} ${J.season.item}s you still need are marked on the map and minimap. Enter SPROCKETS again to hide them.` : `You have already found every ${J.season.item} this season.`) : `${J.season.item}s are hidden again.` };
    }
    if (code === 'BBV33SPEEDMAX' || code === 'BBV33SPEEDEVENMORE') {
      const level = code === 'BBV33SPEEDMAX' ? 1 : 2;
      this.phys.unlimited = this.phys.unlimited === level ? 0 : level;
      if (!this.phys.unlimited) return { ok: true, msg: 'Speed limit back on.' };
      return { ok: true, msg: `${level === 2 ? 'Even more speed: three times the push of BBV33SPEEDMAX' : 'No speed limit: every bike keeps accelerating as long as you hold the throttle'}. Enter ${code} again to turn it off.` };
    }
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
    if (this.cut) { this.cut = null; if (this.cutCop) this.cutCop.group.visible = false; }
    this._footUI(false); this._tricksOff();
    this.rider.endRagdoll(this.model.group);
    const s = !home && this.safe.length ? this.safe[Math.max(0, this.safe.length - 3)] : null;
    if (s) p.reset(s.x, s.z, s.yaw); else p.reset(h.x, h.z, h.yaw);
    if (home) { this.cops.reset(h.x, h.z); if (this.dash) this.dash.battery = 1; }
    this.rig.snap = true; this.respawnGrace = 1.5;
    if (!quiet) this.audio.ui();
  }

  // ---- the Varg's dash screen: live speed, battery and range -------------------------
  _dash(dt) {
    const sc = this.model.screen; if (!sc) return;
    const p = this.phys, b = this.dash || (this.dash = { battery: 1, use: 0 });
    // the battery drains with the power you use, a little comes back under braking, and it's
    // topped up whenever you respawn at home or visit a shop
    const pull = this.state === 'play' && !p.crashed ? Math.max(0, p.effThrottle) * Math.min(1, Math.abs(p.speed) / 8 + 0.25) : 0;
    b.battery = Math.max(0, Math.min(1, b.battery - pull * dt * 0.0016 + (this.inp.brake > 0.2 && Math.abs(p.speed) > 3 ? dt * 0.0002 : 0)));
    b.use += (pull - b.use) * Math.min(1, dt * 0.2);
    sc.t += dt; if (sc.t < 0.1) return; sc.t = 0; // ten updates a second is plenty for a dash
    const st = this.save.data.settings;
    const mode = this.phys.unlimited ? '\u221E' : ({ 2: '1', 1: '3', 0.5: '4', 0: '5' })[st.assist] || '3';
    drawScreen(sc, { kmh: p.crashed ? 0 : Math.abs(p.speed) * 3.6, mph: st.units === 'mph', battery: b.battery, rangeH: b.battery * 6 * (1 - 0.75 * b.use), mode });
  }

  // ---- busted: a short scene before the respawn ---------------------------------
  _startBust() {
    const p = this.phys, T = this.terrain;
    let x, z, yaw = p.yaw;
    if (this.foot) { x = this.foot.x; z = this.foot.z; yaw = this.foot.yaw; }
    else if (p.crashed) { x = p.rag.x; z = p.rag.z; }
    else { x = p.x - Math.cos(yaw) * 0.85; z = p.z + Math.sin(yaw) * 0.85; p.vx = 0; p.vz = 0; } // step off beside the bike
    this._tricksOff();
    this.rider.setFirstPerson(false);
    this.rider.beginWalk(this.scene);
    const f = { x, y: T.height(x, z), z, yaw, speed: 0, phase: 0, rise: 1, cuffed: true };
    // the arresting officer, a step behind with a hand on your shoulder
    if (!this.cutCop) { this.cutCop = new Rider({ hoodie: 0x1c2d5a, pants: 0x151a2a, shoes: 0x111111, gloves: 0x111111, helmet: 0x1c2d5a, visor: 0x101216, skin: 0xd8a47c, pack: 0x1c2d5a }); this.cutCop.beginWalk(this.scene); }
    const cx = x - Math.sin(yaw) * 0.62 + Math.cos(yaw) * 0.3, cz = z - Math.cos(yaw) * 0.62 - Math.sin(yaw) * 0.3;
    this.cutCop.group.visible = true;
    this.cut = { t: 0, dur: 3.8, f, cop: { x: cx, y: T.height(cx, cz), z: cz, yaw: yaw + 0.25, speed: 0, phase: 0, rise: 1 }, a0: yaw + Math.PI * 0.8 };
    this.touch.show(false);
  }

  _bustScene(dt, st) {
    const c = this.cut, f = c.f, cam = this.camera, input = this.input;
    c.t += dt;
    // nothing to steer: only "skip" is listened for
    const skip = (input.take('confirm') || input.take('reset')) && c.t > 0.7;
    for (const a of ['camera', 'mute', 'time', 'garage', 'map', 'burn', 'mount']) input.take(a);
    this.rider.updateWalk(dt, f); this.cutCop.updateWalk(dt, c.cop);
    // the camera circles once around the pair, pulling in if a wall is in the way
    const ang = c.a0 + c.t * 1.55;
    let d = 4.3, px = f.x + Math.sin(ang) * d, pz = f.z + Math.cos(ang) * d;
    for (let k = 0; k < 5 && this.rig._blocked(px, pz); k++) { d *= 0.78; px = f.x + Math.sin(ang) * d; pz = f.z + Math.cos(ang) * d; }
    cam.position.set(px, Math.max(f.y + 1.75, this.terrain.height(px, pz) + 0.5), pz);
    cam.lookAt(f.x, f.y + 1.15, f.z);
    if (Math.abs(cam.fov - 48) > 0.05) { cam.fov += (48 - cam.fov) * Math.min(1, dt * 5); cam.updateProjectionMatrix(); }
    // the world carries on, and the cruisers that caught you sit there with their lights going
    this.traffic.update(dt, f, this.cops.units);
    const on = Math.floor(this.time * 6) % 2 === 0;
    for (const u of this.cops.units) if (u.car && Math.hypot(u.x - f.x, u.z - f.z) < 70) { u.mesh.red.visible = on; u.mesh.blue.visible = !on; }
    this.sky.update(f.x, f.y, f.z);
    this.lamp.intensity = 0;
    const spec = this.model.spec, cp = this.cops;
    this.audio.update(dt, { speed: 0, wheelSpeed: 0, topSpeed: spec.drive.topSpeed, throttle: 0, electric: spec.drive.type === 'electric', big: spec.variant === 'varg', grounded: true, surface: 0, skid: false, siren: 0.55, heli: 0, active: false });
    this.hud.update(dt, { speed: 0, units: st.units, cash: this.save.cash, heat: 0, wanted: false, seen: false, hidden: false, evade: 0, suspicion: 0, watcher: null, bust: 0,
      combo: this.tricks.combo, label: this.tricks.label, zone: 0, wheelie: { show: false, pitch: 0, bp: 1, loop: spec.loopAngle } });
    if (c.t >= c.dur || skip) { for (const u of cp.units) if (u.car) { u.mesh.red.visible = false; u.mesh.blue.visible = false; } this.respawn(true); this._updateControlsMode(); }
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
      if (this.state === 'map') { if (this.input.take('pause') || this.input.take('map')) this.closeMap(); else if (this.frameN % 6 === 0) { this.hud._blink += 0.1; this._drawMap(); } }
      if (this.input.take('pause') || this.input.take('confirm')) { if (this.state === 'pause') this.resume(); else if (this.state === 'title' && this.menus.current === 'title') this.startRide(); }
      this.input.queue.length = 0;
      if (this.state !== 'pause' && this.state !== 'map') {
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
    // the day/night cycle and the weather (frozen while paused)
    if (this.state !== 'pause') {
      const wx = this.weather;
      wx.update(dt, this.camera.position, { cycle: st.time === 'cycle', dynamic: st.weather !== 'clear' });
      const pal = wx.palette(st.time === 'cycle' ? null : TIMES[st.time] || TIMES.day);
      this.sky.applyPalette(pal, this.city, pal.night);
      this.phys.gripMul = wx.grip;
      const el = this.hud.wxEl, txt = `${st.time === 'cycle' ? wx.clock + ' · ' : ''}${wx.label}`;
      if (el && el.textContent !== txt) el.textContent = txt;
      this.audio.weather(wx.mix.rain, wx.mix.wind);
    }
    this.model.animate(this.time, this.phys.crashed ? 0 : this.phys.speed);
    this._dash(dt);
    if (this.preview) this.preview.animate(this.time, 0);
    animateHelmet(this.rider.helmetMat, HELMET_BY_ID[this.save.data.helmets.on], this.time, this.rider.helmetEyes);
    if (this.helmetShow && this.helmetShow.group.visible) {
      // the helmet on display in Customs turns slowly above the bike
      const hs = this.helmetShow, v = this.city.spots.customs.view;
      hs.group.position.set(v.x, v.y + 1.55 + Math.sin(this.time * 1.6) * 0.04, v.z);
      hs.group.rotation.y = this.time * 0.9;
      animateHelmet(hs.shell, hs.def, this.time, hs.eyes);
    }
    this.effects.update(dt);
    if (!this.skipRender) this.renderer.render(this.scene, this.camera);
    this._adapt(raw);
  }

  _play(dt, s, st) {
    const p = this.phys, inp = this.inp, input = this.input, model = this.model, spec = model.spec, hud = this.hud;

    // ---- one-shot actions
    if (input.take('pause')) { this.pause(); return; }
    if (this.cut) { this._bustScene(dt, st); return; }
    if (input.take('camera')) { const m = this.rig.next(); st.camera = m.id; this.save.persist(); hud.camName(m.label); if (m.id === 'move') hud.hint(this.touchOn ? 'Move cam: drag anywhere on the screen to look around' : 'Move cam: hold the mouse button and drag to look around · right stick on a gamepad', 4); }
    if (s.look) this.rig.lookBy(s.look * dt * 420, 0);
    if (input.take('mute')) { this.applySetting('mute', !st.mute); hud.camName(st.mute ? 'Sound off' : 'Sound on'); }
    if (input.take('time')) { const k = ['cycle', ...Object.keys(TIMES)]; const n = k[(k.indexOf(st.time) + 1) % k.length]; this.applySetting('time', n); hud.camName(n === 'cycle' ? 'Day/night cycle' : TIMES[n].label); }
    if (input.take('garage')) hud.hint(this.desert ? 'The <b>Dealership</b> and <b>Customs</b> are in the city — switch maps from the pause menu' : 'Ride to the <b>Dealership</b> or the <b>Customs</b> garage by the spawn — they are on the map', 4);
    if (input.take('map')) { this.openMap(); return; }
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
    if (input.take('confirm')) this.jobs.confirm();

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
    // ...they stay on after a wheelie or jump ends, until you switch them off or crash
    if (p.crashed) this._tricksOff();

    inp.throttle = s.throttle; inp.brake = s.brake; inp.steer = s.steer; inp.lean = s.lean; inp.hop = s.hop; inp.assist = st.assist; inp.rearOnly = false;
    let frontLever = s.stoppie;
    // what your hands and feet are doing limits what you can control
    if (w.no > 0.5) {
      // no hands on the bars: no throttle grip, no brake levers, no pulling, body-lean steering only
      if (spec.drive.type === 'electric') inp.throttle = 0;
      // with the foot brake kit the rear brake still works, from the pedal
      if (spec.footBrake) inp.rearOnly = true; else inp.brake = 0;
      frontLever = false; inp.hop = false; inp.steer *= 0.35;
      if (inp.lean > 0) inp.lean = 0;
    } else if (w.one > 0.5) {
      // one hand: you can't hop, but throwing your weight back still pops a wheelie
      inp.hop = false;
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
    // held on the line during a race countdown
    if (this.jobs.locked) { inp.throttle = 0; inp.brake = 0.4; inp.steer = 0; inp.hop = false; inp.lean = 0; inp.stoppie = false; inp.burnout = false; if (!p.crashed) { p.vx = 0; p.vz = 0; } }
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
        this.audio.crash(); this.rig.kick(1); this.tricks.crash(); this.jobs.crashed();
        if (e.cop) this.hitCop = true; else if (e.ref) this.traffic.bumped(e.ref);
        this.effects.sparks(p.x, groundY + 0.3, p.z, 16, p.vx, p.vz); this.effects.dust(p.x, groundY, p.z, 8, [0.6, 0.6, 0.6]);
        const msg = { loopout: 'LOOPED OUT', endo: 'OVER THE BARS', hit: 'WRECKED', slam: 'SLAMMED', sideways: 'HIGH-SIDED', slide: 'LOW-SIDED' }[e.reason] || 'CRASHED';
        hud.banner(msg, '', 'yel', 2);
      }
    }
    const sm = st.assist === 0 ? 1.4 : st.assist === 0.5 ? 1.2 : st.assist === 2 ? 0.6 : 1;
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
    this.cops.update(dt, { x: pp.x, y: pp.y, z: pp.z, vx: pp.vx, vz: pp.vz, speed: pp.speed, crashed: p.crashed && !this.foot && this.respawnGrace <= 0, offence, emoto: spec.cls === 'emoto' && !this.foot, hitCop: this.hitCop, groundY: this.foot ? this.foot.y : groundY, topSpeed: spec.drive.topSpeed, onFoot: !!this.foot }, this.traffic);

    if (this.jobs.sanctioned && !this.cops.wanted) this.cops.suspicion = 0; // races are run with the city's blessing
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
      // the free hand scraping the tarmac
      if (Math.abs(p.speed) > 3) for (let i = 0; i < 2; i++) if (this.rider.handContacts[i]) { const hw = this.rider.handWorlds[i]; this.effects.sparks(hw.x, hw.y - 0.04, hw.z, 2, p.vx, p.vz); }
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
      wheelie: { show: !p.crashed && p.rearContact && !p.frontContact && p.pitch - p.groundPitch > 0.12, pitch: p.pitch, bp: p.balanceAngle(), loop: spec.loopAngle },
    });
    if (this.frameN % 2 === 0) hud.minimap(pp.x, pp.z, pp.yaw, cp.units, cp.wanted, this.waypoints);
    this._world(dt, pp);
  }

  // shop markers, the garage door, shop entry and waypoint arrival
  _world(dt, pp) {
    const sp = this.city.spots, t = this.time || 0;
    this.jobs.update(dt, pp, this.phys, !!this.foot);
    for (const k of ['dealer', 'customs']) {
      const z = sp[k]; if (!z) continue;
      const d = Math.hypot(pp.x - z.x, pp.z - z.z);
      z.marker.rotation.y = t * 0.8; z.marker.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
      if (this.shopLock === k) { if (d > z.r + 2.5) this.shopLock = null; }
      else if (d < z.r && Math.abs(pp.speed) < 7 && !this.phys.airTime) this.openShop(k);
    }
    if (!this.cops.wanted) this._shopWarn = false;
    // the customs door rolls up when you get close
    const c = sp.customs;
    if (c) {
      const near = Math.hypot(pp.x - c.doorX, pp.z - c.doorZ) < 17 || Math.hypot(pp.x - c.x, pp.z - c.z) < 12;
      this.doorOpen = Math.max(0, Math.min(1, (this.doorOpen || 0) + (near ? dt * 1.8 : -dt * 1.2)));
      c.door.position.y = c.doorY + this.doorOpen * (c.doorH - 0.25);
    }
    // waypoints: distance readout, and tick them off on arrival
    if (this.waypoints.length) {
      const w = this.waypoints[0], d = Math.hypot(pp.x - w.x, pp.z - w.z), el = document.getElementById('wpd');
      if (d < (w.r || 9)) { this.waypoints.shift(); this._syncBeacons(); this.hud.popup('WAYPOINT REACHED', 0); this.audio.trick(); }
      else { const txt = `WAYPOINT ${Math.round(this.save.data.settings.units === 'mph' ? d * 3.281 : d)} ${this.save.data.settings.units === 'mph' ? 'FT' : 'M'}`; if (el.textContent !== txt) el.textContent = txt; el.classList.remove('hidden'); }
      for (const b of this.beacons) if (b.visible) b.material.opacity = 0.26 + Math.sin(t * 4) * 0.08;
    }
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
