// Title, pause, garage (bikes you own), dealership, customs, settings, challenges and controls screens.
import { BIKES, BIKE_BY_ID, MODS, MOD_BY_ID, SUSP_TUNES, PAINT_PARTS, WRAPS, LED_MODES, FLAGS, PRICES, effectiveSpec, statBars, perfStats, modFits, modName, modInfo, modPrice, modState, lookOf, newEntry } from '../bikes.js';
import { CHALLENGES } from '../progress.js';
import { HELMETS, RARITY, CASE_PRICE, DUPLICATE_REFUND, HELMET_MODEL_CREDIT } from '../helmets.js';
import { RACES, MEDALS, FOOD, clock, medalCash } from '../jobs.js';
import { GLB_BIKES } from '../bikeGlb.js';
import { TIMES } from '../world/sky.js';
import { CAM_MODES } from '../camera.js';
import { DEVICE_LABEL } from '../device.js';
import { money } from './hud.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
// h, s, v in 0..1 -> 0xRRGGBB
function hsv(h, s, v) {
  const f = (n) => { const k = (n + h * 6) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}
const SWATCHES = [0x15171c, 0xf2f2f2, 0xd42a2a, 0xf07a1a, 0xffd21f, 0xb4e61e, 0x1fa64a, 0x3fd1a4, 0x1c6cf2, 0x7a3fd1, 0xf0388c, 0x8c8f94];
const pct = (v) => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';

export class Menus {
  constructor(game) {
    this.game = game; this.root = document.getElementById('screens');
    this.current = null; this.parent = 'title'; this.sel = game.save.data.bike;
    this.gtab = 'bike'; this.target = 'all'; this.color = 0x7a3fd1; this.hsv = [0.74, 0.7, 0.82];
    this.pick = { wrap: null, led: 'solid', flag: 'checkered' };
    // colour sliders and the plate text update the preview live, without re-rendering
    this.root.addEventListener('input', (e) => {
      const id = e.target.id;
      if (id === 'c-h' || id === 'c-s' || id === 'c-v') {
        this.hsv = ['c-h', 'c-s', 'c-v'].map((k) => +this.root.querySelector('#' + k).value / 100);
        this.color = hsv(this.hsv[0], this.hsv[1], this.hsv[2]);
        this._paintPicker();
        this.game.previewLook(this._pending());
      } else if (id === 'plate-text') this.game.previewLook(this._pending());
    });
    this.root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'cheat-code') { e.preventDefault(); this.game.audio.start(); this._act('cheat'); } });
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || b.disabled) return;
      this.game.audio.start();
      this._act(b.dataset.a, b.dataset.v, b);
    });
  }

  show(name) {
    if (name === 'title' || name === 'pause') this.parent = name;
    this.current = name;
    const html = name ? this['_' + name]() : '';
    this.root.innerHTML = html;
    if (name === 'dealer') this.game.previewBike(this.sel);
    if (name === 'customs') {
      this.sel = this.game.save.data.bike; this.game.previewBike(this.sel);
      if (this.gtab === 'look') this.game.previewLook(this._pending());
      this.game.previewHelmet(this.gtab === 'helm' ? this.helmSel || this.game.save.data.helmets.on : null);
    }
    if (name === 'cheats' && this.game.device.type === 'desktop') { const i = this.root.querySelector('#cheat-code'); if (i) i.focus(); }
  }

  hide() { this.current = null; this.root.innerHTML = ''; }
  // re-render the current screen, keeping every scroll position
  refresh() {
    if (!this.current) return;
    const tops = [...this.root.querySelectorAll('.scroll')].map((e) => e.scrollTop);
    this.show(this.current);
    this.root.querySelectorAll('.scroll').forEach((e, i) => { e.scrollTop = tops[i] || 0; });
  }

  _act(a, v) {
    const g = this.game, au = g.audio, s = g.save;
    switch (a) {
      case 'ride': au.ui(); g.startRide(); break;
      case 'map': au.ui(); g.applySetting('map', g.desert ? 'city' : 'desert'); break;
      case 'resume': au.ui(); g.resume(); break;
      case 'go': au.ui(); this.show(v); break;
      case 'back': au.ui(); if (this.current === 'dealer' || this.current === 'customs') g.closeShop(); else this.show(this.parent); break;
      case 'quit': au.ui(); g.toTitle(); break;
      case 'abandon': au.ui(); g.jobs.abandon(); g.resume(); break;
      case 'sel': au.ui(); this.sel = v; if (!s.owns(v)) this.gtab = 'bike'; this.refresh(); break;
      case 'buy': if (g.buyBike(v)) { au.bank(true); this.sel = v; } else au.deny(); this.refresh(); break;
      case 'use': au.ui(); g.selectBike(v); this.refresh(); break;
      case 'spawn': {
        if (!g.spawnBike(v)) { au.deny(); break; }
        au.bank(false);
        if (this.parent === 'pause') { g.resume(); g.hud.toast('GARAGE', BIKE_BY_ID[v].name, 'Spawned right here'); } else this.refresh();
        break;
      }
      case 'gtab': au.ui(); this.gtab = v; this.refresh(); break;
      case 'helm': au.ui(); this.helmSel = v; g.equipHelmet(v); this.refresh(); break;
      case 'case': {
        if (this._spinning) break;
        const res = g.openCase();
        if (!res) { au.deny(); break; }
        this._case = res; this._spinning = true; this.refresh();
        // the result is already saved; this is just the drum roll
        const t0 = performance.now();
        const spin = () => {
          const el = this.root.querySelector('#reel'), e = (performance.now() - t0) / 2300;
          if (el && this._case === res && e < 1) {
            const h = HELMETS[Math.floor(Math.random() * HELMETS.length)];
            el.textContent = h.rarity === 'ghost' ? '? ? ?' : h.name; el.style.color = RARITY[h.rarity].color;
            g.previewHelmet(h.id);
            au.ui(); setTimeout(spin, 60 + e * e * 280);
          } else {
            // also lands here if you walked away from the tab mid-spin
            this._spinning = false; res.done = true; this.helmSel = res.helmet.id;
            if (!res.dup) g.equipHelmet(res.helmet.id);
            if (el) { au.bank(res.helmet.rarity !== 'common'); this.refresh(); }
          }
        };
        spin();
        break;
      }
      case 'mod': {
        const e = s.entry(this.sel), st = e ? modState(e, MOD_BY_ID[v]) : 'locked';
        if (st === 'buy') { if (g.buyMod(this.sel, v)) au.bank(false); else au.deny(); }
        else if (st === 'on' || st === 'off') { g.toggleMod(this.sel, v); au.ui(); }
        else au.deny();
        this.refresh(); break;
      }
      case 'susp': au.ui(); g.setSusp(this.sel, v); this.refresh(); break;
      case 'target': au.ui(); this.target = v; this._syncPick(); this.refresh(); break;
      case 'sw': { au.ui(); this._setColor(+v); this.refresh(); break; }
      case 'pickwrap': au.ui(); this.pick.wrap = v || null; this.refresh(); break;
      case 'pickled': au.ui(); this.pick.led = v; this.refresh(); break;
      case 'pickflag': au.ui(); this.pick.flag = v || null; this.refresh(); break;
      case 'apply': {
        const t = this.target, id = this.sel;
        let ok;
        if (t === 'wrap') ok = g.buyWrap(id, this.pick.wrap, this.color);
        else if (t === 'leds') ok = g.buyLeds(id, this.pick.led, this.color);
        else if (t === 'flag') ok = g.buyFlag(id, this.pick.flag);
        else if (t === 'plate') { const i = this.root.querySelector('#plate-text'); ok = g.buyPlate(id, i ? i.value : ''); }
        else ok = g.buyPaint(id, t, this.color);
        if (ok) au.bank(false); else au.deny();
        this.refresh(); break;
      }
      case 'lookreset': {
        const t = this.target, id = this.sel;
        au.ui();
        if (t === 'wrap') { this.pick.wrap = null; g.buyWrap(id, null); }
        else if (t === 'leds') { this.pick.led = 'off'; if (s.entry(id).look.leds.owned) g.buyLeds(id, 'off', this.color); }
        else if (t === 'flag') { this.pick.flag = null; g.buyFlag(id, null); }
        else if (t === 'plate') g.buyPlate(id, '');
        else g.buyPaint(id, t, null);
        this.refresh(); break;
      }
      case 'set': { au.ui(); const [k, val] = v.split(':'); g.applySetting(k, isNaN(+val) || val === '' ? val : +val); this.refresh(); break; }
      case 'wipe': if (this._wipe) { this._wipe = false; g.wipeSave(); } else { this._wipe = true; au.deny(); this.refresh(); setTimeout(() => { if (this._wipe) { this._wipe = false; if (this.current === 'settings') this.refresh(); } }, 4000); } break;
      case 'cheat': {
        const inp = this.root.querySelector('#cheat-code');
        const r = g.applyCheat(inp ? inp.value : '');
        if (r.ok) au.bank(true); else au.deny();
        this._cheatMsg = r; this.show('cheats');
        break;
      }
      default: break;
    }
  }

  // ---- screens --------------------------------------------------------
  _menu(title) {
    const g = this.game, pause = title === 'pause';
    const dev = DEVICE_LABEL[g.device.type];
    const how = g.input.mode === 'touch' ? 'touch controls' : g.input.mode === 'gamepad' ? 'gamepad' : 'keyboard';
    return `<div class="screen"><div class="col">
      <div class="logo">${pause ? 'PAUSED' : 'WHEELIE<span>WORKS</span>'}</div>
      <div class="tag">${pause ? 'Take a breather.' : 'Wheelies. Tricks. Traffic. Trouble.'}</div>
      <div class="menu">
        <button class="btn primary" data-a="${pause ? 'resume' : 'ride'}">${pause ? 'RESUME' : 'RIDE'}</button>
        ${pause && g.jobs.mode ? `<button class="btn" data-a="abandon">${g.jobs.mode === 'delivery' ? 'ABANDON DELIVERY' : g.jobs.mode === 'wheelie' ? 'QUIT WHEELIE RUN' : 'QUIT RACE'}</button>` : ''}
        <button class="btn" data-a="map">MAP <small>${g.desert ? 'DESERT · tap for the city' : 'CITY · tap for the desert'}</small></button>
        <button class="btn" data-a="go" data-v="garage">GARAGE <small>${Object.keys(g.save.data.owned).filter((id) => BIKE_BY_ID[id]).length}/${BIKES.length} BIKES</small></button>
        <button class="btn" data-a="go" data-v="events">SEASON &amp; RACES <small>${g.jobs.seasonFound()}/${g.jobs.tokens.length}</small></button>
        <button class="btn" data-a="go" data-v="challenges">CHALLENGES <small>${Object.keys(g.save.data.done).length}/${CHALLENGES.length}</small></button>
        <button class="btn" data-a="go" data-v="controls">HOW TO RIDE</button>
        <button class="btn" data-a="go" data-v="settings">SETTINGS</button>
        <button class="btn" data-a="go" data-v="cheats">CODES</button>
        ${pause ? '<button class="btn" data-a="quit">QUIT TO TITLE</button>' : ''}
      </div>
      <div class="foot">Playing on <b>${dev}</b> with <b>${how}</b>${g.device.type === 'desktop' ? ' · gamepads work too' : ''}</div>
    </div></div>`;
  }
  _title() { return this._menu('title'); }
  _pause() { return this._menu('pause'); }

  // ---- garage helpers -----------------------------------------------------
  _setColor(c) {
    this.color = c;
    const r = (c >> 16) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    this.hsv = [h / 6, mx ? d / mx : 0, mx];
  }

  // when a target is opened, start from what the bike has now
  _syncPick() {
    const e = this.game.save.entry(this.sel); if (!e) return;
    const l = e.look, t = this.target;
    if (t === 'wrap') { this.pick.wrap = l.wrap ? l.wrap.id : this.pick.wrap || 'galaxy'; if (l.wrap && l.wrap.color != null) this._setColor(l.wrap.color); }
    else if (t === 'leds') { this.pick.led = l.leds.owned && l.leds.mode !== 'off' ? l.leds.mode : 'solid'; if (l.leds.owned) this._setColor(l.leds.color); }
    else if (t === 'flag') this.pick.flag = l.flag.id || 'checkered';
    else if (t !== 'plate' && t !== 'all' && l.colors[t] != null) this._setColor(l.colors[t]);
  }

  // the saved look with the unsaved choice on screen laid over it
  _pending() {
    const e = this.game.save.entry(this.sel) || newEntry(), look = lookOf(e), t = this.target;
    const out = { colors: { ...look.colors }, wrap: look.wrap, leds: look.leds, flag: look.flag, plate: look.plate };
    if (t === 'wrap') out.wrap = this.pick.wrap ? { id: this.pick.wrap, color: this.color } : null;
    else if (t === 'leds') out.leds = { mode: this.pick.led, color: this.color };
    else if (t === 'flag') out.flag = this.pick.flag;
    else if (t === 'plate') { const i = this.root.querySelector('#plate-text'); out.plate = i ? i.value.toUpperCase().replace(/[^A-Z0-9 \-]/g, '').slice(0, 10) : look.plate; }
    else if (t === 'all') { out.wrap = null; for (const p of PAINT_PARTS) out.colors[p.id] = this.color; }
    else { out.colors[t] = this.color; if (t === 'frame' || t === 'plastics') out.wrap = null; }
    return out;
  }

  _paintPicker() {
    const sw = this.root.querySelector('#c-sw'), hx = this.root.querySelector('#c-hex');
    if (sw) sw.style.background = hex(this.color);
    if (hx) hx.textContent = hex(this.color).toUpperCase();
    const sS = this.root.querySelector('#c-s'), sV = this.root.querySelector('#c-v');
    if (sS) sS.style.background = `linear-gradient(90deg, ${hex(hsv(this.hsv[0], 0, this.hsv[2]))}, ${hex(hsv(this.hsv[0], 1, this.hsv[2]))})`;
    if (sV) sV.style.background = `linear-gradient(90deg, #000, ${hex(hsv(this.hsv[0], this.hsv[1], 1))})`;
  }

  _picker() {
    const [h, sa, v] = this.hsv;
    return `<div class="picker">
      <div class="prow"><span id="c-sw" class="csw" style="background:${hex(this.color)}"></span><span id="c-hex" class="chex">${hex(this.color).toUpperCase()}</span>
        <div class="sws">${SWATCHES.map((c) => `<button data-a="sw" data-v="${c}" style="background:${hex(c)}" aria-label="colour"></button>`).join('')}</div></div>
      <label>Hue<input id="c-h" class="rng hue" type="range" min="0" max="100" value="${Math.round(h * 100)}"></label>
      <label>Colour<input id="c-s" class="rng" type="range" min="0" max="100" value="${Math.round(sa * 100)}" style="background:linear-gradient(90deg, ${hex(hsv(h, 0, v))}, ${hex(hsv(h, 1, v))})"></label>
      <label>Bright<input id="c-v" class="rng" type="range" min="0" max="100" value="${Math.round(v * 100)}" style="background:linear-gradient(90deg, #000, ${hex(hsv(h, sa, 1))})"></label>
    </div>`;
  }

  _perfTab(bike, entry) {
    const s = this.game.save, st = perfStats(bike, entry), mph = s.data.settings.units === 'mph';
    const sp = (v) => Math.round(v * (mph ? 2.237 : 3.6)), unit = mph ? 'MPH' : 'KM/H';
    const fx = (m) => [m.top ? `${pct(m.top)} top speed` : '', m.launch ? `${pct(m.launch)} launch` : '', m.mass ? `${pct(m.mass)} weight` : '', m.brake ? `${pct(m.brake)} braking` : '', m.grip ? `${pct(m.grip)} grip` : ''].filter(Boolean).join(' · ');
    const cards = MODS.filter((m) => modFits(bike, m)).map((m) => {
      const state = modState(entry, m), price = modPrice(bike, m);
      let btn;
      if (state === 'on') btn = `<button class="mbtn off" data-a="mod" data-v="${m.id}">UNEQUIP</button>`;
      else if (state === 'off') btn = `<button class="mbtn" data-a="mod" data-v="${m.id}">EQUIP</button>`;
      else if (state === 'buy') btn = `<button class="mbtn" data-a="mod" data-v="${m.id}" ${s.cash < price ? 'disabled' : ''}>INSTALL · ${money(price)}</button>`;
      else btn = `<button class="mbtn" disabled>NEEDS ${m.needs.filter((n) => !entry.mods[n]).map((n) => modName(bike, MOD_BY_ID[n]).toUpperCase()).join(' + ')}</button>`;
      const tag = state === 'on' ? '<span class="tag2 on">EQUIPPED</span>' : state === 'off' ? '<span class="tag2">INSTALLED</span>' : `<span class="tag2 price">${money(price)}</span>`;
      return `<div class="mod ${state}"><div class="mh"><span class="mn">${modName(bike, m)}</span>${tag}</div><div class="mi">${modInfo(bike, m)}${fx(m) ? ` · <b>${fx(m)}</b>` : ''}</div>${btn}</div>`;
    }).join('');
    const tunes = SUSP_TUNES.map((t) => `<button class="${(entry.susp || 'street') === t.id ? 'on' : ''}" data-a="susp" data-v="${t.id}">${t.name}</button>`).join('');
    const tune = SUSP_TUNES.find((t) => t.id === (entry.susp || 'street'));
    return `<div class="pstats">
        <div><b>${sp(st.top)} ${unit}</b><span>TOP SPEED · STOCK ${sp(st.stockTop)}</span></div>
        <div><b>${pct(st.launch)}</b><span>LAUNCH · VS STOCK</span></div>
        <div><b>${st.weight.toFixed(1)} KG</b><span>WEIGHT · STOCK ${st.stockWeight.toFixed(1)}</span></div>
      </div>
      <div class="mod on"><div class="mh"><span class="mn">Suspension Tune</span><span class="tag2 on">${tune.name.toUpperCase()}</span></div><div class="mi">${tune.desc} · free to change</div><div class="seg wide">${tunes}</div></div>
      ${cards}`;
  }

  _lookTab(bike, entry) {
    const g = this.game, s = g.save, l = entry.look, t = this.target;
    const slots = g.preview && g.previewId === bike.id ? g.preview.slots : PAINT_PARTS.map((p) => p.id);
    const chip = (id, name, mark) => `<button class="chip ${t === id ? 'on' : ''} ${mark ? 'has' : ''}" data-a="target" data-v="${id}">${name}</button>`;
    const parts = PAINT_PARTS.filter((p) => slots.includes(p.id));
    if (t !== 'all' && !['wrap', 'leds', 'flag', 'plate'].includes(t) && !slots.includes(t)) this.target = 'all';
    const paintChips = chip('all', 'Paint all') + parts.map((p) => chip(p.id, p.name, l.colors[p.id] != null)).join('');
    const extraChips = chip('wrap', 'Wrap', !!l.wrap) + chip('leds', 'Wheel LEDs', l.leds.owned && l.leds.mode !== 'off') + chip('flag', 'Flag pole', !!l.flag.id) + chip('plate', 'Name plate', !!l.plate.text);
    const can = (price) => s.cash >= price;
    const buyBtn = (label, price) => `<button class="cta" data-a="apply" ${price && !can(price) ? 'disabled' : ''}>${price ? `${label} · ${money(price)}` : label}</button>`;
    const resetBtn = (label) => `<button class="cta ghost small" data-a="lookreset">${label}</button>`;
    let body;
    const tt = this.target;
    if (tt === 'wrap') {
      const chips = `<button class="chip ${!this.pick.wrap ? 'on' : ''}" data-a="pickwrap" data-v="">None</button>` + WRAPS.map((w) => `<button class="chip ${this.pick.wrap === w.id ? 'on' : ''} ${l.wraps[w.id] ? 'has' : ''}" data-a="pickwrap" data-v="${w.id}">${w.name}</button>`).join('');
      const owned = this.pick.wrap && l.wraps[this.pick.wrap];
      body = `<div class="sec">Pattern — covers the frame and plastics</div><div class="chips">${chips}</div>${this.pick.wrap ? this._picker() : ''}
        <div class="arow">${this.pick.wrap ? buyBtn(owned ? 'APPLY WRAP' : 'BUY WRAP', owned ? 0 : PRICES.wrap) : buyBtn('REMOVE WRAP', 0)}${l.wrap ? resetBtn('REMOVE') : ''}</div>`;
    } else if (tt === 'leds') {
      const chips = LED_MODES.map((m) => `<button class="chip ${this.pick.led === m.id ? 'on' : ''}" data-a="pickled" data-v="${m.id}">${m.name}</button>`).join('');
      body = `<div class="sec">Glowing rings on both wheels</div><div class="chips">${chips}</div>${this.pick.led === 'solid' || this.pick.led === 'pulse' ? this._picker() : ''}
        <div class="arow">${buyBtn(l.leds.owned ? 'APPLY' : 'BUY WHEEL LEDS', l.leds.owned ? 0 : PRICES.leds)}</div>`;
    } else if (tt === 'flag') {
      const chips = `<button class="chip ${!this.pick.flag ? 'on' : ''}" data-a="pickflag" data-v="">None</button>` + FLAGS.map((f) => `<button class="chip ${this.pick.flag === f.id ? 'on' : ''}" data-a="pickflag" data-v="${f.id}">${f.name}</button>`).join('');
      body = `<div class="sec">A flag on a pole behind the seat</div><div class="chips">${chips}</div>
        <div class="arow">${buyBtn(l.flag.owned || !this.pick.flag ? 'APPLY' : 'BUY FLAG POLE', l.flag.owned || !this.pick.flag ? 0 : PRICES.flag)}</div>`;
    } else if (tt === 'plate') {
      body = `<div class="sec">Your name on a plate at the back (10 letters)</div>
        <div class="cheat"><input id="plate-text" type="text" maxlength="10" placeholder="YOUR NAME" value="${l.plate.text || ''}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false"></div>
        <div class="arow">${buyBtn(l.plate.owned ? 'SAVE PLATE' : 'BUY NAME PLATE', l.plate.owned ? 0 : PRICES.plate)}${l.plate.text ? resetBtn('REMOVE') : ''}</div>`;
    } else {
      const all = tt === 'all', name = all ? 'the whole bike' : parts.find((p) => p.id === tt).name.toLowerCase();
      const custom = all ? Object.keys(l.colors).length > 0 : l.colors[tt] != null;
      body = `<div class="sec">Pick a colour for ${name}</div>${this._picker()}
        <div class="arow">${buyBtn(all ? 'PAINT ALL' : 'APPLY', all ? PRICES.paintAll : PRICES.paint)}${custom ? resetBtn('STOCK') : ''}</div>
        ${l.wrap && (all || tt === 'frame' || tt === 'plastics') ? '<div class="mi">The wrap covers frame and plastics paint. Remove the wrap to see it.</div>' : ''}`;
    }
    return `<div class="sec">Paint</div><div class="chips">${paintChips}</div><div class="sec">Extras</div><div class="chips">${extraChips}</div>${body}`;
  }

  // ---- dealership: browse, buy and pick your ride
  _dealer() {
    const g = this.game, s = g.save, id = this.sel, bike = BIKE_BY_ID[id];
    const owned = s.owns(id), entry = s.entry(id) || newEntry();
    const spec = effectiveSpec(bike, entry), bars = statBars(spec);
    const top = Math.round(spec.drive.topSpeed * (s.data.settings.units === 'mph' ? 2.237 : 3.6));
    const list = BIKES.map((b) => {
      const o = s.owns(b.id), riding = s.data.bike === b.id;
      return `<button class="bike ${b.id === id ? 'sel' : ''} ${riding ? 'riding' : ''} ${o ? '' : 'locked'}" data-a="sel" data-v="${b.id}">
        <div class="n">${b.name}</div><div class="p">${riding ? 'RIDING' : o ? 'OWNED' : money(b.price)}</div></button>`;
    }).join('');
    const stat = (n, v) => `<div class="stat"><span>${n}</span><div class="bar"><b style="width:${Math.round(v * 100)}%"></b></div></div>`;
    let cta;
    if (!owned) cta = `<button class="cta" data-a="buy" data-v="${id}" ${s.cash < bike.price ? 'disabled' : ''}>${s.cash < bike.price ? `NEED ${money(bike.price - s.cash)} MORE` : `BUY — ${money(bike.price)}`}</button>`;
    else if (s.data.bike !== id) cta = `<button class="cta" data-a="use" data-v="${id}">RIDE THIS ONE</button>`;
    else cta = '<button class="cta ghost" data-a="back">YOUR RIDE — LET\'S GO</button>';
    return `<div class="screen" id="garage">
      <div class="head"><button class="back" data-a="back">LEAVE</button><div class="h1">DEALERSHIP</div><div class="cash">${money(s.cash)}</div></div>
      <div class="body">
        <div class="bikes scroll">${list}</div>
        <div class="detail">
          <div><div class="brand">${bike.brand}</div><div class="name">${bike.name}</div></div>
          <div class="scroll gbody"><div class="blurb">${bike.blurb}</div>${GLB_BIKES[bike.variant]?.credit ? `<div class="credit">3D model: <a href="${GLB_BIKES[bike.variant].creditUrl}" target="_blank" rel="noopener">${GLB_BIKES[bike.variant].credit}</a></div>` : ''}
          ${stat(`Top ${top}`, bars.speed)}${stat('Punch', bars.accel)}${stat('Agility', bars.handling)}${stat('Balance', bars.balance)}
          ${cta}
          <div class="mi">Mods, paint and wraps are next door at <b>Customs</b>.</div></div>
        </div>
      </div></div>`;
  }

  // ---- helmets: cases and the collection
  _helmTab() {
    const s = this.game.save, hs = s.data.helmets, res = this._case;
    const rar = (h) => RARITY[h.rarity];
    const odds = Object.entries(RARITY).filter(([, q]) => q.chance > 0).map(([k, q]) => `<span style="color:${q.color}">${k === 'ghost' ? '???' : q.name} ${q.chance}%</span>`).join(' · ');
    let reel = '<div id="reel" class="reel idle">Open a case to win a helmet</div>';
    if (res && !res.done) reel = '<div id="reel" class="reel">…</div>';
    else if (res) {
      const q = rar(res.helmet);
      reel = `<div id="reel" class="reel won" style="color:${q.color}">${res.helmet.name}</div>
        <div class="mi" style="text-align:center">${q.name ? q.name.toUpperCase() : 'NO RARITY — ONE OF A KIND'} · ${res.dup ? `you already had it — ${money(res.refund)} back` : 'NEW — now wearing it'}</div>`;
    }
    const owned = HELMETS.filter((h) => hs.owned[h.id]).length;
    const grid = HELMETS.map((h) => {
      const q = rar(h), has = !!hs.owned[h.id];
      return `<button class="hel ${has ? 'own' : ''} ${hs.on === h.id ? 'on' : ''}" style="border-color:${q.color}" data-a="helm" data-v="${h.id}" ${has ? '' : 'disabled'}>
        <b>${has ? h.name : '? ? ?'}</b><span style="color:${q.color}">${hs.on === h.id ? 'WEARING' : q.name || (has ? 'ONE OF A KIND' : '???')}</span></button>`;
    }).join('');
    return `<div class="mod on"><div class="mh"><span class="mn">Helmet Case</span><span class="tag2 price">${money(CASE_PRICE)}</span></div>
        <div class="mi">One random helmet per case. A duplicate pays ${money(DUPLICATE_REFUND)} back.</div>
        <div class="odds">${odds}</div>
        ${reel}
        <button class="mbtn" data-a="case" ${s.cash < CASE_PRICE || this._spinning ? 'disabled' : ''}>${s.cash < CASE_PRICE ? `NEED ${money(CASE_PRICE - s.cash)} MORE` : `OPEN CASE · ${money(CASE_PRICE)}`}</button></div>
      <div class="sec">Your helmets · ${owned} of ${HELMETS.length} · tap one to wear it</div>
      <div class="hgrid">${grid}</div>
      <div class="credit">Helmet model: <a href="${HELMET_MODEL_CREDIT.url}" target="_blank" rel="noopener">${HELMET_MODEL_CREDIT.text}</a></div>`;
  }

  // ---- customs: mods and looks for the bike you rode in on
  _customs() {
    const g = this.game, s = g.save, id = s.data.bike, bike = BIKE_BY_ID[id];
    this.sel = id;
    const entry = s.entry(id) || newEntry();
    if (this.gtab === 'bike') this.gtab = 'perf';
    const tab = (k, n) => `<button class="${this.gtab === k ? 'on' : ''}" data-a="gtab" data-v="${k}">${n}</button>`;
    const body = this.gtab === 'look' ? this._lookTab(bike, entry) : this.gtab === 'helm' ? this._helmTab() : this._perfTab(bike, entry);
    return `<div class="screen" id="garage">
      <div class="head"><button class="back" data-a="back">LEAVE</button><div class="h1">CUSTOMS</div><div class="cash">${money(s.cash)}</div></div>
      <div class="body">
        <div></div>
        <div class="detail">
          <div><div class="brand">${bike.brand}</div><div class="name">${bike.name}</div></div>
          <div class="gtabs">${tab('perf', 'PERFORMANCE')}${tab('look', 'APPEARANCE')}${tab('helm', 'HELMETS')}</div>
          <div class="scroll gbody">${body}</div>
        </div>
      </div></div>`;
  }

  // ---- garage: every bike you own, spawned where you stand
  _garage() {
    const g = this.game, s = g.save, riding = this.parent === 'pause', mph = s.data.settings.units === 'mph';
    const own = BIKES.filter((b) => s.owns(b.id));
    const cards = own.map((b) => {
      const e = s.entry(b.id), spec = effectiveSpec(b, e), fits = MODS.filter((m) => modFits(b, m));
      const has = fits.filter((m) => e.mods[m.id]).length, here = s.data.bike === b.id;
      const top = Math.round(spec.drive.topSpeed * (mph ? 2.237 : 3.6));
      const btn = here
        ? `<button class="mbtn off" ${riding ? `data-a="spawn" data-v="${b.id}"` : 'disabled'}>${riding ? 'RIDING · RESPAWN IT HERE' : 'YOUR RIDE'}</button>`
        : `<button class="mbtn" data-a="spawn" data-v="${b.id}">${riding ? 'SPAWN HERE' : 'RIDE THIS ONE'}</button>`;
      return `<div class="mod ${here ? 'on' : ''}"><div class="mh"><span class="mn">${b.name}</span><span class="tag2 ${here ? 'on' : ''}">${here ? 'RIDING' : b.brand.toUpperCase()}</span></div>
        <div class="mi">Top speed ${top} ${mph ? 'mph' : 'km/h'} · ${spec.mass.toFixed(1)} kg · ${has === fits.length ? 'fully upgraded' : `mods ${has} of ${fits.length}`}</div>${btn}</div>`;
    }).join('');
    return `<div class="screen center"><div class="col panel">
      <div class="head"><button class="back" data-a="back">BACK</button><div class="h1">GARAGE<small>${own.length} of ${BIKES.length} bikes</small></div><div class="cash">${money(s.cash)}</div></div>
      <div class="scroll gar">${cards}
        <div class="tip">${riding ? 'Pick a bike and it appears under you, right where you are.' : 'Pick the bike you start on.'} Buy more at the <b>Dealership</b>; mods and paint are at <b>Customs</b>.${g.input.mode === 'keyboard' ? ' Press <kbd>G</kbd> while riding to open the garage.' : ''}</div>
      </div></div></div>`;
  }

  _settings() {
    const st = this.game.save.data.settings;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(st[key]) === String(v) ? 'on' : ''}" data-a="set" data-v="${key}:${v}">${l}</button>`).join('')}</div>`;
    const row = (l, d, c) => `<div class="row"><div class="l">${l}<small>${d}</small></div>${c}</div>`;
    return `<div class="screen center"><div class="col panel">
      <div class="head"><button class="back" data-a="back">BACK</button><div class="h1">SETTINGS</div></div>
      <div class="scroll">
        ${row('RIDING ASSIST', 'Easy auto-balances wheelies. Normal catches you at the balance point. Semi-sim does not hold you there but goes over slowly enough to save. Sim is raw.', seg('assist', [[2, 'Easy x0.6'], [1, 'Normal'], [0.5, 'Semi-sim x1.2'], [0, 'Sim x1.4']]))}
        ${row('TIME OF DAY', 'Cycle: 12 minutes of day, 12 of night', seg('time', [['cycle', 'Cycle'], ...Object.entries(TIMES).map(([k, t]) => [k, t.label])]))}
        ${row('WEATHER', 'Dynamic brings rain, fog and storms', seg('weather', [['dynamic', 'Dynamic'], ['clear', 'Always clear']]))}
        ${row('CAMERA', 'Switch any time while riding.', seg('camera', CAM_MODES.map((m) => [m.id, m.label])))}
        ${row('SPEED UNITS', '', seg('units', [['mph', 'mph'], ['kmh', 'km/h']]))}
        ${row('GRAPHICS', 'Higher is sharper. Auto picks for your device and eases off if the frame rate drops. Changing this reloads.', seg('quality', [['auto', 'Auto'], ['low', 'Low'], ['med', 'Medium'], ['high', 'High']]))}
        ${row('CONTROLS', `Detected: ${DEVICE_LABEL[this.game.device.type]}. Auto switches when you touch the screen or press a key.`, seg('controls', [['auto', 'Auto'], ['touch', 'Touch'], ['keys', 'Keyboard']]))}
        ${row('SOUND', '', seg('mute', [[false, 'On'], [true, 'Off']]))}
        ${row('VOLUME', '', seg('volume', [[0.3, 'Low'], [0.7, 'Medium'], [1, 'High']]))}
        ${row('RESET PROGRESS', 'Deletes your save from this browser.', `<div class="seg"><button data-a="wipe" class="${this._wipe ? 'on' : ''}">${this._wipe ? 'Tap again to erase everything' : 'Erase save'}</button></div>`)}
      </div></div></div>`;
  }

  _challenges() {
    const s = this.game.save;
    const items = CHALLENGES.map((c) => {
      const done = !!s.data.done[c.id], p = done ? 1 : s.progress(c);
      return `<div class="chal ${done ? 'done' : ''}"><div class="n">${c.name}</div><div class="r">${done ? 'DONE' : money(c.reward)}</div><div class="d">${c.desc}</div><div class="bar"><b style="width:${Math.round(p * 100)}%"></b></div></div>`;
    }).join('');
    return `<div class="screen center"><div class="col panel">
      <div class="head"><button class="back" data-a="back">BACK</button><div class="h1">CHALLENGES<small>${Object.keys(s.data.done).length} of ${CHALLENGES.length}</small></div><div class="cash">${money(s.cash)}</div></div>
      <div class="scroll">${items}</div></div></div>`;
  }

  // ---- the season hunt, races and deliveries at a glance
  _events() {
    const g = this.game, s = g.save, J = g.jobs, se = J.season, n = J.seasonFound(), total = J.tokens.length, done = s.data.season.done;
    const ft = s.data.settings.units === 'mph', dist = (m) => (ft ? `${Math.round(m * 3.281)} ft` : `${Math.round(m)} m`);
    const races = RACES.map((r) => {
      const b = s.data.races[r.id] || { best: null, medal: 0 }, fmt = (v) => (r.wheelie ? dist(v) : clock(v));
      return `<div class="race ${r.wheelie ? 'w' : ''}"><div class="n">${r.name}</div><div class="m m${b.medal}">${b.medal ? MEDALS[b.medal] : 'NO MEDAL'}</div>
        <div class="d">${r.wheelie ? 'Longest wheelie in 60 s' : `${dist(r.len)} · ${r.nodes.length} checkpoints`} · best ${b.best == null ? '—' : fmt(b.best)}<br>
        Bronze ${fmt(r.goals[0])} · Silver ${fmt(r.goals[1])} · Gold ${fmt(r.goals[2])} (${money(medalCash(r, 3))})</div></div>`;
    }).join('');
    const j = s.data.jobs;
    return `<div class="screen center"><div class="col panel">
      <div class="head"><button class="back" data-a="back">BACK</button><div class="h1">SEASON ${se.n}<small>${se.name}</small></div><div class="cash">${money(s.cash)}</div></div>
      <div class="scroll">
        <div class="season"><div class="sn">${se.item}s<small>${n} OF ${total} FOUND</small></div>
          <div class="bar"><b style="width:${Math.round((n / total) * 100)}%"></b></div>
          <div class="mi">${done ? `Season complete — the ${se.reward.name} is yours.` : `${total} are hidden around the city and they are not on the map. A meter shows up when one is close. Find them all for the <b>${se.reward.name}</b>, which you can't get any other way. ${money(se.each)} each.`}</div>
          <div class="mi">Next season the hiding places and the reward change.</div></div>
        <div class="sec">Races and wheelie runs · stop in a blue or pink ring to start</div>
        ${races}
        <div class="sec">Deliveries · stop in an orange ring to pick up an order</div>
        <div class="race food"><div class="n">${FOOD.length} restaurants</div><div class="m m3">${money(j.earned)}</div>
          <div class="d">${j.deliveries} delivered · best streak ${j.streakBest}<br>Faster drops tip more, wheelies on the way add a bonus, crashes damage the order, and each delivery in a row adds 10%.</div></div>
      </div></div></div>`;
  }

  _cheats() {
    const r = this._cheatMsg; this._cheatMsg = null;
    return `<div class="screen center"><div class="col panel">
      <div class="head"><button class="back" data-a="back">BACK</button><div class="h1">CODES</div><div class="cash">${money(this.game.save.cash)}</div></div>
      <div class="scroll">
        <div class="cheat"><input id="cheat-code" type="text" maxlength="32" placeholder="ENTER CODE" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false">
          <button class="cta" data-a="cheat">ENTER</button></div>
        ${r ? `<div class="tip ${r.ok ? 'good' : 'bad'}">${r.msg}</div>` : '<div class="tip">Type a code and press ENTER.</div>'}
      </div></div></div>`;
  }

  _controls() {
    const mode = this.game.input.mode;
    const keys = `<div class="keys">
      <span><kbd>W</kbd> / <kbd>↑</kbd></span><span>Throttle (pedal)</span>
      <span><kbd>S</kbd> / <kbd>↓</kbd></span><span>Brake — in a wheelie this is your rear brake: tap it to bring the front down</span>
      <span><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd></span><span>Steer</span>
      <span><kbd>Shift</kbd> / <kbd>Q</kbd></span><span>Lean back — pull up into a wheelie. On a pedal bike, stop pedalling and hold it to <b>manual</b>: hold to lift the front, let go to let it drop, and balance it by doing both</span>
      <span><kbd>X</kbd></span><span>Front brake / stoppie — hold it on the ground to lift the tail. In a wheelie it only stops the front wheel, it doesn't bring the bike down. Normal braking with <kbd>S</kbd> never tips you over the bars.</span>
      <span><kbd>E</kbd></span><span>Lean forward — keeps a powerful bike's front down, rotates you forwards in the air</span>
      <span><kbd>Space</kbd></span><span>Bunny hop (hold to crouch, release to pop)</span>
      <span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></span><span>One-hander, no-hander, seat stander, foot drag (also <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> <kbd>;</kbd>) — tap to switch a trick on, tap again to switch it off. On a one-hander the free hand hangs loose; in a wheelie deep enough for it to reach the road it drags for a bigger score. They stay on until you switch them off (or crash). With no hands you can't use the throttle, brakes or pull; with one hand you can't hop</span>
      <span><kbd>B</kbd></span><span>Burnout mode on / off — then hold throttle to light up the rear tyre, steer to spin donuts (motor bikes only)</span>
      <span><kbd>C</kbd></span><span>Change camera</span>
      <span><kbd>R</kbd></span><span>Riding: reset to the road. After a crash: get up right away, then <kbd>R</kbd> again brings your bike to you</span>
      <span><kbd>F</kbd></span><span>Get on the bike when you're standing next to it</span>
      <span><kbd>G</kbd></span><span>Garage: every bike you own — pick one and it spawns right where you are</span>
      <span><kbd>N</kbd></span><span>Open the full map — click it to drop waypoints (or click the minimap)</span>
      <span><kbd>P</kbd> <kbd>M</kbd> <kbd>T</kbd></span><span>Pause, mute, time of day</span>
    </div>`;
    const touch = `<div class="keys">
      <span class="k"><b>Left stick</b></span><span>Slide left / right to steer. Pull <b>down</b> to lean back (wheelie), push <b>up</b> to lean forward.</span>
      <span class="k"><b>GAS</b></span><span>Throttle — slide your thumb up the pedal for more.</span>
      <span class="k"><b>BRAKE</b></span><span>Brake. In a wheelie it's the rear brake that saves you from looping out.</span>
      <span class="k"><b>WHEELIE</b></span><span>Pulls the front wheel up. Hold GAS, press it, then balance with GAS and BRAKE. (Pulling the stick down does the same.) On a pedal bike, let go of GAS and hold WHEELIE to <b>manual</b>: hold it to lift the front, let go to let it drop.</span>
      <span class="k"><b>STOPPIE</b></span><span>The front brake on its own. Hold it on the ground to lift the tail into a stoppie. In a wheelie it only stops the front wheel — use BRAKE to bring the bike down. BRAKE on its own never tips you over the bars.</span>
      <span class="k"><b>HOP</b></span><span>Hold to crouch, release to bunny hop.</span>
      <span class="k"><b>Trick buttons</b></span><span>Tap to switch a trick on (the button lights up), tap again to switch it off. They stay on until you switch them off (or crash). With <b>NO HANDS</b> you can't use GAS, BRAKE, WHEELIE or STOPPIE and steering is weak; with <b>ONE HAND</b> you can't hop.</span>
      <span class="k"><b>BURNOUT</b></span><span>Switch burnout mode on or off. With it on, hold GAS to smoke the rear tyre and steer to spin (motor bikes only).</span>
      <span class="k"><b>RESET / CALL BIKE</b></span><span>Riding: puts you back on the road. On foot after a crash: brings your bike to you. Walk with the stick and GAS, then tap <b>GET ON</b> next to the bike.</span>
      <span class="k"><b>Minimap</b></span><span>Tap it to open the full map, then tap anywhere to drop a waypoint.</span>
      <span class="k"><b>CAM / II</b></span><span>Change camera, pause.</span>
    </div>`;
    const pad = `<div class="keys">
      <span class="k"><b>RT / LT</b></span><span>Throttle / brake</span>
      <span class="k"><b>Left stick</b></span><span>Steer, and pull back / push forward to lean</span>
      <span class="k"><b>A</b></span><span>Bunny hop</span>
      <span class="k"><b>X Y B LB</b></span><span>One-hander, no-hander, seat stander, foot drag. Click the right stick to stoppie.</span>
      <span class="k"><b>RB / Start / Back</b></span><span>Camera, pause, reset</span>
    </div>`;
    const order = mode === 'touch' ? [['TOUCH', touch], ['KEYBOARD', keys], ['GAMEPAD', pad]] : mode === 'gamepad' ? [['GAMEPAD', pad], ['KEYBOARD', keys], ['TOUCH', touch]] : [['KEYBOARD', keys], ['GAMEPAD', pad], ['TOUCH', touch]];
    return `<div class="screen center"><div class="col panel">
      <div class="head"><button class="back" data-a="back">BACK</button><div class="h1">HOW TO RIDE</div></div>
      <div class="scroll">
        <div class="tip"><b>Your first wheelie:</b> get rolling, hold throttle and lean back. The front comes up — now feather the throttle to float in the green <b>balance point</b> zone. Too high? Tap the brake. On a pedal bike you can <b>manual</b> too: stop pedalling and hold lean back, then hold and let go to keep the front up with your hips. Tap a trick button for a bigger multiplier, and keep chaining tricks before the combo timer runs out to bank cash.</div>
        <div class="tip"><b>Shops:</b> next to where you start are the <b>Dealership</b> (buy and switch bikes) and the <b>Customs</b> garage (mods, paint, wraps). Ride into the glowing ring at each to go in. Both are marked on the map.</div>
        <div class="tip"><b>Jobs and races:</b> stop inside an <b>orange</b> ring to pick up a delivery, a <b>blue</b> ring to start a checkpoint race, or a <b>pink</b> ring for a wheelie run. They are all on the map. This season's hidden sprockets are not — a meter appears when one is close.</div>
        <div class="tip"><b>Cops:</b> wheelies, speeding and e-motos get you noticed. Once they chase, break line of sight — alleys, parks and gaps cars can't fit through — and stay hidden until the bar fills. Higher heat means roadblocks, bike cops and a helicopter, but a bigger payout when you escape.</div>
        ${order.map(([t, h]) => `<div class="sec" style="margin:16px 0 8px">${t}</div>${h}`).join('')}
      </div></div></div>`;
  }
}
