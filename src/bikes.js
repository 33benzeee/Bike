// Bike catalogue: physical specs, looks, prices and upgrades.
// Units are SI (kg, m, N, W, m/s). com = combined bike+rider centre of mass
// measured from the rear axle: [forward, up].

export const RIDER_MASS = 70;

// ---- performance mods ------------------------------------------------------------
// top / launch / mass / brake / grip are fractions added to the stock value.
// cost is a multiple of the bike's upgradeBase. needs = mods that must be installed
// first. group = only one of the group can be equipped at a time.
export const MODS = [
  { id: 'battery2', name: 'Battery Stage 2', pedal: 'Race Gearing', info: '52V → 60V', pinfo: 'Taller gears', top: 0.1, launch: 0.08, cost: 6 },
  { id: 'battery3', name: 'Battery Stage 3', pedal: 'Pro Gearing', info: '60V → 72V', pinfo: 'Even taller gears', top: 0.08, launch: 0.04, cost: 9, needs: ['battery2', 'brakes'] },
  { id: 'controller', name: 'Performance Controller', pedal: 'Stiff Cranks', info: 'More amps to the motor', pinfo: 'Nothing wasted in flex', top: 0.06, launch: 0.18, cost: 5 },
  { id: 'tune', name: 'High-Current Tune', pedal: 'Clipless Pedals', info: 'Controller pushed harder', pinfo: 'Pull up as well as push', top: 0.04, launch: 0.08, cost: 2.5, needs: ['controller'] },
  { id: 'sprocket', name: 'Big Rear Sprocket', info: 'Shorter gearing', top: -0.04, launch: 0.12, cost: 1.5 },
  { id: 'weight', name: 'Weight Reduction', info: 'Lighter parts everywhere', mass: -0.1, cost: 4 },
  { id: 'brakes', name: 'Brake Upgrade', info: 'Bigger discs and pads', brake: 0.25, cost: 1.5 },
  { id: 'tyresSport', name: 'Sport Tyres', info: 'Stickier compound', grip: 0.06, brake: 0.05, cost: 1.2, group: 'tyres' },
  { id: 'tyresRace', name: 'Race Tyres', info: 'Maximum grip', grip: 0.12, brake: 0.1, cost: 2.5, group: 'tyres' },
  { id: 'footBrake', name: 'Foot Brake Kit', info: 'A rear brake pedal: BRAKE still works with your hands off the bars', price: 899, footBrake: true },
];
export const MOD_BY_ID = Object.fromEntries(MODS.map((m) => [m.id, m]));

// suspension tunes are free: springs and damping multipliers
export const SUSP_TUNES = [
  { id: 'soft', name: 'Trail', desc: 'Soft and plush', k: 0.78, c: 0.9 },
  { id: 'street', name: 'Street', desc: 'As built', k: 1, c: 1 },
  { id: 'stiff', name: 'Race', desc: 'Stiff and sharp', k: 1.4, c: 1.3 },
];

// ---- appearance ---------------------------------------------------------------------
export const PAINT_PARTS = [
  { id: 'frame', name: 'Frame' }, { id: 'plastics', name: 'Plastics' }, { id: 'seat', name: 'Seat' }, { id: 'fork', name: 'Fork' },
  { id: 'swingarm', name: 'Swingarm' }, { id: 'bars', name: 'Bars' }, { id: 'grips', name: 'Grips' }, { id: 'rims', name: 'Rims' }, { id: 'shock', name: 'Shock' },
];
export const WRAPS = [
  { id: 'galaxy', name: 'Galaxy' }, { id: 'camo', name: 'Camo' }, { id: 'flames', name: 'Flames' }, { id: 'stripes', name: 'Stripes' },
  { id: 'carbon', name: 'Carbon' }, { id: 'checker', name: 'Checker' }, { id: 'tiger', name: 'Tiger' },
];
export const LED_MODES = [{ id: 'off', name: 'Off' }, { id: 'solid', name: 'Solid' }, { id: 'pulse', name: 'Pulse' }, { id: 'rainbow', name: 'Rainbow' }];
export const FLAGS = [{ id: 'checkered', name: 'Checkered' }, { id: 'stripes', name: 'Stripes' }, { id: 'flames', name: 'Flames' }, { id: 'ww', name: 'Wheelie Works' }];
export const PRICES = { paint: 100, paintAll: 400, wrap: 1500, leds: 2000, flag: 1000, plate: 500 };

export const newEntry = () => ({ mods: {}, susp: 'street', look: { colors: {}, wrap: null, wraps: {}, leds: { owned: false, mode: 'off', color: 0x2f7bff }, flag: { owned: false, id: null }, plate: { owned: false, text: '' } } });

// bring an older save entry ({ up, paint }) up to the current shape
export function upgradeEntry(e) {
  const n = newEntry();
  if (!e) return n;
  if (e.mods) {
    n.mods = { ...e.mods }; n.susp = e.susp || 'street';
    const l = e.look || {};
    n.look = { colors: { ...(l.colors || {}) }, wrap: l.wrap || null, wraps: { ...(l.wraps || {}) }, leds: { ...n.look.leds, ...(l.leds || {}) }, flag: { ...n.look.flag, ...(l.flag || {}) }, plate: { ...n.look.plate, ...(l.plate || {}) } };
    return n;
  }
  const up = e.up || {};
  if (up.battery >= 1) n.mods.battery2 = 2;
  if (up.controller >= 1) n.mods.controller = 2;
  if (up.controller >= 2) n.mods.tune = 2;
  if (up.sprocket >= 1) n.mods.sprocket = 2;
  if (up.tires >= 2) n.mods.tyresRace = 2; else if (up.tires >= 1) n.mods.tyresSport = 2;
  return n;
}

// what the model needs to draw this entry
export function lookOf(entry) {
  const l = (entry && entry.look) || {};
  return { colors: l.colors || {}, wrap: l.wrap || null, leds: l.leds && l.leds.owned ? { mode: l.leds.mode, color: l.leds.color } : null, flag: l.flag && l.flag.owned ? l.flag.id : null, plate: l.plate && l.plate.owned ? l.plate.text : '' };
}

export const BIKES = [
  {
    id: 'wheelie', name: 'Wheelie Bike', brand: 'Big 29" BMX cruiser', cls: 'pedal', style: 'bmx',
    blurb: 'Light, forgiving and happy on the back wheel all day. The combo machine.',
    price: 0, upgradeBase: 180,
    mass: 14, wheelbase: 1.12, rF: 0.37, rR: 0.37, tireW: 0.055,
    com: [0.42, 0.56], leanShift: 0.11, gyr: 0.42,
    drive: { type: 'pedal', maxForce: 330, power: 950, topSpeed: 10.6 },
    susp: { kF: 20000, cF: 1400, tF: 0.1, kR: 34000, cR: 1600, tR: 0.07 },
    brake: 0.85, grip: 1.0, offroad: 0.85, cdA: 0.5,
    pullTorque: 1.45, hop: 3.5, leanRate: 10.5, steerMax: 0.75, loopAngle: 1.2, pitchDamp: 0.9,
    wheelieGain: 2.2, wheelieRate: 0.55, unruly: 0, crashSpeed: 6.0, maxImpact: 9.5, wheelieSteer: 0.6,
    paint: 0xf2c417, accent: 0x111111, seat: 0x1a1a1a,
  },
  {
    id: 'mtb', name: 'Trail MTB', brand: 'Hardtail mountain bike', cls: 'pedal', style: 'mtb',
    blurb: 'Suspension fork, knobby tires and big hops. Eats stairs and dirt jumps.',
    price: 900, upgradeBase: 260,
    mass: 15, wheelbase: 1.17, rF: 0.36, rR: 0.36, tireW: 0.062,
    com: [0.45, 0.6], leanShift: 0.12, gyr: 0.43,
    drive: { type: 'pedal', maxForce: 350, power: 1050, topSpeed: 11.6 },
    susp: { kF: 8500, cF: 800, tF: 0.14, kR: 34000, cR: 1600, tR: 0.07 },
    brake: 1.0, grip: 1.06, offroad: 1.15, cdA: 0.52,
    pullTorque: 1.45, hop: 4.1, leanRate: 10, steerMax: 0.72, loopAngle: 1.22, pitchDamp: 0.8,
    wheelieGain: 2.3, wheelieRate: 0.62, unruly: 0, crashSpeed: 6.5, maxImpact: 11, wheelieSteer: 0.55,
    paint: 0x1f9d55, accent: 0x101010, seat: 0x161616,
  },
  {
    id: 'macfox', name: 'Macfox X1', brand: 'Moped-style e-bike', cls: 'ebike', style: 'moped',
    blurb: 'Fat tires, bench seat, thumb throttle. A chill cruiser with a little kick.',
    price: 3200, upgradeBase: 420,
    mass: 30, wheelbase: 1.12, rF: 0.265, rR: 0.265, tireW: 0.1,
    com: [0.44, 0.5], leanShift: 0.11, gyr: 0.44,
    drive: { type: 'electric', maxForce: 470, power: 1500, topSpeed: 13.4 },
    susp: { kF: 10000, cF: 900, tF: 0.1, kR: 36000, cR: 1900, tR: 0.06 },
    brake: 0.9, grip: 1.05, offroad: 0.95, cdA: 0.56,
    pullTorque: 1.45, hop: 3.2, leanRate: 9, steerMax: 0.7, loopAngle: 1.25, pitchDamp: 0.8,
    wheelieGain: 2.5, wheelieRate: 0.72, unruly: 0, crashSpeed: 6.5, maxImpact: 10, wheelieSteer: 0.5,
    paint: 0x2b2f36, accent: 0xe0672a, seat: 0x241a14, variant: 'macfox',
  },
  {
    id: 'super73', name: 'Super73-RX', brand: 'Street-legal-ish e-bike', cls: 'ebike', style: 'moped',
    blurb: 'The icon. Full suspension, tank battery and enough shove to get in trouble.',
    price: 6500, upgradeBase: 600,
    mass: 36, wheelbase: 1.2, rF: 0.275, rR: 0.275, tireW: 0.11,
    com: [0.47, 0.51], leanShift: 0.11, gyr: 0.45,
    drive: { type: 'electric', maxForce: 610, power: 2400, topSpeed: 15.8 },
    susp: { kF: 10000, cF: 950, tF: 0.12, kR: 14500, cR: 1250, tR: 0.11 },
    brake: 1.0, grip: 1.08, offroad: 1.0, cdA: 0.58,
    pullTorque: 1.45, hop: 3.3, leanRate: 8.6, steerMax: 0.68, loopAngle: 1.27, pitchDamp: 0.8,
    wheelieGain: 2.8, wheelieRate: 0.8, unruly: 0, crashSpeed: 7, maxImpact: 11, wheelieSteer: 0.5,
    paint: 0x6b7a4a, accent: 0x111111, seat: 0x15120f, variant: 'super73',
  },
  {
    id: 'surron', name: 'Surron Light Bee X', brand: 'E-moto', cls: 'emoto', style: 'emoto',
    blurb: 'Instant torque in a mountain-bike-sized package. Cops hate this one.',
    price: 14000, upgradeBase: 950,
    mass: 57, wheelbase: 1.26, rF: 0.335, rR: 0.335, tireW: 0.075,
    com: [0.52, 0.47], leanShift: 0.1, gyr: 0.5,
    drive: { type: 'electric', maxForce: 900, power: 6500, topSpeed: 21 },
    susp: { kF: 9000, cF: 950, tF: 0.22, kR: 12000, cR: 1250, tR: 0.22 },
    brake: 1.05, grip: 1.1, offroad: 1.15, cdA: 0.6,
    pullTorque: 1.45, hop: 3.3, leanRate: 8.4, steerMax: 0.66, loopAngle: 1.34, pitchDamp: 0.7,
    wheelieGain: 3.6, wheelieRate: 1.05, unruly: 0.05, crashSpeed: 7.5, maxImpact: 13, wheelieSteer: 0.5,
    paint: 0x1b1d21, accent: 0xd8d8d8, seat: 0x0e0e0e, variant: 'surron',
  },
  {
    id: 'talaria', name: 'Talaria Sting R', brand: 'E-moto', cls: 'emoto', style: 'emoto',
    blurb: 'A little heavier, a lot punchier. Wider tires and a gearbox whine.',
    price: 21000, upgradeBase: 1200,
    mass: 66, wheelbase: 1.28, rF: 0.34, rR: 0.34, tireW: 0.085,
    com: [0.53, 0.47], leanShift: 0.1, gyr: 0.5,
    drive: { type: 'electric', maxForce: 1080, power: 8500, topSpeed: 23.6 },
    susp: { kF: 9500, cF: 1000, tF: 0.22, kR: 12500, cR: 1300, tR: 0.22 },
    brake: 1.08, grip: 1.12, offroad: 1.15, cdA: 0.6,
    pullTorque: 1.45, hop: 3.3, leanRate: 8.1, steerMax: 0.66, loopAngle: 1.35, pitchDamp: 0.7,
    wheelieGain: 3.9, wheelieRate: 1.1, unruly: 0.1, crashSpeed: 7.5, maxImpact: 13, wheelieSteer: 0.5,
    paint: 0x2a62c9, accent: 0x9aa3ad, seat: 0x0e0e0e, variant: 'talaria',
  },
  {
    id: 'eride', name: 'E Ride Pro-SS', brand: 'E-moto', cls: 'emoto', style: 'emoto',
    blurb: 'Seventy-two volts of bad decisions. Lifts the front in any gear it doesn\'t have.',
    price: 32000, upgradeBase: 1600,
    mass: 63, wheelbase: 1.29, rF: 0.34, rR: 0.34, tireW: 0.085,
    com: [0.53, 0.47], leanShift: 0.1, gyr: 0.5,
    drive: { type: 'electric', maxForce: 1380, power: 12500, topSpeed: 28 },
    susp: { kF: 9500, cF: 1000, tF: 0.23, kR: 12500, cR: 1300, tR: 0.23 },
    brake: 1.1, grip: 1.14, offroad: 1.15, cdA: 0.6,
    pullTorque: 1.45, hop: 3.3, leanRate: 8.1, steerMax: 0.66, loopAngle: 1.35, pitchDamp: 0.7,
    wheelieGain: 4.4, wheelieRate: 1.25, unruly: 0.2, crashSpeed: 8, maxImpact: 13.5, wheelieSteer: 0.5,
    paint: 0x1fa64a, accent: 0x111111, seat: 0x0e0e0e, variant: 'eride',
  },
  {
    id: 'varg', name: 'Stark Varg', brand: 'Electric motocross', cls: 'emoto', style: 'emoto',
    blurb: 'Eighty horsepower, zero chill. The endgame. Respect the throttle or it loops you.',
    price: 60000, upgradeBase: 2600,
    mass: 118, wheelbase: 1.48, rF: 0.36, rR: 0.345, tireW: 0.1,
    com: [0.62, 0.5], leanShift: 0.1, gyr: 0.55,
    drive: { type: 'electric', maxForce: 3700, power: 82000, topSpeed: 36 }, tuck: 0.2,
    susp: { kF: 12000, cF: 1450, tF: 0.3, kR: 15000, cR: 1850, tR: 0.3 },
    brake: 1.15, grip: 1.18, offroad: 1.2, cdA: 0.62,
    pullTorque: 1.45, hop: 3.4, leanRate: 7.2, steerMax: 0.62, loopAngle: 1.38, pitchDamp: 0.6,
    wheelieGain: 3.8, wheelieRate: 1.0, unruly: 0.16, crashSpeed: 9, maxImpact: 15, wheelieSteer: 0.45,
    paint: 0xd9261c, accent: 0xf2f2f2, seat: 0x101010, variant: 'varg',
  },
];

export const BIKE_BY_ID = Object.fromEntries(BIKES.map((b) => [b.id, b]));

export const modName = (bike, m) => (bike.cls === 'pedal' && m.pedal ? m.pedal : m.name);
export const modInfo = (bike, m) => (bike.cls === 'pedal' && m.pinfo ? m.pinfo : m.info);
export const modPrice = (bike, m) => m.price ?? Math.round((bike.upgradeBase * m.cost) / 10) * 10;

// 'locked' (missing a prerequisite), 'buy', 'off' (installed, not fitted) or 'on'
export function modState(entry, m) {
  const v = (entry.mods || {})[m.id] || 0;
  if (v === 2) return 'on';
  if (v === 1) return 'off';
  return (m.needs || []).every((n) => (entry.mods || {})[n]) ? 'buy' : 'locked';
}

// fit or remove an installed mod, keeping prerequisites and one-per-group rules
export function setModEquipped(entry, id, on) {
  const mods = entry.mods, m = MOD_BY_ID[id];
  if (!mods[id]) return;
  if (on) {
    for (const n of m.needs || []) if (mods[n]) mods[n] = 2;
    if (m.group) for (const o of MODS) if (o.group === m.group && o.id !== id && mods[o.id]) mods[o.id] = 1;
    mods[id] = 2;
  } else {
    mods[id] = 1;
    for (const o of MODS) if ((o.needs || []).includes(id) && mods[o.id] === 2) setModEquipped(entry, o.id, false);
  }
}

// Resolve a catalogue entry plus the owner's mods into the numbers the physics uses.
export function effectiveSpec(bike, entry) {
  const mods = (entry && entry.mods) || {};
  let top = 1, launch = 1, mass = 1, brake = 1, grip = 1;
  for (const m of MODS) {
    if (mods[m.id] !== 2) continue;
    top += m.top || 0; launch += m.launch || 0; mass += m.mass || 0; brake += m.brake || 0; grip += m.grip || 0;
  }
  const tune = SUSP_TUNES.find((t) => t.id === ((entry && entry.susp) || 'street')) || SUSP_TUNES[1];
  const bikeMass = bike.mass * mass, total = bikeMass + RIDER_MASS, su = bike.susp;
  return {
    ...bike,
    mass: bikeMass,
    totalMass: total,
    inertia: total * bike.gyr * bike.gyr,
    drive: {
      type: bike.drive.type,
      maxForce: bike.drive.maxForce * launch,
      // drag grows with the cube of speed, so top-end mods need a lot more power
      power: bike.drive.power * launch * Math.pow(top, 2.6),
      topSpeed: bike.drive.topSpeed * top,
    },
    grip: bike.grip * grip,
    brake: bike.brake * brake,
    footBrake: mods.footBrake === 2,
    susp: { kF: su.kF * tune.k, cF: su.cF * tune.c, tF: su.tF, kR: su.kR * tune.k, cR: su.cR * tune.c, tR: su.tR },
  };
}

// headline numbers for the garage: top speed (m/s), launch vs stock, weight (kg)
export function perfStats(bike, entry) {
  const stock = effectiveSpec(bike, null), now = effectiveSpec(bike, entry);
  return {
    top: now.drive.topSpeed, stockTop: stock.drive.topSpeed,
    launch: now.drive.maxForce / now.totalMass / (stock.drive.maxForce / stock.totalMass) - 1,
    weight: now.mass, stockWeight: stock.mass,
    brake: now.brake / stock.brake - 1, grip: now.grip / stock.grip - 1,
  };
}

// 0..1 stat bars for the garage
export function statBars(spec) {
  const m = spec.totalMass;
  return {
    speed: Math.min(1, spec.drive.topSpeed / 42),
    accel: Math.min(1, spec.drive.maxForce / m / 16),
    handling: Math.min(1, (spec.leanRate - 6) / 5.5),
    balance: Math.min(1, Math.max(0.1, 1.25 - spec.drive.maxForce / m / 14 - (spec.cls === 'pedal' ? 0 : 0.1))),
  };
}
