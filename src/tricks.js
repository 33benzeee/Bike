// Trick detection, scoring and the combo chain.
const VARIANTS = [
  { key: 'one', name: 'One-Hander', mult: 1.5, air: 'One-Hand Air', airPts: 150 },
  { key: 'no', name: 'No-Hander', mult: 2.2, air: 'No-Hander', airPts: 300 },
  { key: 'stand', name: 'Seat Stander', mult: 2.6, air: 'Superman', airPts: 500 },
  { key: 'drag', name: 'Foot Drag', mult: 1.6, air: 'Can-Can', airPts: 250 },
  // not a button: a one-hander leaned over far enough that the free hand reaches the road
  { key: 'hand', name: 'Hand Drag', mult: 2.0, air: 'Hand Drag', airPts: 0 },
];

export class Tricks {
  constructor() {
    this.combo = { active: false, points: 0, mult: 1, timer: 0, names: [], time: 0 };
    this.label = ''; this.zone = 0;
    this.wheelie = { on: false, dist: 0, time: 0, thr: 0, swerves: 0, lastSign: 0, peak: 0, named: {} };
    this.stoppie = { on: false, dist: 0, time: 0 };
    this.varT = { one: 0, no: 0, stand: 0, drag: 0, hand: 0 };
    this.airVar = { one: 0, no: 0, stand: 0, drag: 0, hand: 0 };
    this.skidT = 0; this.hopped = false;
    this.onPopup = null; this.onBank = null; this.onLost = null; this.onStat = null;
    this.scoreMult = 1; this.heatMult = 1;
  }

  _add(name, pts, popup = true) {
    const c = this.combo;
    if (!c.active) { c.active = true; c.points = 0; c.names = []; c.time = 0; }
    if (name && !c.names.includes(name)) c.names.push(name);
    c.points += pts * this.scoreMult * this.heatMult;
    c.timer = 2.6;
    c.mult = Math.min(12, 1 + 0.5 * Math.max(0, c.names.length - 1) + Math.floor(c.time / 5) * 0.25);
    if (popup && this.onPopup && pts >= 20) this.onPopup(name, Math.round(pts * this.scoreMult * this.heatMult));
  }

  nearMiss(gap) {
    if (this.wheelie.on) this._add('Traffic Slice', 160);
    else this._add('Close Call', gap < 0.5 ? 90 : 60);
    if (this.onStat) this.onStat('nearMiss', 1);
  }

  crash() {
    const c = this.combo;
    if (c.active && c.points > 30 && this.onLost) this.onLost(Math.round(c.points * c.mult));
    c.active = false; c.points = 0; c.names = []; c.mult = 1; c.timer = 0;
    this.wheelie.on = false; this.stoppie.on = false; this.label = '';
  }

  bankNow() {
    const c = this.combo;
    if (!c.active) return;
    const total = Math.round(c.points * c.mult);
    c.active = false;
    if (total >= 10 && this.onBank) this.onBank(total, c.names.slice(), c.mult);
    if (this.onStat) this.onStat('combo', total);
    c.points = 0; c.names = []; c.mult = 1;
  }

  // keys: { one, no, stand, drag } pose weights (0..1) from the rider
  update(dt, phys, keys, spec) {
    const c = this.combo, w = this.wheelie, s = this.stoppie;
    const speed = Math.abs(phys.speed);
    let busy = false; const parts = [];
    this.zone = 0;

    // a landing you crash on scores nothing (the crash has already thrown the combo away)
    const wrecked = phys.events.some((e) => e.type === 'crash');
    for (const e of phys.events) {
      if (wrecked && (e.type === 'land' || e.type === 'flip')) { this.hopped = false; for (const k in this.airVar) this.airVar[k] = 0; continue; }
      if (e.type === 'hop') this.hopped = true;
      else if (e.type === 'flip') { this._add(e.dir > 0 ? 'Backflip' : 'Frontflip', 700); if (this.onStat) this.onStat('flip', 1); }
      else if (e.type === 'land') {
        if (e.airTime > 0.45) {
          const pts = 35 * e.airTime * e.airTime + Math.max(0, e.drop - 0.8) * 45;
          this._add(e.drop > 2.2 ? 'Huge Drop' : e.airTime > 1.1 ? 'Big Air' : this.hopped ? 'Bunny Hop' : 'Air', pts);
          if (this.onStat) this.onStat('air', e.airTime);
        }
        for (const v of VARIANTS) { if (this.airVar[v.key] > 0.3) this._add(v.air, v.airPts * Math.min(2, this.airVar[v.key] / 0.5)); this.airVar[v.key] = 0; }
        this.hopped = false;
      }
    }

    const air = !phys.rearContact && !phys.frontContact && phys.airTime > 0.25;
    if (air) {
      busy = phys.airTime > 0.45;
      for (const v of VARIANTS) if (keys[v.key] > 0.75) { this.airVar[v.key] += dt; parts.push(v.air); }
      if (busy && !parts.length) parts.push('Air');
    }

    // ---- wheelie
    const up = phys.wheelieT > 0.35 && !phys.crashed;
    if (up) {
      if (!w.on) { w.on = true; w.dist = 0; w.time = 0; w.thr = 0; w.swerves = 0; w.lastSign = 0; w.named = {}; this._add('Wheelie', 0, false); }
      w.dist += speed * dt; w.time += dt; w.thr += phys.throttle * dt;
      const bp = phys.balanceAngle(), err = phys.pitch - bp;
      let rate = 10 + speed * 1.3, m = 1;
      const manual = w.time > 1.2 && w.thr / w.time < 0.12;
      let name = manual ? 'Manual' : 'Wheelie';
      if (manual) m *= 1.3;
      if (Math.abs(err) < 0.1) { m *= 2; this.zone = 1; }
      if (phys.pitch > spec.loopAngle - 0.13) { m *= 3; this.zone = 2; name = '12 O\'Clock'; if (!w.named.twelve) { w.named.twelve = true; this._add('12 O\'Clock', 150); } }
      for (const v of VARIANTS) {
        if (keys[v.key] > 0.8) {
          m *= v.mult; parts.push(v.name); this.varT[v.key] += dt;
          if (!w.named[v.key] && this.varT[v.key] > 0.5) { w.named[v.key] = true; this._add(v.name, 60); }
          if (this.onStat) this.onStat('var_' + v.key, this.varT[v.key]);
        } else this.varT[v.key] = 0;
      }
      // swerving on the back wheel
      const sign = phys.lean > 0.1 ? 1 : phys.lean < -0.1 ? -1 : 0;
      if (sign && sign !== w.lastSign) { if (w.lastSign) { w.swerves++; this._add('Swerve', 45 + Math.min(100, w.swerves * 10)); } w.lastSign = sign; }
      parts.push(name);
      this._add(null, rate * m * dt, false);
      busy = true;
      if (this.onStat) { this.onStat('wheelieDist', w.dist); this.onStat('wheelieTime', w.time); }
    } else if (w.on) {
      w.on = false;
      if (w.dist > 15 && this.onPopup) this.onPopup(`${Math.round(w.dist)} m wheelie`, 0);
      for (const k in this.varT) this.varT[k] = 0;
    }

    // ---- stoppie
    const nose = phys.frontContact && !phys.rearContact && phys.pitch < -0.2 && speed > 1.5 && !phys.crashed;
    if (nose) {
      if (!s.on) { s.on = true; s.dist = 0; s.time = 0; }
      s.dist += speed * dt; s.time += dt;
      if (s.time > 0.25) { parts.push('Stoppie'); this._add('Stoppie', (30 + speed * 2) * dt, false); busy = true; if (this.onStat) this.onStat('stoppieDist', s.dist); }
    } else if (s.on) {
      s.on = false;
      if (s.dist > 4 && this.onPopup) this.onPopup(`${Math.round(s.dist)} m stoppie`, 0);
    }

    if (phys.burning) { parts.push('Burnout'); this._add('Burnout', 22 * dt, false); busy = true; }

    // ---- skids
    if (phys.rearLocked && speed > 4 && phys.frontContact) {
      this.skidT += dt;
      if (this.skidT > 0.4) { parts.push('Skid'); this._add('Skid', 14 * dt, false); busy = true; }
    } else this.skidT = 0;

    this.label = parts.join(' + ');
    if (c.active) {
      c.time += dt;
      if (!busy) { c.timer -= dt; if (c.timer <= 0) this.bankNow(); }
      else c.timer = 2.6;
    }
  }
}
