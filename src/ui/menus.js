// Title, pause, garage, settings, challenges and controls screens.
import { BIKES, BIKE_BY_ID, PAINTS, UPGRADE_LEVELS, upgradesFor, upgradePrice, effectiveSpec, statBars } from '../bikes.js';
import { CHALLENGES } from '../progress.js';
import { TIMES } from '../world/sky.js';
import { CAM_MODES } from '../camera.js';
import { DEVICE_LABEL } from '../device.js';
import { money } from './hud.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class Menus {
  constructor(game) {
    this.game = game; this.root = document.getElementById('screens');
    this.current = null; this.parent = 'title'; this.sel = game.save.data.bike;
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
    if (name === 'garage') this.game.previewBike(this.sel);
    if (name === 'cheats' && this.game.device.type === 'desktop') { const i = this.root.querySelector('#cheat-code'); if (i) i.focus(); }
  }

  hide() { this.current = null; this.root.innerHTML = ''; }
  refresh() { if (this.current) { const sc = this.root.querySelector('.scroll'); const top = sc ? sc.scrollTop : 0; this.show(this.current); const s2 = this.root.querySelector('.scroll'); if (s2) s2.scrollTop = top; } }

  _act(a, v) {
    const g = this.game, au = g.audio, s = g.save;
    switch (a) {
      case 'ride': au.ui(); g.startRide(); break;
      case 'resume': au.ui(); g.resume(); break;
      case 'go': au.ui(); if (v === 'garage') { this.sel = s.data.bike; g.openGarage(); } this.show(v); break;
      case 'back': au.ui(); if (this.current === 'garage') g.closeGarage(); this.show(this.parent); break;
      case 'quit': au.ui(); g.toTitle(); break;
      case 'sel': au.ui(); this.sel = v; this.show('garage'); break;
      case 'buy': if (g.buyBike(v)) { au.bank(true); this.sel = v; } else au.deny(); this.show('garage'); break;
      case 'use': au.ui(); g.selectBike(v); this.show('garage'); break;
      case 'up': if (g.buyUpgrade(this.sel, v)) au.bank(false); else au.deny(); this.show('garage'); break;
      case 'paint': au.ui(); g.setPaint(this.sel, +v); this.show('garage'); break;
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
        <button class="btn" data-a="go" data-v="garage">GARAGE <small>${money(g.save.cash)}</small></button>
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

  _garage() {
    const g = this.game, s = g.save, id = this.sel, bike = BIKE_BY_ID[id];
    const owned = s.owns(id), entry = s.entry(id) || { up: {}, paint: 0 };
    const spec = effectiveSpec(bike, entry.up), bars = statBars(spec);
    const top = Math.round(spec.drive.topSpeed * (s.data.settings.units === 'mph' ? 2.237 : 3.6));
    const list = BIKES.map((b) => {
      const o = s.owns(b.id), riding = s.data.bike === b.id;
      return `<button class="bike ${b.id === id ? 'sel' : ''} ${riding ? 'riding' : ''} ${o ? '' : 'locked'}" data-a="sel" data-v="${b.id}">
        <div class="n">${b.name}</div><div class="p">${riding ? 'RIDING' : o ? 'OWNED' : money(b.price)}</div></button>`;
    }).join('');
    const ups = upgradesFor(bike).map((u) => {
      const lv = entry.up[u.id] || 0, maxed = lv >= UPGRADE_LEVELS, price = maxed ? 0 : upgradePrice(bike, lv + 1);
      const pips = Array.from({ length: UPGRADE_LEVELS }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      return `<div class="up"><div><div class="un">${u.name}</div><div class="ud">${u.desc}</div></div><div class="pips">${pips}</div>
        <button class="buy" data-a="up" data-v="${u.id}" ${maxed || !owned || s.cash < price ? 'disabled' : ''}>${maxed ? 'MAX' : money(price)}</button></div>`;
    }).join('');
    const paints = PAINTS.map((p, i) => `<button class="${i === (entry.paint || 0) ? 'sel' : ''} ${p.color === null ? 'stock' : ''}" title="${p.name}" data-a="paint" data-v="${i}" style="${p.color === null ? `background:${hex(bike.paint)}` : `background:${hex(p.color)}`}"></button>`).join('');
    const stat = (n, v) => `<div class="stat"><span>${n}</span><div class="bar"><b style="width:${Math.round(v * 100)}%"></b></div></div>`;
    let cta;
    if (!owned) cta = `<button class="cta" data-a="buy" data-v="${id}" ${s.cash < bike.price ? 'disabled' : ''}>${s.cash < bike.price ? `NEED ${money(bike.price - s.cash)} MORE` : `BUY — ${money(bike.price)}`}</button>`;
    else if (s.data.bike !== id) cta = `<button class="cta" data-a="use" data-v="${id}">RIDE THIS ONE</button>`;
    else cta = '<button class="cta ghost" data-a="back">YOUR RIDE — LET\'S GO</button>';
    return `<div class="screen" id="garage">
      <div class="head"><button class="back" data-a="back">BACK</button><div class="h1">GARAGE</div><div class="cash">${money(s.cash)}</div></div>
      <div class="body">
        <div class="bikes scroll">${list}</div>
        <div class="detail scroll">
          <div><div class="brand">${bike.brand}</div><div class="name">${bike.name}</div></div>
          <div class="blurb">${bike.blurb}</div>
          ${stat(`Top ${top}`, bars.speed)}${stat('Punch', bars.accel)}${stat('Agility', bars.handling)}${stat('Balance', bars.balance)}
          ${cta}
          ${owned ? `<div class="sec">Upgrades</div>${ups}<div class="sec">Paint</div><div class="paints">${paints}</div>` : '<div class="sec">Buy it to unlock upgrades and paint</div>'}
        </div>
      </div></div>`;
  }

  _settings() {
    const st = this.game.save.data.settings;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(st[key]) === String(v) ? 'on' : ''}" data-a="set" data-v="${key}:${v}">${l}</button>`).join('')}</div>`;
    const row = (l, d, c) => `<div class="row"><div class="l">${l}<small>${d}</small></div>${c}</div>`;
    return `<div class="screen center"><div class="col panel">
      <div class="head"><button class="back" data-a="back">BACK</button><div class="h1">SETTINGS</div></div>
      <div class="scroll">
        ${row('RIDING ASSIST', 'Easy auto-balances wheelies (lower score). Sim is raw physics for analog throttles (bonus score).', seg('assist', [[2, 'Easy x0.6'], [1, 'Normal'], [0, 'Sim x1.4']]))}
        ${row('TIME OF DAY', '', seg('time', Object.entries(TIMES).map(([k, t]) => [k, t.label])))}
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

  _cheats() {
    const r = this._cheatMsg; this._cheatMsg = null;
    return `<div class="screen center"><div class="col panel">
      <div class="head"><button class="back" data-a="back">BACK</button><div class="h1">CODES</div><div class="cash">${money(this.game.save.cash)}</div></div>
      <div class="scroll">
        <div class="cheat"><input id="cheat-code" type="text" maxlength="16" placeholder="ENTER CODE" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false">
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
      <span><kbd>Shift</kbd> / <kbd>Q</kbd></span><span>Lean back — pull up into a wheelie</span>
      <span><kbd>X</kbd></span><span>Stoppie — hold it to brake onto the front wheel and lift the tail. Normal braking with <kbd>S</kbd> never tips you over the bars.</span>
      <span><kbd>E</kbd></span><span>Lean forward — keeps a powerful bike's front down, rotates you forwards in the air</span>
      <span><kbd>Space</kbd></span><span>Bunny hop (hold to crouch, release to pop)</span>
      <span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></span><span>One-hander, no-hander, seat stander, foot drag (also <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> <kbd>;</kbd>) — hold during a wheelie or in the air</span>
      <span><kbd>B</kbd></span><span>Burnout mode on / off — then hold throttle to light up the rear tyre, steer to spin donuts (motor bikes only)</span>
      <span><kbd>C</kbd></span><span>Change camera</span>
      <span><kbd>R</kbd></span><span>Riding: reset to the road. After a crash: get up right away, then <kbd>R</kbd> again brings your bike to you</span>
      <span><kbd>F</kbd></span><span>Get on the bike when you're standing next to it</span>
      <span><kbd>G</kbd> <kbd>P</kbd> <kbd>M</kbd> <kbd>T</kbd></span><span>Garage, pause, mute, time of day</span>
    </div>`;
    const touch = `<div class="keys">
      <span class="k"><b>Left stick</b></span><span>Slide left / right to steer. Pull <b>down</b> to lean back (wheelie), push <b>up</b> to lean forward.</span>
      <span class="k"><b>GAS</b></span><span>Throttle — slide your thumb up the pedal for more.</span>
      <span class="k"><b>BRAKE</b></span><span>Brake. In a wheelie it's the rear brake that saves you from looping out.</span>
      <span class="k"><b>WHEELIE</b></span><span>Pulls the front wheel up. Hold GAS, press it, then balance with GAS and BRAKE. (Pulling the stick down does the same.)</span>
      <span class="k"><b>STOPPIE</b></span><span>Hold it to brake onto the front wheel and lift the tail. BRAKE on its own never tips you over the bars.</span>
      <span class="k"><b>HOP</b></span><span>Hold to crouch, release to bunny hop.</span>
      <span class="k"><b>Trick buttons</b></span><span>Hold during a wheelie or in the air.</span>
      <span class="k"><b>BURNOUT</b></span><span>Switch burnout mode on or off. With it on, hold GAS to smoke the rear tyre and steer to spin (motor bikes only).</span>
      <span class="k"><b>RESET / CALL BIKE</b></span><span>Riding: puts you back on the road. On foot after a crash: brings your bike to you. Walk with the stick and GAS, then tap <b>GET ON</b> next to the bike.</span>
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
        <div class="tip"><b>Your first wheelie:</b> get rolling, hold throttle and lean back. The front comes up — now feather the throttle to float in the green <b>balance point</b> zone. Too high? Tap the brake. Hold a trick button for a bigger multiplier, and keep chaining tricks before the combo timer runs out to bank cash.</div>
        <div class="tip"><b>Cops:</b> wheelies, speeding and e-motos get you noticed. Once they chase, break line of sight — alleys, parks and gaps cars can't fit through — and stay hidden until the bar fills. Higher heat means roadblocks, bike cops and a helicopter, but a bigger payout when you escape.</div>
        ${order.map(([t, h]) => `<div class="sec" style="margin:16px 0 8px">${t}</div>${h}`).join('')}
      </div></div></div>`;
  }
}
