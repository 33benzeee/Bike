// All sound is synthesised with WebAudio — no audio files to download.
export class GameAudio {
  constructor() {
    this.ctx = null; this.ready = false; this.volume = 0.7; this.muted = false;
    this.sirenLevel = 0; this.heliLevel = 0;
  }

  // must be called from a user gesture
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
    this.master.connect(comp); comp.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = (type, freq, q = 1) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { f, g };
    };
    const osc = (type, freq, dest) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.connect(dest); o.start(); return o; };

    // electric motor: two detuned oscillators through a low-pass
    this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
    this.motorFilter = ctx.createBiquadFilter(); this.motorFilter.type = 'lowpass'; this.motorFilter.frequency.value = 1200; this.motorFilter.Q.value = 2;
    this.motorFilter.connect(this.motorGain); this.motorGain.connect(this.master);
    this.m1 = osc('sawtooth', 100, this.motorFilter); this.m2 = osc('square', 150, this.motorFilter);
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0; this.whineGain.connect(this.master);
    this.whine = osc('sine', 800, this.whineGain);

    this.wind = noise('bandpass', 500, 0.6);
    this.roll = noise('lowpass', 300, 0.7);
    this.skid = noise('bandpass', 1900, 5);
    this.dirt = noise('bandpass', 900, 0.8);
    this.heli = noise('lowpass', 180, 1);
    this.heliLfo = ctx.createGain(); this.heliLfo.gain.value = 0;
    this.heliOsc = osc('sine', 13, this.heliLfo); this.heliLfo.connect(this.heli.g.gain);

    // siren: wail between two pitches
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1100; sf.Q.value = 0.8;
    this.sirenOsc = osc('sawtooth', 700, sf); sf.connect(this.sirenGain); this.sirenGain.connect(this.master);
    const lfoG = ctx.createGain(); lfoG.gain.value = 330; this.sirenLfo = osc('sine', 0.55, lfoG); lfoG.connect(this.sirenOsc.frequency);
    this.sirenOsc.frequency.value = 950;

    // rain on everything, and gusts
    this.rainN = noise('highpass', 2600, 0.4); this.rainL = noise('lowpass', 700, 0.5); this.gust = noise('bandpass', 260, 0.8);

    this.clickT = 0;
    this.ready = true;
  }

  setVolume(v, muted) {
    this.volume = v; this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  suspend(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend(); else this.ctx.resume();
  }

  _set(param, v, t = 0.05) { param.setTargetAtTime(v, this.ctx.currentTime, t); }

  // one-shot blips -------------------------------------------------------
  _tone(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
    if (!this.ready) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  _burst(dur, freq, vol, type = 'lowpass') {
    if (!this.ready) return;
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime;
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  ui() { this._tone(660, 0.07, 'triangle', 0.12); }
  deny() { this._tone(180, 0.18, 'square', 0.1, 0.6); }
  trick() { this._tone(880, 0.09, 'triangle', 0.1, 1.5); }
  bank(big) { this._tone(988, 0.09, 'triangle', 0.16); setTimeout(() => this._tone(1319, big ? 0.3 : 0.16, 'triangle', 0.16), 80); if (big) setTimeout(() => this._tone(1568, 0.35, 'triangle', 0.14), 180); }
  land(v) { this._burst(0.16, 220, Math.min(0.5, 0.08 + v * 0.05)); this._tone(70, 0.14, 'sine', Math.min(0.5, 0.1 + v * 0.05), 0.5); }
  crash() { this._burst(0.5, 900, 0.6); this._tone(90, 0.4, 'sawtooth', 0.35, 0.3); setTimeout(() => this._burst(0.3, 2500, 0.25, 'highpass'), 90); }
  bump() { this._burst(0.12, 400, 0.3); }
  hop() { this._burst(0.08, 600, 0.12); }
  honk() { this._tone(415, 0.35, 'square', 0.06); this._tone(330, 0.35, 'square', 0.06); }
  wanted() { this._tone(520, 0.2, 'square', 0.12, 1.6); setTimeout(() => this._tone(520, 0.3, 'square', 0.12, 1.6), 220); }
  escaped() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._tone(f, 0.25, 'triangle', 0.16), i * 90)); }
  busted() { [392, 311, 233].forEach((f, i) => setTimeout(() => this._tone(f, 0.35, 'sawtooth', 0.14), i * 160)); }
  lost() { this._tone(300, 0.3, 'triangle', 0.14, 0.5); }

  // weather beds: rain intensity and wind 0..1
  weather(rain, wind) {
    if (!this.ready) return;
    this._set(this.rainN.g.gain, rain * 0.09, 0.5); this._set(this.rainL.g.gain, rain * 0.07, 0.5);
    this._set(this.gust.g.gain, wind * (0.03 + 0.03 * Math.sin(this.ctx.currentTime * 0.7) ** 2), 0.4);
  }

  // a crack and a long low rumble
  thunder(v = 1) {
    if (!this.ready) return;
    this._burst(0.35, 1800, 0.25 * v);
    this._burst(3.2, 140, 0.55 * v);
    setTimeout(() => this._burst(2.2, 90, 0.4 * v), 250);
  }

  // continuous layers, once per frame --------------------------------------
  update(dt, s) {
    if (!this.ready) return;
    const v = Math.abs(s.speed), electric = s.electric;
    // motor: pitch from wheel speed, loudness from load
    const rpm = Math.min(1, Math.abs(s.wheelSpeed) / (s.topSpeed * 1.1));
    if (electric) {
      const f = 55 + rpm * (s.big ? 300 : 380);
      this._set(this.m1.frequency, f); this._set(this.m2.frequency, f * 1.503);
      this._set(this.motorFilter.frequency, 500 + rpm * 2600 + s.throttle * 1200);
      this._set(this.motorGain.gain, s.active ? 0.015 + s.throttle * (0.07 + rpm * 0.05) + rpm * 0.02 : 0, 0.08);
      this._set(this.whine.frequency, 500 + rpm * 3400);
      this._set(this.whineGain.gain, s.active ? rpm * 0.018 + s.throttle * rpm * 0.03 : 0, 0.08);
    } else {
      this._set(this.motorGain.gain, 0); this._set(this.whineGain.gain, 0);
      // freewheel clicks when coasting, chain tick when pedalling
      this.clickT -= dt * (2 + v * (s.throttle > 0.1 ? 1.2 : 5));
      if (this.clickT <= 0 && v > 1 && s.grounded && s.active) { this.clickT = 1; this._tone(s.throttle > 0.1 ? 1400 : 3200, 0.015, 'square', s.throttle > 0.1 ? 0.012 : 0.02); }
    }
    this._set(this.wind.g.gain, s.active ? Math.min(0.22, v * v * 0.00035) : 0, 0.15);
    this._set(this.wind.f.frequency, 350 + v * 28);
    const offroad = s.surface === 2 || s.surface === 3;
    this._set(this.roll.g.gain, s.grounded && s.active && !offroad ? Math.min(0.2, v * 0.012) : 0, 0.08);
    this._set(this.roll.f.frequency, 160 + v * 26);
    this._set(this.dirt.g.gain, s.grounded && s.active && offroad ? Math.min(0.22, v * 0.02) : 0, 0.08);
    this._set(this.skid.g.gain, s.skid && s.active ? Math.min(0.2, 0.06 + v * 0.012) : 0, 0.04);
    this._set(this.skid.f.frequency, offroad ? 700 : 1700 + v * 30);
    // sirens fade with distance
    this.sirenLevel += ((s.siren || 0) - this.sirenLevel) * Math.min(1, dt * 3);
    this._set(this.sirenGain.gain, this.sirenLevel * 0.085, 0.1);
    this._set(this.heli.g.gain, (s.heli || 0) * 0.3, 0.2);
    this._set(this.heliLfo.gain, (s.heli || 0) * 0.25, 0.2);
  }
}
