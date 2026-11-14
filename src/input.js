// One input state fed by keyboard, gamepad and touch. steer: +1 = left.
// lean: +1 = back (pull up), -1 = forward.
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'back', ShiftRight: 'back', KeyQ: 'back', KeyE: 'fwd',
  Space: 'hop',
  Digit1: 't0', Digit2: 't1', Digit3: 't2', Digit4: 't3', KeyJ: 't0', KeyK: 't1', KeyL: 't2', Semicolon: 't3',
};
const ACTIONS = { KeyC: 'camera', KeyR: 'reset', KeyP: 'pause', Escape: 'pause', KeyG: 'garage', KeyM: 'mute', Enter: 'confirm', KeyT: 'time', KeyB: 'burn', KeyF: 'mount' };

export class Input {
  constructor() {
    this.state = { throttle: 0, brake: 0, steer: 0, lean: 0, hop: false, tricks: [false, false, false, false] };
    this.keys = {};
    this.touch = { throttle: 0, brake: 0, steer: 0, lean: 0, hop: false, tricks: [false, false, false, false], active: false };
    this.queue = [];
    this.mode = 'keyboard'; // last device used: keyboard | touch | gamepad
    this.onMode = null;
    this._padPrev = [];
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const k = KEYMAP[e.code];
      if (k) { this.keys[k] = true; e.preventDefault(); }
      const a = ACTIONS[e.code];
      if (a && !e.repeat) { this.queue.push(a); if (e.code !== 'Escape') e.preventDefault(); }
      if (k || a) this._setMode('keyboard');
    });
    window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) this.keys[k] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    window.addEventListener('touchstart', () => this._setMode('touch'), { passive: true });
  }

  _setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    if (this.onMode) this.onMode(m);
  }

  take(action) {
    const i = this.queue.indexOf(action);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    return true;
  }

  press(action) { this.queue.push(action); }

  update() {
    const s = this.state, k = this.keys, t = this.touch;
    let throttle = k.up ? 1 : 0, brake = k.down ? 1 : 0;
    let steer = (k.left ? 1 : 0) - (k.right ? 1 : 0);
    let lean = (k.back ? 1 : 0) - (k.fwd ? 1 : 0);
    let hop = !!k.hop;
    const tr = [!!k.t0, !!k.t1, !!k.t2, !!k.t3];

    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected || p.buttons.length < 10) continue;
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
      const b = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
      const gx = dz(p.axes[0] || 0), gy = dz(p.axes[1] || 0), ry = dz(p.axes[3] || 0);
      const gl = Math.abs(gy) > Math.abs(ry) ? gy : ry;
      if (b(7) > 0.05 || b(6) > 0.05 || gx || gl || b(0)) this._setMode('gamepad');
      throttle = Math.max(throttle, b(7)); brake = Math.max(brake, b(6));
      if (gx) steer = -gx; if (gl) lean = gl;
      hop = hop || b(0) > 0.5;
      tr[0] = tr[0] || b(2) > 0.5; tr[1] = tr[1] || b(3) > 0.5; tr[2] = tr[2] || b(1) > 0.5; tr[3] = tr[3] || b(4) > 0.5;
      const edge = (i, a) => { const d = b(i) > 0.5; if (d && !this._padPrev[i]) this.queue.push(a); this._padPrev[i] = d; };
      edge(5, 'camera'); edge(9, 'pause'); edge(8, 'reset'); edge(0, 'confirm');
      break;
    }

    if (t.active) {
      throttle = Math.max(throttle, t.throttle); brake = Math.max(brake, t.brake);
      if (t.steer) steer = t.steer; if (t.lean) lean = t.lean;
      if (t.pull) lean = 1; // the WHEELIE button is a pull on the bars
      hop = hop || t.hop;
      for (let i = 0; i < 4; i++) tr[i] = tr[i] || t.tricks[i];
    }

    if (!this.enabled) { throttle = brake = steer = lean = 0; hop = false; tr.fill(false); }
    s.throttle = throttle; s.brake = brake; s.steer = Math.max(-1, Math.min(1, steer)); s.lean = Math.max(-1, Math.min(1, lean));
    s.hop = hop;
    for (let i = 0; i < 4; i++) s.tricks[i] = tr[i];
    return s;
  }
}
