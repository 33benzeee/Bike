// On-screen controls for phones and tablets: a floating stick on the left
// (steer + lean), pedals and trick buttons on the right.
const $ = (id) => document.getElementById(id);

export class TouchControls {
  constructor(input) {
    this.input = input; this.el = $('touch');
    const t = input.touch;
    const stick = $('stick'), knob = stick.querySelector('.knob'), zone = $('stickzone');
    let pid = null, ox = 0, oy = 0, home = null;

    const radius = () => stick.offsetWidth * 0.5;
    const place = (x, y) => { stick.style.left = x - radius() + 'px'; stick.style.top = y - radius() + 'px'; stick.style.bottom = 'auto'; };
    const move = (e) => {
      const r = radius() * 0.8;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > r) { dx *= r / d; dy *= r / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / r, ny = dy / r;
      // steering gets a small dead zone; lean needs a deliberate push/pull
      t.steer = Math.abs(nx) < 0.12 ? 0 : -Math.sign(nx) * Math.min(1, (Math.abs(nx) - 0.12) / 0.7);
      t.lean = Math.abs(ny) < 0.38 ? 0 : Math.sign(ny) * Math.min(1, (Math.abs(ny) - 0.38) / 0.4);
    };
    zone.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId; try { zone.setPointerCapture(pid); } catch (err) { /* synthetic pointer */ }
      if (!home) home = { left: stick.style.left, top: stick.style.top, bottom: stick.style.bottom };
      ox = e.clientX; oy = e.clientY; place(ox, oy); move(e);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null; t.steer = 0; t.lean = 0; knob.style.transform = '';
      stick.style.left = home.left; stick.style.top = home.top; stick.style.bottom = home.bottom;
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);

    const hold = (el, on, off) => {
      const down = (e) => { try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } el.classList.add('on'); on(e); e.preventDefault(); };
      const up = () => { el.classList.remove('on'); off(); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    const gas = $('t-gas');
    // slide up the pedal for more throttle
    const gasLevel = (e) => { const r = gas.getBoundingClientRect(); t.throttle = Math.max(0.45, Math.min(1, 0.45 + ((r.bottom - e.clientY) / r.height) * 0.9)); };
    hold(gas, gasLevel, () => { t.throttle = 0; });
    gas.addEventListener('pointermove', (e) => { if (gas.classList.contains('on')) gasLevel(e); });
    hold($('t-brake'), () => { t.brake = 1; }, () => { t.brake = 0; });
    hold($('t-hop'), () => { t.hop = true; }, () => { t.hop = false; });
    $('t-wheelie').addEventListener('pointerdown', (e) => { input.press('wheelie'); e.preventDefault(); });
    hold($('t-reset'), () => input.press('reset'), () => {});
    const burn = $('t-burn');
    burn.addEventListener('pointerdown', (e) => { input.press('burn'); e.preventDefault(); });
    for (const b of $('tricks').children) { const i = +b.dataset.t; hold(b, () => { t.tricks[i] = true; }, () => { t.tricks[i] = false; }); }
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
    this.input.touch.active = on;
    document.body.classList.toggle('touch', on);
    if (!on) { const t = this.input.touch; t.throttle = t.brake = t.steer = t.lean = 0; t.hop = false; t.tricks.fill(false); }
  }
}
