// Helmets: the catalogue, the case that drops them, and how each one is drawn.
import * as THREE from 'three';
import { wrapTexture } from './bikeModel.js';

export const RARITY = {
  common: { name: 'Common', color: '#b9c0cc', chance: 60 },
  rare: { name: 'Rare', color: '#3b8cff', chance: 26 },
  epic: { name: 'Epic', color: '#b05cff', chance: 10 },
  legendary: { name: 'Legendary', color: '#ffb21f', chance: 3.75 },
  // the ghost helmet sits outside the rarity ladder
  ghost: { name: '', color: '#dfe8f0', chance: 0.25 },
  // season rewards are earned out in the city, never dropped by a case
  season: { name: 'Season 1', color: '#29f0d0', chance: 0 },
};
export const CASE_PRICE = 7500;
export const DUPLICATE_REFUND = 1500;

export const HELMETS = [
  { id: 'white', name: 'Stock White', rarity: 'common', color: 0xf4f4f4 },
  { id: 'black', name: 'Blackout', rarity: 'common', color: 0x15171c },
  { id: 'red', name: 'Signal Red', rarity: 'common', color: 0xd42a2a },
  { id: 'blue', name: 'Electric Blue', rarity: 'common', color: 0x1c6cf2 },
  { id: 'yellow', name: 'Hi-Vis', rarity: 'common', color: 0xffd21f },
  { id: 'green', name: 'Moss', rarity: 'common', color: 0x1fa64a },
  { id: 'orange', name: 'Sunset', rarity: 'common', color: 0xf07a1a },
  { id: 'carbon', name: 'Carbon Weave', rarity: 'rare', color: 0xaab0b8, tex: 'carbon', metal: 0.5, rough: 0.3 },
  { id: 'camo', name: 'Woodland Camo', rarity: 'rare', color: 0x8ea05c, tex: 'camo' },
  { id: 'checker', name: 'Finish Line', rarity: 'rare', color: 0xffffff, tex: 'checker' },
  { id: 'stripes', name: 'Candy Stripe', rarity: 'rare', color: 0xf0388c, tex: 'stripes' },
  { id: 'tiger', name: 'Tiger', rarity: 'rare', color: 0xf58a1f, tex: 'tiger' },
  { id: 'chrome', name: 'Chrome', rarity: 'epic', color: 0xeef2f6, metal: 1, rough: 0.06 },
  { id: 'neon', name: 'Neon Glow', rarity: 'epic', color: 0x1b2a10, emissive: 0xb4e61e, glow: 1.3 },
  { id: 'flames', name: 'Hellfire', rarity: 'epic', color: 0xff5a1a, tex: 'flames', emissive: 0x5a1400, glow: 0.8 },
  { id: 'gold', name: 'Solid Gold', rarity: 'legendary', color: 0xe0ad2a, metal: 1, rough: 0.16 },
  { id: 'galaxy', name: 'Galaxy', rarity: 'legendary', color: 0xa56bff, tex: 'galaxy', emissive: 0x2a0a66, glow: 0.9, metal: 0.4, rough: 0.3 },
  { id: 'rainbow', name: 'Prism', rarity: 'legendary', color: 0xffffff, metal: 0.7, rough: 0.2, anim: 'rainbow' },
  { id: 'aurora', name: 'Aurora', rarity: 'season', color: 0x10202a, emissive: 0x29f0d0, glow: 1.1, metal: 0.6, rough: 0.22, anim: 'aurora' },
  { id: 'ghost', name: 'Ghost Helmet', rarity: 'ghost', color: 0xd4dde6, emissive: 0xa9bccf, glow: 0.55, opacity: 0.36, rough: 0.2, anim: 'ghost' },
];
export const HELMET_BY_ID = Object.fromEntries(HELMETS.map((h) => [h.id, h]));

// pick a rarity by its chance, then any helmet of that rarity
export function rollCase(rnd = Math.random) {
  let r = rnd() * Object.values(RARITY).reduce((s, q) => s + q.chance, 0), rarity = 'common';
  for (const [k, q] of Object.entries(RARITY)) { r -= q.chance; if (r <= 0) { rarity = k; break; } }
  const pool = HELMETS.filter((h) => h.rarity === rarity);
  return pool[Math.floor(rnd() * pool.length)];
}

// dress a shell + visor material as the given helmet
export function applyHelmet(shell, visor, h, eyes) {
  h = h || HELMETS[0];
  if (eyes) eyes.visible = h.anim === 'ghost';
  shell.color.set(h.color);
  shell.map = h.tex ? wrapTexture(h.tex) : null;
  shell.metalness = h.metal ?? 0.2; shell.roughness = h.rough ?? 0.3;
  shell.emissive.set(h.emissive ?? 0x000000); shell.emissiveIntensity = h.glow ?? 0;
  const see = h.opacity !== undefined;
  shell.transparent = see; shell.opacity = see ? h.opacity : 1; shell.depthWrite = !see;
  visor.transparent = see; visor.opacity = see ? 0.28 : 1; visor.depthWrite = !see; visor.color.set(see ? 0x5f6e7d : 0x15181d);
  shell.needsUpdate = true; visor.needsUpdate = true;
}

// per-frame effects for the animated helmets
export function animateHelmet(shell, h, t, eyes) {
  if (!h || !h.anim) return;
  if (h.anim === 'rainbow') shell.color.setHSL((t * 0.22) % 1, 0.95, 0.55);
  else if (h.anim === 'aurora') { shell.emissive.setHSL(0.47 + Math.sin(t * 0.9) * 0.14, 1, 0.5); shell.emissiveIntensity = h.glow + Math.sin(t * 2.6) * 0.3; }
  else if (h.anim === 'ghost') {
    shell.opacity = h.opacity + Math.sin(t * 2.2) * 0.08; shell.emissiveIntensity = h.glow + Math.sin(t * 2.2 + 1) * 0.2;
    // the eyes flicker, and now and then they blink
    if (eyes) { const blink = (t * 0.37) % 1 > 0.96 ? 0.1 : 1; for (const e of eyes.pair) e.scale.y = 1.3 * blink; eyes.material.opacity = 0.8 + Math.sin(t * 9) * 0.12; }
  }
}

// nobody home: two pale eyes floating inside the ghost helmet, and a faint halo around it
export function ghostEyes() {
  const m = new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.85, depthWrite: false });
  const g = new THREE.Group(); g.material = m; g.visible = false; g.pair = [];
  for (const x of [-0.044, 0.044]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), m); e.position.set(x, 0.012, 0.085); e.scale.set(1, 1.3, 0.6); e.renderOrder = 2; g.add(e); g.pair.push(e); }
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), new THREE.MeshBasicMaterial({ color: 0xb9d4ee, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending }));
  halo.scale.set(1.2, 1.24, 1.36); halo.renderOrder = 1; g.add(halo);
  return g;
}

// The helmet itself: shell, a wrap-around visor, chin bar and a motocross peak. Shared by the
// rider's head and the one on show in the shop.
export function buildHelmet(shell, visor) {
  const g = new THREE.Group();
  shell = shell || new THREE.MeshStandardMaterial({ color: 0xf4f4f4 });
  visor = visor || new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.15, metalness: 0.6 });
  const put = (geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; g.add(me); return me; };
  put(new THREE.SphereGeometry(0.135, 18, 12), shell, 0, 0, 0).scale.set(1, 1.04, 1.16);
  // visor: a band of a slightly larger sphere across the front
  put(new THREE.SphereGeometry(0.139, 14, 5, Math.PI / 2 - 1.05, 2.1, 1.22, 0.5), visor, 0, 0, 0).scale.set(1, 1.04, 1.16);
  // chin bar: half a ring around the jaw
  const chin = put(new THREE.TorusGeometry(0.108, 0.04, 7, 12, Math.PI), shell, 0, -0.082, 0.035); chin.rotation.x = Math.PI / 2; chin.scale.set(1, 1.22, 1);
  const peak = put(new THREE.BoxGeometry(0.19, 0.012, 0.13), shell, 0, 0.098, 0.145); peak.rotation.x = -0.22;
  const eyes = ghostEyes(); g.add(eyes);
  return { group: g, shell, visor, eyes };
}
