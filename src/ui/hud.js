// In-game HUD: cash, heat, speed, balance meter, combo, minimap, banners.
import { EDGE, WALK } from '../world/city.js';

const $ = (id) => document.getElementById(id);
const MAP_COL = { L: '#6f6a62', M: '#77736c', T: '#5d6876', K: '#4f8a44', D: '#9a7448', S: '#a9a59b', P: '#55585f', C: '#8a6a3c', V: '#b9b4a6', H: '#d9b21c' };
export const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

export class Hud {
  constructor(city) {
    this.el = $('hud'); this.cash = $('cash'); this.heat = [...$('heat').children]; this.heatBox = $('heat');
    this.evade = $('evade'); this.evadeBar = this.evade.querySelector('b'); this.evadeLbl = this.evade.querySelector('span');
    this.eye = $('eye'); this.eyeBar = this.eye.querySelector('b');
    this.combo = $('combo'); this.comboLabel = this.combo.querySelector('.label'); this.comboPts = this.combo.querySelector('.pts'); this.comboMult = this.combo.querySelector('.mult'); this.comboBar = this.combo.querySelector('b');
    this.meter = $('meter'); this.zone = this.meter.querySelector('.zone'); this.danger = this.meter.querySelector('.danger'); this.needle = this.meter.querySelector('.needle'); this.cap = this.meter.querySelector('.cap');
    this.speedNum = $('speed').querySelector('.num'); this.speedUnit = $('speed').querySelector('.unit');
    this.popups = $('popups'); this.toasts = $('toasts'); this.bannerEl = $('banner'); this.hintEl = $('hint');
    this.bust = $('bust'); this.bustBar = this.bust.querySelector('b'); this.flash = $('copflash'); this.camEl = $('camname');
    this.map = $('minimap'); this.mctx = this.map.getContext('2d');
    this._cash = -1; this._shown = 0; this._speed = -1; this._heat = -1; this._bannerT = 0; this._hintT = 0; this._popY = 0; this._camT = 0;
    this._label = ''; this._blink = 0;
    this._prerender(city);
  }

  _prerender(city) {
    const size = 512, world = (EDGE + WALK) * 2, k = size / world;
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const c = cv.getContext('2d');
    c.fillStyle = '#2c5f7a'; c.fillRect(0, 0, size, size);
    c.fillStyle = '#2b2e35'; c.fillRect(0, 0, size, size);
    for (const b of city.blocks) {
      c.fillStyle = MAP_COL[b.type] || '#777';
      c.fillRect((b.x0 + world / 2) * k, (b.z0 + world / 2) * k, (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    }
    this.mapImg = cv; this.mapK = k; this.mapWorld = world; this.home = city.spots.home;
  }

  show(on) { this.el.classList.toggle('hidden', !on); if (!on) this.flash.classList.remove('on'); }

  popup(text, pts) {
    const d = document.createElement('div');
    d.innerHTML = pts ? `${text}<b>+${pts}</b>` : text;
    this._popY = (this._popY + 1) % 4;
    d.style.top = this._popY * 30 + 'px';
    this.popups.appendChild(d);
    setTimeout(() => d.remove(), 1350);
    while (this.popups.children.length > 5) this.popups.firstChild.remove();
  }

  toast(tag, name, desc = '') {
    const d = document.createElement('div'); d.className = 'toast';
    d.innerHTML = `<div class="t">${tag}</div><div class="n">${name}</div>${desc ? `<div class="d">${desc}</div>` : ''}`;
    this.toasts.appendChild(d);
    setTimeout(() => d.remove(), 4300);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
  }

  banner(big, sub = '', cls = 'yel', dur = 2.2) {
    this.bannerEl.className = cls;
    this.bannerEl.innerHTML = `<div class="big">${big}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    this._bannerT = dur;
  }

  hint(html, dur = 5) { this.hintEl.innerHTML = html; this.hintEl.classList.add('show'); this._hintT = dur; }
  camName(label) { this.camEl.textContent = label; this.camEl.classList.add('show'); this._camT = 1.6; }

  update(dt, d) {
    // cash counts up
    if (this._cash !== d.cash) {
      if (this._cash < 0) this._shown = d.cash;
      else if (d.cash > this._cash) { this.cash.classList.add('bump'); setTimeout(() => this.cash.classList.remove('bump'), 160); }
      this._cash = d.cash;
    }
    if (this._shown !== this._cash) {
      const diff = this._cash - this._shown;
      this._shown = Math.abs(diff) < 2 ? this._cash : this._shown + diff * Math.min(1, dt * 7);
      this.cash.textContent = money(this._shown);
    } else if (!this.cash.textContent || this.cash.textContent === '$0') this.cash.textContent = money(this._shown);

    const sp = Math.round(Math.abs(d.speed) * (d.units === 'mph' ? 2.237 : 3.6));
    if (sp !== this._speed) { this._speed = sp; this.speedNum.textContent = sp; }
    if (this.speedUnit.textContent !== d.units.toUpperCase()) this.speedUnit.textContent = d.units === 'mph' ? 'MPH' : 'KM/H';

    // heat
    if (d.heat !== this._heat) { this._heat = d.heat; this.heat.forEach((s, i) => s.classList.toggle('on', i < d.heat)); }
    this.heatBox.classList.toggle('calm', d.wanted && !d.seen);
    this.flash.classList.toggle('on', d.wanted && d.seen);
    this.evade.classList.toggle('hidden', !(d.wanted && !d.seen));
    if (d.wanted && !d.seen) { this.evadeBar.style.width = d.evade * 100 + '%'; this.evadeLbl.textContent = d.hidden ? 'HIDDEN — STAY PUT' : 'OUT OF SIGHT — LOSE THEM'; }
    const watching = !d.wanted && d.watcher && d.suspicion > 0.02;
    this.eye.classList.toggle('hidden', !watching);
    if (watching) this.eyeBar.style.width = d.suspicion * 100 + '%';
    this.bust.classList.toggle('hidden', !(d.bust > 0.03));
    if (d.bust > 0.03) this.bustBar.style.width = d.bust * 100 + '%';

    // combo
    const c = d.combo;
    this.combo.classList.toggle('hidden', !c.active);
    if (c.active) {
      const label = d.label || c.names.slice(-2).join(' + ');
      if (label !== this._label) { this._label = label; this.comboLabel.textContent = label || ' '; }
      this.comboPts.textContent = Math.round(c.points).toLocaleString('en-US');
      this.comboMult.textContent = 'x' + (Math.round(c.mult * 100) / 100);
      this.comboBar.style.width = Math.max(0, Math.min(1, c.timer / 2.6)) * 100 + '%';
    }

    // balance meter
    const w = d.wheelie;
    this.meter.classList.toggle('hidden', !w.show);
    if (w.show) {
      const max = w.loop + 0.24;
      this.needle.style.left = Math.max(0, Math.min(1, w.pitch / max)) * 100 + '%';
      this.zone.style.left = ((w.bp - 0.1) / max) * 100 + '%'; this.zone.style.width = (0.2 / max) * 100 + '%';
      this.danger.style.width = (0.37 / max) * 100 + '%';
      this.meter.classList.toggle('sweet', d.zone === 1); this.meter.classList.toggle('risk', d.zone === 2 || w.pitch > w.loop - 0.2);
      this.cap.textContent = d.zone === 2 ? '12 O\'CLOCK!' : d.zone === 1 ? 'BALANCE POINT x2' : w.pitch > w.loop - 0.25 ? 'BRAKE!' : 'BALANCE';
    }

    if (this._bannerT > 0) { this._bannerT -= dt; if (this._bannerT <= 0) this.bannerEl.innerHTML = ''; }
    if (this._hintT > 0) { this._hintT -= dt; if (this._hintT <= 0) this.hintEl.classList.remove('show'); }
    if (this._camT > 0) { this._camT -= dt; if (this._camT <= 0) this.camEl.classList.remove('show'); }
    this._blink += dt;
  }

  minimap(px, pz, yaw, cops, wanted) {
    const c = this.mctx, S = this.map.width, R = 150; // metres shown from centre to edge
    const k = this.mapK, half = this.mapWorld / 2;
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath(); c.arc(S / 2, S / 2, S / 2, 0, 6.2832); c.clip();
    c.fillStyle = '#244d63'; c.fillRect(0, 0, S, S);
    const sc = S / (2 * R);
    c.drawImage(this.mapImg, (px - R + half) * k, (pz - R + half) * k, 2 * R * k, 2 * R * k, 0, 0, S, S);
    const dot = (x, z, r, col, clampEdge) => {
      let dx = (x - px) * sc, dz = (z - pz) * sc;
      const d = Math.hypot(dx, dz), lim = S / 2 - 9;
      if (d > lim) { if (!clampEdge) return; dx *= lim / d; dz *= lim / d; }
      c.fillStyle = col; c.beginPath(); c.arc(S / 2 + dx, S / 2 + dz, r, 0, 6.2832); c.fill();
    };
    if (this.home) { dot(this.home.shopX, this.home.shopZ, 9, '#000', true); dot(this.home.shopX, this.home.shopZ, 6.5, '#ffd21f', true); }
    const blink = Math.floor(this._blink * 5) % 2 === 0;
    for (const u of cops) {
      const hot = u.chasing || u.state === 'block';
      if (u.heli) { dot(u.x, u.z, 10, blink ? '#fff' : '#ff3b30', wanted); continue; }
      dot(u.x, u.z, hot ? 8 : 6, hot ? (blink ? '#ff3b30' : '#2f7bff') : '#9fb6ff', hot && wanted);
    }
    // player arrow
    c.translate(S / 2, S / 2); c.rotate(Math.PI - yaw);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -15); c.lineTo(10, 11); c.lineTo(0, 5); c.lineTo(-10, 11); c.closePath(); c.stroke(); c.fill();
    c.restore();
  }
}
