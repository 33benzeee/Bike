// Bike catalogue: physical specs, looks, prices and upgrades.
// Units are SI (kg, m, N, W, m/s). com = combined bike+rider centre of mass
// measured from the rear axle: [forward, up].

export const RIDER_MASS = 70;

const PEDAL_UPGRADES = [
  { id: 'battery', name: 'Gearing', desc: 'Taller gearing for more top speed' },
  { id: 'controller', name: 'Cranks', desc: 'Stiffer cranks put down more power' },
  { id: 'sprocket', name: 'Sprocket', desc: 'Snappier launches and easier lifts' },
  { id: 'tires', name: 'Tires', desc: 'More grip and stronger braking' },
];
const ELECTRIC_UPGRADES = [
  { id: 'battery', name: 'Battery', desc: 'Higher voltage pack for more top speed' },
  { id: 'controller', name: 'Controller', desc: 'More amps, more power everywhere' },
  { id: 'sprocket', name: 'Sprocket', desc: 'Bigger rear sprocket for brutal torque' },
  { id: 'tires', name: 'Tires', desc: 'More grip and stronger braking' },
];

export const UPGRADE_LEVELS = 3;

export const PAINTS = [
  { name: 'Stock', color: null },
  { name: 'Midnight', color: 0x15171c },
  { name: 'Chalk', color: 0xe8e6df },
  { name: 'Signal Red', color: 0xd42a2a },
  { name: 'Volt', color: 0xb4e61e },
  { name: 'Electric Blue', color: 0x1c6cf2 },
  { name: 'Sunset', color: 0xf07a1a },
  { name: 'Grape', color: 0x7a3fd1 },
  { name: 'Mint', color: 0x3fd1a4 },
  { name: 'Hot Pink', color: 0xf0388c },
  { name: 'Gold', color: 0xd4a52a },
  { name: 'Army', color: 0x5d6b3c },
];

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
    susp: { kF: 22000, cF: 1500, tF: 0.13, kR: 34000, cR: 1600, tR: 0.07 },
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
    susp: { kF: 20000, cF: 1500, tF: 0.09, kR: 36000, cR: 1900, tR: 0.06 },
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
    susp: { kF: 19000, cF: 1500, tF: 0.11, kR: 24000, cR: 1700, tR: 0.08 },
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
    susp: { kF: 16000, cF: 1500, tF: 0.2, kR: 19000, cR: 1700, tR: 0.2 },
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
    susp: { kF: 17000, cF: 1600, tF: 0.2, kR: 20000, cR: 1800, tR: 0.2 },
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
    susp: { kF: 17500, cF: 1600, tF: 0.21, kR: 20500, cR: 1800, tR: 0.21 },
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
    drive: { type: 'electric', maxForce: 2700, power: 60000, topSpeed: 36 },
    susp: { kF: 20000, cF: 2200, tF: 0.3, kR: 24000, cR: 2500, tR: 0.3 },
    brake: 1.15, grip: 1.18, offroad: 1.2, cdA: 0.62,
    pullTorque: 1.45, hop: 3.4, leanRate: 7.2, steerMax: 0.62, loopAngle: 1.38, pitchDamp: 0.6,
    wheelieGain: 3.8, wheelieRate: 1.0, unruly: 0.16, crashSpeed: 9, maxImpact: 15, wheelieSteer: 0.45,
    paint: 0xd9261c, accent: 0xf2f2f2, seat: 0x101010, variant: 'varg',
  },
];

export const BIKE_BY_ID = Object.fromEntries(BIKES.map((b) => [b.id, b]));

export function upgradesFor(bike) {
  return bike.cls === 'pedal' ? PEDAL_UPGRADES : ELECTRIC_UPGRADES;
}

export function upgradePrice(bike, level) {
  // level = the level being bought (1..3)
  return Math.round((bike.upgradeBase * [1, 2.2, 4][level - 1]) / 10) * 10;
}

// Resolve a catalogue entry plus upgrade levels into the numbers the physics uses.
export function effectiveSpec(bike, up = {}) {
  const b = up.battery || 0, c = up.controller || 0, s = up.sprocket || 0, t = up.tires || 0;
  const mass = bike.mass + RIDER_MASS;
  return {
    ...bike,
    totalMass: mass,
    inertia: mass * bike.gyr * bike.gyr,
    drive: {
      type: bike.drive.type,
      maxForce: bike.drive.maxForce * (1 + 0.07 * c + 0.1 * s),
      power: bike.drive.power * (1 + 0.14 * c + 0.07 * b),
      topSpeed: bike.drive.topSpeed * (1 + 0.075 * b - 0.012 * s),
    },
    grip: bike.grip * (1 + 0.05 * t),
    brake: bike.brake * (1 + 0.07 * t),
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
