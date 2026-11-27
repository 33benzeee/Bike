// Bike dynamics.
// The bike + rider is a rigid body in its own vertical plane: two wheels on
// spring/damper suspension, tyre forces applied at the contact patches. Wheelies,
// stoppies, loop-outs, squat and dive all fall out of that — nothing is scripted.
// Steering, lean and lateral grip are layered on top to move the plane around.
// Pure JS (no three.js) so it can be simulated headlessly.

import { SURF_GRIP, SURF_ROLL, circleVsObstacle } from './world/terrain.js';

export const G = 9.81;
const SUB = 1 / 240;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// semi-sim wheelie feel: liveliness vs Normal, throttle left past the balance point, and how
// much of the fall backwards the rider catches
// Spring and damper for one wheel. Deep in the travel, and against the bump stop, the rebound
// is heavily damped: arms, legs and tyres soak a big landing up instead of the bike pogoing
// back into the air. Around ride height it is the plain progressive spring it always was.
const LAND = { from: 0.55, rebound: 9, stop: 1.3 };
function springForce(k, c, travel, pen, vn, m) {
  const x = pen / travel, deep = Math.max(0, x - LAND.from);
  let F = k * pen * (1 + 1.2 * x * x) - c * vn * (vn > 0 ? 1.6 + LAND.rebound * deep * deep : 1);
  if (pen > travel) F += k * 10 * (pen - travel) - LAND.stop * Math.sqrt(k * 10 * m * 0.5) * vn;
  return F;
}
// how hard a held wheelie can still accelerate, as a fraction of g (Sim gets 60% of it)
const WHEELIE_ACC = 0.24;
const SPEEDMAX_G = [0, 1.5, 4.5]; // extra forward push with each speed code, in g
// leaning into turns (see 'steering and lean'): how far over a bike goes at most, how quickly the
// rider takes it there (natural frequency, rad/s), the rider's balance loop (natural frequency, damping), the
// speeds over which pointing the bars hands over to leaning (m/s), how far a wheelie leans,
// how hard a (75 kg) rider can tip the bike with their body (rad/s^2) and how much of the lock
// they'll use to countersteer
const LEAN = { max: 0.8, wref: 7, wn: 6, zeta: 0.9, v0: 1.5, v1: 4, wheelie: 0.9, body: 9, bars: 0.6 };
const AIR_RATE = 5.6; // rad/s: how fast a full lean flips the bike in the air (a flip in ~1.2 s)
const SEMI = { live: 1.2, past: 0.25, catch: 0.5, damp: 1.2 };
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const wc = { hc: 0, ns: 0, ny: 1, surface: 0 };
const hit = { nx: 0, nz: 0 };

export class BikePhysics {
  constructor(terrain) {
    this.terrain = terrain;
    this.spec = null;
    this.events = [];
    this.rag = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, rotVel: 0, yaw: 0, rest: 0 };
    this._resolve = this._resolve.bind(this);
    this.reset(0, 0, 0);
  }

  setSpec(spec) {
    this.spec = spec;
  }

  reset(x, z, yaw) {
    const sp = this.spec;
    this.x = x; this.z = z; this.yaw = yaw;
    // sit the wheels on whatever is under them (the spot may be on a slope)
    this.pitch = 0; this.y = this.terrain.height(x, z) + 1;
    if (sp) {
      const hx = Math.sin(yaw), hz = Math.cos(yaw), cx = sp.com[0], L = sp.wheelbase;
      const hR = this.terrain.height(x - hx * cx, z - hz * cx), hF = this.terrain.height(x + hx * (L - cx), z + hz * (L - cx));
      this.pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(hF - hR, L)));
      this.y = hR + (hF - hR) * (cx / L) + (sp.rR + sp.com[1]) * Math.cos(this.pitch) - 0.02;
    }
    this.vx = this.vy = this.vz = 0;
    this.pitchVel = 0;
    this.lean = 0; this.leanVel = 0; this.gripMul = this.gripMul ?? 1;
    this.steer = 0; this.steerVel = 0; this.steerAngle = 0; this.leanRef = 0; this.leanRefVel = 0; this.throttle = 0; this.brakeIn = 0; this.comShift = 0;
    this.cx = sp ? sp.com[0] : 0.45; this.cy = sp ? sp.com[1] : 0.5;
    this.rearPen = 0; this.frontPen = 0;
    this.rearContact = true; this.frontContact = true;
    this.rearFn = 0; this.frontFn = 0;
    this.airTime = 0; this.groundT = 0; this.wheelieT = 0;
    this.speed = 0; this.lat = 0;
    this.slipRear = false; this.rearLocked = false; this.frontLocked = false;
    this.wheelRotF = 0; this.wheelRotR = 0; this.spinF = 0; this.spinR = 0;
    this.hopCharge = 0; this._hopHeld = false;
    this.pullT = 0; this.pullDir = 0; this._leanPrev = 0;
    this.crashed = false; this.crashReason = ''; this.crashT = 0;
    this.surface = 0; this.yawRate = 0; this.airYaw = 0;
    this.groundPitch = 0; this.flipAccum = 0; this.airPeak = 0; this._airVy = 0; this._airU = 0; this._cn = 0; this._cny = 1; this._airStartPitch = 0;
    this.rsR = 0; this.ryR = 0; this.rsF = 0; this.ryF = 0;
    this.assistBrake = 0; this.effThrottle = 0; this.frontG = 1; this.committed = false; this.backT = 0; this.frontIn = 0; this.scraping = false; this.burning = false; this.scrapeT = 0;
    this.bikeRoll = 0; this.bikeYawVel = 0;
    this.events.length = 0;
  }

  // Pitch at which the centre of mass sits right over the rear contact patch.
  balanceAngle() {
    return Math.atan2(this.cx, this.cy);
  }

  _drive(th, vt) {
    if (th <= 0) return 0;
    const d = this.spec.drive;
    // BBV33SPEEDMAX: full pull at any speed, no top speed
    if (this.unlimited) return d.maxForce * 1.5 * th;
    let F = Math.min(d.maxForce, d.power / Math.max(vt, 0.5));
    if (vt > d.topSpeed * 0.9) F *= clamp((d.topSpeed * 1.02 - vt) / (d.topSpeed * 0.12), 0, 1);
    return F * th;
  }

  step(dt, inp, dyn) {
    if (!this.spec) return;
    if (this.crashed) { this._stepCrash(dt); return; }
    const sp = this.spec;

    // ---- input smoothing
    // steering input eases in and out (critically damped), so turns build smoothly
    {
      const wn = Math.abs(inp.steer) > Math.abs(this.steer) ? 11 : 14;
      this.steerVel += (wn * wn * (inp.steer - this.steer) - 2 * wn * this.steerVel) * dt;
      this.steer = clamp(this.steer + this.steerVel * dt, -1, 1);
    }
    const tr = sp.drive.type === 'pedal' ? 6 : 7;
    this.throttle += clamp(inp.throttle - this.throttle, -dt * 25, dt * tr);
    this.brakeIn += clamp(inp.brake - this.brakeIn, -dt * 20, dt * 11);
    // the stoppie button is a front-brake lever of its own
    this.frontIn += clamp((inp.stoppie ? 1 : 0) - this.frontIn, -dt * 20, dt * 11);
    this.comShift += clamp(inp.lean - this.comShift, -dt * 5.5, dt * 5.5);

    // a fresh tug on the bars / shove forward gives a short torque impulse
    if (inp.lean > 0.5 && this._leanPrev <= 0.5) { this.pullT = 0.55; this.pullDir = 1; }
    else if (inp.lean < -0.5 && this._leanPrev >= -0.5) { this.pullT = 0.3; this.pullDir = -1; }
    else if (Math.abs(inp.lean) < 0.5) this.pullT = 0;
    this._leanPrev = inp.lean;
    if (inp.lean > 0.5 && this.rearContact) this.committed = true;
    else if (this.frontG > 0.9 && inp.lean <= 0.5) this.committed = false;

    // ---- bunny hop: hold to crouch, release to pop
    const grounded = this.rearContact || this.frontContact;
    // stopped with the brake held: paddle backwards so you can get off a wall
    if (grounded && inp.brake > 0.5 && inp.throttle < 0.05 && this.speed < 0.4 && this.speed > -2.5) this.backT += dt; else this.backT = 0;
    if (inp.hop) {
      if (grounded) this.hopCharge = Math.min(0.3, this.hopCharge + dt);
      this._hopHeld = true;
    } else if (this._hopHeld) {
      this._hopHeld = false;
      if (this.groundT < 0.12) {
        const k = 0.62 + 0.38 * (this.hopCharge / 0.3);
        this.vy += sp.hop * k;
        if (this.frontContact) this.pitchVel += 0.7 * k;
        this.events.push({ type: 'hop', power: k });
      }
      this.hopCharge = 0;
    }

    const n = Math.max(1, Math.round(dt / SUB));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._sub(h, inp);

    this._collide(dyn);
    if (!this.crashed) this._checks(dt);
  }

  _sub(h, inp) {
    const sp = this.spec, T = this.terrain, m = sp.totalMass, I = sp.inertia, L = sp.wheelbase;
    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw);
    const lx = hz, lz = -hx; // rider's left
    let u = this.vx * hx + this.vz * hz;
    let w = this.vx * lx + this.vz * lz;
    let vy = this.vy;

    const ct = Math.cos(this.pitch), st = Math.sin(this.pitch);
    let cx = sp.com[0] - this.comShift * sp.leanShift + (inp.comDX || 0);
    // climbing something steep, the rider gets over the bars to keep the front down. Judged
    // from the ground under the bike, not the bike's own pitch: if the front goes light on a
    // climb they stay forward instead of sitting back and letting it bounce
    // how steeply the ground under the bike climbs (radians), measured a little past both wheels
    // so a kerb or a stair edge doesn't read as a hill
    let gA = 0;
    {
      const bR = sp.com[0] + 0.6, bF = L - sp.com[0] + 0.6, gR = T.height(this.x - hx * bR, this.z - hz * bR), gF = T.height(this.x + hx * bF, this.z + hz * bF);
      gA = Math.atan2(gF - gR, bR + bF);
    }
    if (inp.assist > 0 && !this.committed) {
      const byBike = st > 0 && this.frontG > 0.3 ? Math.min(0.28, st * 0.62) * this.frontG : 0;
      cx += Math.max(byBike, gA > 0 ? Math.min(0.28, Math.sin(gA) * 0.62) : 0);
    }
    this.groundPitch = gA;
    const gUp = Math.max(0, gA); // a wheelie up a hill is measured from the hill, not from level
    // on the gas without pulling up, a rider on a torquey bike tucks forward over the tank so
    // the pull goes into speed instead of lifting the front
    // (not up a hill: they're already leaning into the climb, and more weight off the back tyre spins it)
    if (sp.tuck && !this.committed && this.throttle > 0.5) cx += sp.tuck * (this.throttle - 0.5) * 2 * clamp(1 - gUp / 0.2, 0, 1);
    const cy = sp.com[1] + (inp.comDY || 0);
    this.cx = cx; this.cy = cy;

    let Fs = this.unlimited ? 0 : -0.6 * sp.cdA * u * Math.abs(u); // no air resistance with the speed code
    const backing = this.backT > 0.4;
    if (backing) Fs += m * clamp((-1.5 - u) * 4, -3, 3);
    let Fy = -m * G;
    let tq = 0;

    // ---- throttle / brake with optional balance assist
    let th = this.throttle, br = this.brakeIn;
    let bF, bR;
    const assist = inp.assist || 0;
    if (backing) br = 0;
    // burnout: front brake clamped, rear wheel lit up
    const burn = !!inp.burnout && sp.drive.type === 'electric' && this.frontContact && this.rearContact && Math.abs(u) < 4.5 && th > 0.05;
    this.burning = burn;
    if (!this.frontContact || inp.rearOnly) { bF = 0; bR = br; } else { bF = br; bR = br * 0.6; }
    if (this.frontContact && this.frontIn > bF) bF = this.frontIn; // front lever: front wheel only, never the rear
    if (burn) { bF = 1; bR = 0; }
    this.assistBrake = 0;
    // Rider "wrist" layer. 0 = raw sim, 0.5 = semi-sim, 1 = shaped throttle, 2 = shaped + auto
    // balance. Semi-sim keeps Normal's manners everywhere except in a pulled wheelie, where the
    // bike is livelier and the rider only half-catches it past the balance point: it goes
    // over if you stay on the gas, but slowly enough to save with the brake.
    // In a wheelie the throttle asks for the force that holds the current angle plus
    // a bike-specific surplus, so a digital key is still controllable — punchier
    // bikes get a bigger surplus and are easier to loop.
    let driveCap = Infinity;
    const semi = assist > 0 && assist < 1;
    // With both wheels down, the extra pull (beyond what the climb itself takes) that would lift
    // the front. On a hill only the part of the weight pressing into the slope holds the front
    // down (weight * cos(slope)), while the part along it eats into the drive, so up a steep
    // hill there is little pull to spare before the front comes up. On the flat this is just
    // weight * (centre of mass ahead of the rear tyre) / (its height).
    let liftF;
    {
      const pr = this.pitch - gA, cr = Math.cos(pr), sr = Math.sin(pr);
      liftF = m * G * Math.max(0.03, (Math.cos(gA) * Math.max(0.06, cx * cr - cy * sr)) / (cx * sr + cy * cr + sp.rR) - Math.max(0, Math.sin(gA)));
    }
    if (assist > 0) {
      if (this.rearContact && !this.frontContact) {
        const xc = cx * ct - cy * st, yc = cx * st + cy * ct + sp.rR;
        const Ie = I + m * xc * xc; // the contact patch rolls, so only the vertical arm adds inertia
        const Fhold = xc > 0 ? (m * G * xc) / yc : 0;
        if (assist >= 2 && th > 0.1) {
          const bp = Math.atan2(cx, cy);
          const tgt = this.committed ? bp - (u < sp.drive.topSpeed * 0.8 ? 0.07 : 0.01) : (sp.unruly || 0) * 1.6 + 0.03 + gUp;
          const a = clamp(14 * (tgt - this.pitch) - 6 * this.pitchVel, -9, sp.wheelieGain);
          let F = Fhold + (a * Ie) / yc;
          if (F < 0) {
            const ab = clamp(-F / (sp.brake * 0.6 * m * G), 0, 1);
            if (ab > bR) { bR = ab; this.assistBrake = ab; }
            F = 0;
          }
          driveCap = F; th = 1;
        } else if (th > 0) {
          // surplus fades as the bike approaches its rotation-rate limit
          const live = semi ? SEMI.live : 1;
          let surplus = sp.wheelieGain * live * (1 - this.pitchVel / (sp.wheelieRate * live));
          // past the balance point the rider is already rolling off
          if (xc < 0) surplus *= semi ? SEMI.past : 0.12;
          // not pulled up on purpose: float a low power-wheelie instead of looping
          if (!this.committed) surplus = clamp(10 * ((sp.unruly || 0) * 1.6 + 0.03 + gUp - this.pitch) - 4 * this.pitchVel, -sp.wheelieGain, surplus);
          driveCap = Math.max(0, th * (Fhold + (surplus * Ie) / yc)); th = 1;
        }
        if (!this.committed) {
          // front came up by accident (kerb, landing): the rider dabs the rear brake
          const over = this.pitch - Math.atan2(cx, cy) + 0.12;
          const ab = over > 0 ? clamp(5 * over + this.pitchVel * 0.6, 0, 1) : 0;
          if (ab > bR) { bR = ab; this.assistBrake = ab; }
        }
      } else if (this.frontContact) {
        // drive force that would just lift the front, plus what the slope itself needs
        const slope = m * G * Math.max(0, st), lift = liftF;
        // seated and not pulling, the rider keeps the front down (mostly — the
        // big bikes still power-wheelie unless you lean over the bars)
        if (inp.lean < 0.3) driveCap = slope + lift * (0.8 + (sp.unruly || 0) * (1 + Math.min(0, inp.lean)));
        else driveCap = slope + lift * 1.5;
      }
    } else if (this.committed && th > 0 && this.rearContact) {
      // Sim, wheelie pulled on purpose: twice as lively as Normal and no help past
      // the balance point, but the motor can't flip the bike faster than a rider
      // could ever react.
      const xc = cx * ct - cy * st, yc = cx * st + cy * ct + sp.rR;
      if (!this.frontContact) {
        const Ie = I + m * xc * xc, Fhold = xc > 0 ? (m * G * xc) / yc : 0;
        driveCap = Math.max(0, th * (Fhold + (2 * sp.wheelieGain * (1 - this.pitchVel / (2 * sp.wheelieRate)) * Ie) / yc));
      } else driveCap = m * G * Math.max(0, st) + liftF * 2;
    } else if (!this.committed && th > 0) {
      // Sim: raw once you pull the bike up yourself. Until then the rider's weight
      // is forward, so full throttle pops the front but never carries it to the
      // balance point.
      const xc = cx * ct - cy * st, yc = cx * st + cy * ct + sp.rR;
      if (this.rearContact && !this.frontContact) {
        const Ie = I + m * xc * xc, Fhold = xc > 0 ? (m * G * xc) / yc : 0;
        const soft = 0.12 + (sp.unruly || 0) * 1.2 + gUp;
        const a = clamp(10 * (soft - this.pitch) - 4 * this.pitchVel, -2 * sp.wheelieGain, 2 * sp.wheelieGain);
        driveCap = Math.max(0, Fhold + (a * Ie) / yc);
      } else if (this.frontContact) {
        driveCap = m * G * Math.max(0, st) + liftF * (1.1 + (sp.unruly || 0));
      }
    }
    this.effThrottle = th;

    let fnTotal = 0, surfGrip = 1;
    let rearC = false, frontC = false;
    this.slipRear = false; this.rearLocked = false; this.frontLocked = false;

    // ---- walls. A wheel can roll up kerbs, stairs and ramps, but a face taller
    // than its axle is a wall: stop against it instead of being fired upwards.
    {
      const dir = u >= 0 ? 1 : -1;
      for (let k = 0; k < 2; k++) {
        const rs = k === 0 ? (L - cx) * ct + cy * st : -cx * ct + cy * st, ry = k === 0 ? (L - cx) * st - cy * ct : -cx * st - cy * ct;
        const r = k === 0 ? sp.rF : sp.rR, wy = this.y + ry;
        let wx = this.x + hx * rs, wz = this.z + hz * rs, hit = false;
        for (let n = 0; n < 8; n++) {
          // look just past the tyre's leading edge, further than the contact probe reaches
          const reach = r + 0.09;
          // measured from the ground under the wheel, so a compressed fork on a
          // ramp isn't mistaken for hitting a wall
          const hc = T.height(wx, wz), top = Math.max(wy, hc + r * 0.9) + 0.03;
          const ahead = (f) => T.height(wx + hx * dir * reach * f, wz + hz * dir * reach * f);
          const h1 = ahead(1), hm = ahead(0.5);
          if (hc <= wy + 0.03 && h1 <= top && hm <= top) break;
          // a steep but smooth face (quarter pipe, bank) is there to be ridden up: only a
          // near-vertical step, steeper than about 63 degrees, counts as a wall. A tyre pushed
          // into a smooth slope by a hard landing isn't in a wall either: then the ground just
          // behind it has to be smooth too.
          {
            const q1 = ahead(0.25), q3 = ahead(0.75), steps = Math.max(q1 - hc, hm - q1, q3 - hm, h1 - q3);
            if (hc <= wy + 0.03 ? steps < reach * 0.5 : Math.max(steps, hc - ahead(-0.25), ahead(-0.25) - ahead(-0.5)) < reach * 0.5) break;
          }
          const back = r * 0.2 * dir;
          wx -= hx * back; wz -= hz * back; this.x -= hx * back; this.z -= hz * back; hit = true;
        }
        if (hit && u * dir > 0) {
          if (Math.abs(u) > sp.crashSpeed) { this.vx *= 0.3; this.vz *= 0.3; this._crash('hit', Math.abs(u)); return; }
          if (Math.abs(u) > 0.8) this.events.push({ type: 'bump', speed: Math.abs(u), ref: null, cop: false });
          u = -0.12 * u; if (this.pitchVel * dir > 0) this.pitchVel *= 0.3;
        }
      }
    }

    // ---- rear wheel
    this._cn = 0; this._cny = 1; // ground normal under the wheels (heading, up), for landings
    const rsR = -cx * ct + cy * st, ryR = -cx * st - cy * ct;
    this.rsR = rsR; this.ryR = ryR;
    {
      const r = sp.rR;
      T.wheel(this.x + hx * rsR, this.z + hz * rsR, hx, hz, r, wc);
      const pen = (wc.hc - (this.y + ryR)) * wc.ny;
      if (pen > 0) {
        const ns = wc.ns, ny = wc.ny, su = sp.susp;
        this._cn = ns; this._cny = ny;
        const vs = u - this.pitchVel * ryR, vv = vy + this.pitchVel * rsR;
        const vn = vs * ns + vv * ny, vt = vs * ny - vv * ns;
        let Fn = springForce(su.kR, su.cR, su.tR, pen, vn, m);
        Fn = clamp(Fn, 0, m * G * 14);
        let g = SURF_GRIP[wc.surface] * this.gripMul; // wet roads lower it
        if (wc.surface === 2 || wc.surface === 3) g = Math.min(1, g * sp.offroad);
        surfGrip = g;
        const lim = sp.grip * g * Fn;
        const Fd = Math.min(this._drive(th, vt), driveCap);
        // in a wheelie the rear brake is a fine tool: cap how hard it can snap the front down
        let bMax = sp.brake * 0.56 * m * G;
        if (!this.frontContact) { const xw = cx * ct - cy * st; bMax = Math.min(bMax, (9 * (I + m * xw * xw)) / (cx * st + cy * ct + r)); }
        const Fb = bR > 0 ? -Math.sign(vt) * Math.min(bR * bMax, (Math.abs(vt) * m * 0.5) / h) : 0;
        const coast = th < 0.05 ? (sp.drive.type === 'pedal' ? 0 : 0.02 * m * G) : 0;
        const roll = -Math.tanh(vt * 4) * (SURF_ROLL[wc.surface] * Fn + coast);
        let Ft = Fd + Fb + roll;
        if (burn) { Ft = lim * 0.1 * th + roll; this.slipRear = true; }
        else if (Ft > lim) { Ft = lim * 0.9; this.slipRear = true; }
        else if (Ft < -lim) { Ft = -lim * 0.9; this.rearLocked = Math.abs(vt) > 1.5; }
        else if (bR > 0.85 && Math.abs(vt) > 2 && !this.assistBrake) this.rearLocked = true;
        const fs = Fn * ns + Ft * ny, fy = Fn * ny - Ft * ns;
        Fs += fs; Fy += fy;
        tq += (rsR - ns * r) * fy - (ryR - ny * r) * fs;
        // On the gas in a pulled wheelie the rider shifts forward to hold the angle, so the
        // motor's spare pull goes into speed instead of lifting the front further. Without
        // this, holding the balance point with the throttle open never gains any speed.
        if (this.committed && !this.frontContact && !burn && this.throttle > 0.05 && Ft >= 0) {
          const spare = Math.max(0, this._drive(this.throttle, vt) - Fd);
          const Fx = Math.max(0, Math.min(spare, m * G * WHEELIE_ACC * (assist > 0 ? 1 : 0.6) * this.throttle, lim * 0.9 - Ft));
          Fs += Fx * ny; Fy -= Fx * ns;
        }
        fnTotal += Fn; rearC = true;
        this.rearPen = pen; this.rearFn = Fn; this.surface = wc.surface;
        if (burn) this.spinR += ((th * sp.drive.topSpeed * 1.15) / r - this.spinR) * Math.min(1, 5 * h);
        else this.spinR = this.slipRear ? Math.max(this.spinR, vt / r) + 60 * h : this.rearLocked ? 0 : vt / r;
      } else { this.rearPen = 0; this.rearFn = 0; this.spinR += (th * 40 - bR * 200 - this.spinR * 0.3) * h; if (this.spinR < 0) this.spinR = 0; }
    }

    // ---- front wheel
    const rsF = (L - cx) * ct + cy * st, ryF = (L - cx) * st - cy * ct;
    this.rsF = rsF; this.ryF = ryF;
    {
      const r = sp.rF;
      T.wheel(this.x + hx * rsF, this.z + hz * rsF, hx, hz, r, wc);
      const pen = (wc.hc - (this.y + ryF)) * wc.ny;
      if (pen > 0) {
        const ns = wc.ns, ny = wc.ny, su = sp.susp;
        this._cn = ns; this._cny = ny;
        const vs = u - this.pitchVel * ryF, vv = vy + this.pitchVel * rsF;
        const vn = vs * ns + vv * ny, vt = vs * ny - vv * ns;
        let Fn = springForce(su.kF, su.cF, su.tF, pen, vn, m);
        Fn = clamp(Fn, 0, m * G * 14);
        let g = SURF_GRIP[wc.surface] * this.gripMul; // wet roads lower it
        if (wc.surface === 2 || wc.surface === 3) g = Math.min(1, g * sp.offroad);
        if (!rearC) surfGrip = g;
        const lim = sp.grip * g * Fn;
        let Fb = 0;
        if (bF > 0) {
          let maxB = bF * sp.brake * 0.9 * m * G;
          const tip = (m * G * rsF) / (r - ryF); // front-brake force that just lifts the rear
          if (inp.stoppie) {
            // stoppie button: grab enough front brake to lift the tail, then hold it
            // near a comfortable angle
            if (!this.rearContact && this.pitch < -0.04) {
              const Ie = I + m * rsF * rsF;
              const a = clamp(-12 * (this.pitch + 0.55) - 5 * this.pitchVel, -4, 7);
              maxB = Math.min(maxB, Math.max(0, tip - (a * Ie) / (r - ryF)) * bF);
            } else maxB = Math.min(maxB, tip * 1.4);
          } else {
            // ordinary braking never goes over the bars: stay under the tipping
            // point, and let go if the rear wheel comes up anyway
            let cap = tip * 0.78;
            if (!this.rearContact) cap = tip * clamp(0.45 + this.pitchVel * 0.6, 0.08, 0.45);
            maxB = Math.min(maxB, cap);
          }
          Fb = -Math.sign(vt) * Math.min(maxB, (Math.abs(vt) * m * 0.5) / h);
        }
        let Ft = Fb - Math.tanh(vt * 4) * SURF_ROLL[wc.surface] * Fn;
        if (Ft < -lim) { Ft = -lim * 0.9; this.frontLocked = Math.abs(vt) > 2; }
        else if (Ft > lim) Ft = lim * 0.9;
        const fs = Fn * ns + Ft * ny, fy = Fn * ny - Ft * ns;
        Fs += fs; Fy += fy;
        tq += (rsF - ns * r) * fy - (ryF - ny * r) * fs;
        fnTotal += Fn; frontC = true;
        this.frontPen = pen; this.frontFn = Fn;
        if (!rearC) this.surface = wc.surface;
        this.spinF = this.frontLocked ? 0 : vt / r;
      } else { this.frontPen = 0; this.frontFn = 0; this.spinF *= 1 - (this.frontIn > 0.3 ? Math.min(1, 14 * h) : 0.15 * h); } // in the air the lever just stops the wheel
    }
    this.rearContact = rearC; this.frontContact = frontC;
    const any = rearC || frontC;

    // ---- rider torques
    if (this.pullT > 0) {
      // The rider throws their weight to rotate the bike: a velocity servo that
      // lifts the front toward the balance point (or shoves it back down).
      if (any) {
        const gq = m * G * Math.max(cx, 0.1);
        const Ie = I + m * cx * cx;
        if (this.pullDir > 0) {
          const bp = Math.atan2(cx, cy);
          const wT = 1.6 * clamp(1 - this.pitch / (0.8 * bp), 0, 1);
          tq += clamp((wT - this.pitchVel) * Ie * 14, 0, gq * sp.pullTorque);
        } else if (this.pitch > 0.05) {
          tq -= clamp((this.pitchVel + 1.5) * Ie * 14, 0, gq * 0.8);
        }
      }
      this.pullT -= h;
    }
    if (!any) {
      // Body english in the air. Leaning asks for a rotation *rate*, it doesn't keep winding
      // the bike up: the spin builds to a steady speed in about a quarter of a second and
      // from then on the angle changes linearly. Let go and it carries on at that speed.
      if (Math.abs(inp.lean) > 0.05) {
        const d = inp.lean * AIR_RATE - this.pitchVel;
        // only ever push towards the asked-for rate, never speed up a faster spin
        if (d * inp.lean > 0) tq += I * clamp(d * 14, -22, 22);
      }
      // throttle and brake nudge the pitch through the rear wheel, but only up to a slow turn
      if (this.airTime > 0.2) { const k = this.effThrottle - this.brakeIn; tq += k * I * 0.7 * clamp(1 - (this.pitchVel * Math.sign(k)) / 1.2, 0, 1); }
      if (Math.abs(inp.lean) < 0.15 && assist > 0 && this.airTime > 0.06 && Math.abs(this.pitch) < 1.3) {
        tq += I * (-12 * (this.pitch - 0.05) - 5.5 * this.pitchVel);
      }
      tq -= this.pitchVel * I * 0.25;
    } else {
      tq -= this.pitchVel * I * sp.pitchDamp * (rearC && !frontC ? 1 : 0.4);
      if (assist > 0 && rearC && !frontC) {
        // past the balance point the rider instinctively shifts forward, which
        // slows the fall backwards enough to catch it with the brake
        const xc = cx * ct - cy * st;
        if (xc < 0) { tq += (semi ? SEMI.catch : 0.7) * m * G * xc; if (this.pitchVel > 0) tq -= this.pitchVel * I * (semi ? SEMI.damp : 1.6); }
      }
      // tail on the tarmac: it props the bike up like a spring and drags
      this.scraping = rearC && !frontC && this.pitch > sp.loopAngle - 0.06;
      if (!this.scraping) this.scrapeT = Math.max(0, this.scrapeT - 2 * h);
      if (this.scraping) {
        const d = this.pitch - (sp.loopAngle - 0.06);
        // staying on the gas while the tail drags walks the bike over backwards
        this.scrapeT = clamp(this.scrapeT + h * (this.throttle > 0.5 ? 1 : -1.5), 0, 4);
        const tip = 0.3 * m * G * Math.max(0.05, cy * st - cx * ct); // what gravity is pushing back with
        tq -= tip * (d / 0.05 - 1.7 * this.scrapeT) + I * 8 * Math.max(0, this.pitchVel);
        Fs -= m * 1.3 * (1 - 0.9 * this.throttle) * Math.tanh(u); // hold the throttle to keep a scrape going
      }
      // rider soaks up kicks from curbs and stairs instead of going over the bars
      if (frontC && !rearC && !inp.stoppie && this.pitch < -0.06) tq += I * clamp(-10 * this.pitch - 4.5 * this.pitchVel, -20, 34);
      if (inp.wobble > 0 && rearC && !frontC) tq += (Math.random() - 0.5) * I * 5 * inp.wobble;
    }

    // BBV33SPEEDMAX (level 1) / BBV33SPEEDEVENMORE (level 2): an extra push through the centre of
    // mass on top of the motor, so it pulls hard without spinning the tyre or lifting the front.
    // Only with the driven rear wheel on the ground: a stoppie or a jump gets nothing.
    if (this.unlimited && this.throttle > 0.05 && rearC) Fs += m * G * SPEEDMAX_G[this.unlimited] * this.throttle;
    // ---- integrate the plane
    u += (Fs / m) * h;
    vy += (Fy / m) * h;
    this.pitchVel += (tq / I) * h;

    // ---- lateral grip
    let latA = sp.grip * surfGrip * (fnTotal / m) * 1.7;
    if (this.rearLocked || this.slipRear) latA *= 0.5;
    w -= clamp(w, -latA * h, latA * h);

    // ---- steering and lean
    const au = Math.abs(u);
    let yawRate;
    if (any) {
      // A bike turns by leaning. It's an upside-down pendulum on its tyres: gravity tips it
      // further over, and the turn's centripetal pull stands it back up. It holds a lean only
      // when the two balance, tan(lean) = speed * yaw rate / g. The bars are how the rider gets
      // there: to lean left at speed they first flick the bars right (countersteer), the bike
      // falls left, then they turn left to catch it. The player asks for a turn; the rider
      // below works the bars to get the lean it needs. At walking pace there's no balance to
      // speak of: the rider just points the bars and holds the bike up.
      this.frontG += ((frontC ? 1 : 0) - this.frontG) * Math.min(1, 12 * h);
      const fg = this.frontG, hc = (cy + sp.rR) * 1.15; // pendulum length (rider + bike)
      const kGeo = Math.tan(sp.steerMax) / L;
      const maxLean = Math.min(Math.atan(sp.grip * surfGrip * 1.3), LEAN.max);
      // as far over as grip, and the steering lock at this speed, allow
      const leanCap = Math.min(maxLean, Math.atan((u * u * kGeo) / G));
      // the rider eases the bike over rather than throwing it: a smooth lean they can follow
      const want = this.steer * leanCap, wr = LEAN.wref, r = this.leanRef;
      // They tip the bike partly with their body (hips and knees: easy on a light bike, hard on
      // a heavy one) and the rest with the bars. The slower they go the more the body (and a dab
      // of a foot) does, until at walking pace they just point the bars and hold the bike up.
      const b = u > 0 ? smooth(LEAN.v0, LEAN.v1, u) : 0;
      const body = LEAN.body * Math.min(1, 75 / m) + (1 - b) * 60, u2 = Math.max(u * u, 0.04);
      const aBars = (u2 * Math.tan(sp.steerMax * LEAN.bars)) / L;
      // never ask for more lean than body and bars can deliver between them
      let refAcc = wr * wr * (want - r) - 2 * wr * this.leanRefVel;
      refAcc = clamp(refAcc, (G * Math.sin(r) - aBars * Math.cos(r)) / hc - body, (G * Math.sin(r) + aBars * Math.cos(r)) / hc + body);
      this.leanRefVel += refAcc * h; this.leanRef += this.leanRefVel * h;
      const bodyFF = clamp(refAcc, -body, body);
      // the sideways pull that makes the bike follow that lean: the turn that holds it up, less
      // a bit to let it fall in, more to stand it up (that's the countersteer)...
      const aNeed = (G * Math.sin(r) - hc * (refAcc - bodyFF)) / Math.cos(r);
      let delta = Math.atan((aNeed * L) / u2);
      // ...plus a correction if the bike has drifted off it: steer into the lean to stand it up.
      // Slow, the body makes that correction instead.
      const wn = LEAN.wn, z = LEAN.zeta, e = this.lean - r, ev = this.leanVel - this.leanRefVel;
      delta += b * ((L * hc * wn * wn) / u2 * e + (L * hc * 2 * z * wn) / u2 * ev);
      if (au < 0.5) delta = this.steer * sp.steerMax; // walking it, or stopped
      delta = clamp(delta, -sp.steerMax, sp.steerMax);
      this.steerAngle = delta;
      this._bodyAcc = clamp(bodyFF - (1 - b) * (wn * wn * e + 2 * z * wn * ev), -body, body);
      // with the front up there are no bars: the rider leans the bike with their body, and it
      // turns at the rate that holds that lean up (the rear tyre's camber carries it round)
      const yawFront = (u * Math.tan(delta)) / L;
      const yawRear = (G * Math.tan(this.lean)) / Math.max(au, 2) * (u < 0 ? -1 : 1);
      yawRate = yawFront * fg + yawRear * (1 - fg);
      // the pendulum: gravity tips it over, the turn stands it up, the rider's body pushes it
      const aLat = u * yawRate;
      let la = (G * Math.sin(this.lean) - aLat * Math.cos(this.lean)) / hc + this._bodyAcc;
      // on the back wheel the rider throws the bike's lean around with their body instead
      if (fg < 1) {
        const wl = sp.leanRate, tgt = this.steer * sp.wheelieSteer * LEAN.wheelie;
        la = la * fg + (wl * wl * (tgt - this.lean) - 2 * wl * this.leanVel) * (1 - fg);
      }
      if (inp.wobble > 0 && !frontC) la += (Math.random() - 0.5) * 14 * inp.wobble;
      this.leanVel += la * h;
      this.lean = clamp(this.lean + this.leanVel * h, -LEAN.max - 0.2, LEAN.max + 0.2);
      if (this.rearLocked && frontC && au > 3) yawRate += this.steer * 1.5 * Math.min(1, au / 8);
      if (this.burning) yawRate += this.steer * 2.4 * this.throttle; // swing the back end round: donuts
      this.airYaw = 0;
    } else {
      // airborne: a little whip, lean follows
      this.airYaw += (this.steer * 0.7 - this.airYaw) * Math.min(1, 6 * h);
      this.leanRef = this.lean; this.leanRefVel = this.leanVel; this.steerAngle += (this.steer * sp.steerMax * 0.4 - this.steerAngle) * Math.min(1, 8 * h);
      yawRate = this.airYaw;
      const la = 36 * (this.steer * 0.35 - this.lean) - 9 * this.leanVel;
      this.leanVel += la * h;
      this.lean += this.leanVel * h;
    }
    this.yawRate = yawRate;

    this.vx = hx * u + lx * w; this.vz = hz * u + lz * w; this.vy = vy;
    this.x += this.vx * h; this.y += vy * h; this.z += this.vz * h;
    this.pitch += this.pitchVel * h;
    this.yaw += yawRate * h;
    this.speed = u; this.lat = w;
    this.wheelRotR += this.spinR * h; this.wheelRotF += this.spinF * h;
  }

  // ---- obstacle collisions (buildings, cars, poles...) ----------------
  _collide(dyn) {
    const sp = this.spec, T = this.terrain;
    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw);
    for (let i = 0; i < 3 && !this.crashed; i++) {
      let px, pz, yb, yt, pr;
      if (i === 0) { px = this.x + hx * this.rsR; pz = this.z + hz * this.rsR; yb = this.y + this.ryR - sp.rR; yt = yb + 2 * sp.rR; pr = 0.2; }
      else if (i === 1) { px = this.x + hx * this.rsF; pz = this.z + hz * this.rsF; yb = this.y + this.ryF - sp.rF; yt = yb + 2 * sp.rF; pr = 0.2; }
      else { px = this.x; pz = this.z; yb = this.y - 0.35; yt = this.y + 0.85; pr = 0.3; }
      this._pi = i; this._px = px; this._pz = pz; this._pr = pr; this._yb = yb; this._yt = yt;
      T.query(px, pz, pr + 0.1, this._resolve);
      if (dyn) for (let j = 0; j < dyn.length && !this.crashed; j++) this._resolve(dyn[j]);
    }
  }

  _resolve(o) {
    if (this.crashed || o.carOnly) return;
    if (o.y1 < this._yb + 0.07 || o.y0 > this._yt) return;
    const pen = circleVsObstacle(o, this._px, this._pz, this._pr, hit);
    if (pen <= 0) return;
    const nx = hit.nx, nz = hit.nz;
    this.x += nx * pen; this.z += nz * pen;
    this._px += nx * pen; this._pz += nz * pen;
    const ovx = o.vx || 0, ovz = o.vz || 0;
    const vn = (this.vx - ovx) * nx + (this.vz - ovz) * nz;
    if (vn < 0) {
      const imp = -vn;
      if (imp > this.spec.crashSpeed) {
        this.vx = this.vx * 0.5 + ovx * 0.5; this.vz = this.vz * 0.5 + ovz * 0.5;
        this._crash('hit', imp, o);
        return;
      }
      this.vx -= 1.15 * vn * nx; this.vz -= 1.15 * vn * nz;
      this.vx *= 0.985; this.vz *= 0.985;
      if (this._pi === 1) {
        const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw);
        const hn = hx * nx + hz * nz;
        if (hn < 0) this.yaw = Math.atan2(hx - hn * nx * 0.5, hz - hn * nz * 0.5);
      }
      if (imp > 0.6) this.events.push({ type: 'bump', speed: imp, ref: o.ref || null, cop: !!o.cop });
    }
  }

  _checks(dt) {
    const sp = this.spec;
    const rc = this.rearContact, fc = this.frontContact, any = rc || fc;
    if (any) {
      if (this.airTime > 0.22) {
        // how hard you hit is the speed into the ground: landing on a down-slope (the back of
        // a jump) is soft, flat ground hurts more, and casing into an up-slope hurts most
        const impact = -(this._airU * this._cn + this._airVy * this._cny);
        const drop = this.airPeak - this.y;
        this.events.push({ type: 'land', airTime: this.airTime, impact, drop, flips: this.flipAccum });
        if (impact > sp.maxImpact) { this._crash('slam', impact); return; }
        if (Math.abs(this.lat) > 5 && Math.abs(this.lat) > 0.7 * Math.abs(this.speed)) { this._crash('sideways', Math.abs(this.lat)); return; }
      }
      this.airTime = 0; this.groundT = 0; this.flipAccum = 0;
      this.airPeak = this.y;
    } else {
      if (this.airTime === 0) { this.airPeak = this.y; }
      this.airTime += dt; this.groundT += dt;
      this._airVy = this.vy; this._airU = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
      if (this.y > this.airPeak) this.airPeak = this.y;
      // count full rotations
      if (this.pitch > Math.PI) { this.pitch -= 2 * Math.PI; this.flipAccum += 1; this.events.push({ type: 'flip', dir: 1 }); }
      else if (this.pitch < -Math.PI) { this.pitch += 2 * Math.PI; this.flipAccum += 1; this.events.push({ type: 'flip', dir: -1 }); }
    }
    // measured from the ground under the bike: a light front wheel on a steep climb isn't a wheelie
    this.wheelieT = rc && !fc && this.pitch - this.groundPitch > 0.17 ? this.wheelieT + dt : 0;

    // the tail can drag on the ground (12 o'clock); only going well past it, or
    // running out of speed while scraping, throws you off the back
    if (rc && (this.pitch > sp.loopAngle + 0.12 || (this.scraping && Math.abs(this.speed) < 1.2))) { this._crash('loopout', Math.abs(this.speed)); return; }
    if (fc && !rc && this.pitch < -1.12) { this._crash('endo', Math.abs(this.speed)); return; }
    if (Math.abs(this.lat) > 7.5 && any) { this._crash('slide', Math.abs(this.lat)); return; }
    // rider's head hitting the ground (upside-down or flat landings)
    const st = Math.sin(this.pitch), ct = Math.cos(this.pitch);
    // past ~70° the rider of a bike that goes past vertical keeps leaning back (see rider.js),
    // so their head turns forward relative to the bike
    const ra = rc && !fc && sp.loopAngle > 1.6 ? Math.max(0, this.pitch - 1.2) * 0.95 : 0;
    const fx = 0.05 * Math.cos(ra) + 0.75 * Math.sin(ra), fy = 0.75 * Math.cos(ra) - 0.05 * Math.sin(ra);
    const hs = fx * ct - fy * st, hy = fx * st + fy * ct;
    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw);
    if (this.y + hy < this.terrain.height(this.x + hx * hs, this.z + hz * hs) + 0.12) { this._crash('slam', Math.hypot(this.vx, this.vy, this.vz)); return; }
    if (this.y < this.terrain.height(this.x, this.z) + 0.3) this._crash('slam', Math.hypot(this.vx, this.vy, this.vz));
  }

  crash(reason = 'hit') { if (!this.crashed) this._crash(reason, Math.hypot(this.vx, this.vz)); }

  _crash(reason, speed, obstacle) {
    this.crashed = true; this.crashReason = reason; this.crashT = 0;
    const r = this.rag;
    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw);
    r.x = this.x; r.y = this.y + 0.2; r.z = this.z; r.yaw = this.yaw;
    r.vx = this.vx * 0.8; r.vz = this.vz * 0.8; r.vy = Math.max(this.vy, 0) + 2.2;
    r.rot = 0; r.rest = 0;
    if (reason === 'loopout') { r.vx -= hx * 1.5; r.vz -= hz * 1.5; r.vy = 1.2; r.rotVel = -4; }
    else if (reason === 'endo') { r.vx += hx * 2.5; r.vz += hz * 2.5; r.vy = 3.6; r.rotVel = 7; }
    else { r.vy = 2.6 + Math.min(3, speed * 0.15); r.rotVel = 4 + speed * 0.4; }
    this.vx *= 0.75; this.vz *= 0.75; this.vy = Math.max(this.vy, 0) + 1.2;
    this.bikeRoll = this.lean >= 0 ? 1 : -1;
    this.bikeYawVel = (Math.random() - 0.5) * 5 + this.yawRate;
    this.throttle = 0; this.effThrottle = 0; this.slipRear = false; this.rearLocked = false;
    this.rearContact = this.frontContact = false;
    this.events.push({ type: 'crash', reason, speed, ref: obstacle ? obstacle.ref || null : null, cop: !!(obstacle && obstacle.cop) });
  }

  _stepCrash(dt) {
    const T = this.terrain;
    this.crashT += dt;
    // bike slides to a stop on its side
    this.vy -= G * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    const gh = T.height(this.x, this.z) + 0.3;
    if (this.y < gh) {
      this.y = gh;
      if (this.vy < 0) this.vy = -this.vy * 0.2;
      const sp = Math.hypot(this.vx, this.vz);
      const ns = Math.max(0, sp - 8 * dt);
      const k = sp > 1e-4 ? ns / sp : 0;
      this.vx *= k; this.vz *= k;
      this.bikeYawVel *= 1 - Math.min(1, 3 * dt);
    }
    this.lean += (this.bikeRoll * 1.4 - this.lean) * Math.min(1, 7 * dt);
    this.pitch += (0 - this.pitch) * Math.min(1, 5 * dt);
    this.yaw += this.bikeYawVel * dt;
    this.speed = 0; this.spinR *= 1 - Math.min(1, dt * 2); this.spinF *= 1 - Math.min(1, dt);
    this.wheelRotR += this.spinR * dt; this.wheelRotF += this.spinF * dt;
    this.rearPen = this.frontPen = 0;
    this._pushOut(this, 0.4);

    // rider tumbles
    const r = this.rag;
    r.vy -= G * dt;
    r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
    const rh = T.height(r.x, r.z) + 0.22;
    if (r.y < rh) {
      r.y = rh;
      if (r.vy < -1.5) { r.vy = -r.vy * 0.28; } else r.vy = 0;
      const sp = Math.hypot(r.vx, r.vz);
      const ns = Math.max(0, sp - 7 * dt);
      const k = sp > 1e-4 ? ns / sp : 0;
      r.vx *= k; r.vz *= k;
      r.rotVel = Math.sign(r.rotVel || 1) * Math.min(Math.abs(r.rotVel), ns * 1.6);
      if (ns < 0.3) r.rest += dt;
    }
    r.rot += r.rotVel * dt;
    this._pushOut(r, 0.3);
  }

  _pushOut(b, radius) {
    this.terrain.query(b.x, b.z, radius + 0.1, (o) => {
      if (o.carOnly || o.y1 < b.y - 0.2) return;
      const pen = circleVsObstacle(o, b.x, b.z, radius, hit);
      if (pen <= 0) return;
      b.x += hit.nx * pen; b.z += hit.nz * pen;
      const vn = b.vx * hit.nx + b.vz * hit.nz;
      if (vn < 0) { b.vx -= 1.3 * vn * hit.nx; b.vz -= 1.3 * vn * hit.nz; }
    });
  }
}
