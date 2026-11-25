// Save data (localStorage), stats and challenges.
import { BIKES, BIKE_BY_ID, MODS, newEntry, upgradeEntry, modFits, modPrice } from './bikes.js';

const KEY = 'wheelie-works-save-v2';

export const CHALLENGES = [
  { id: 'w50', name: 'Back Wheel Basics', desc: 'Wheelie for 50 m', reward: 150, stat: 'wheelieDist', goal: 50 },
  { id: 'w200', name: 'Block Party', desc: 'Wheelie for 200 m', reward: 500, stat: 'wheelieDist', goal: 200 },
  { id: 'w500', name: 'Half a K', desc: 'Wheelie for 500 m', reward: 1500, stat: 'wheelieDist', goal: 500 },
  { id: 'w1000', name: 'The Full Kilometre', desc: 'Wheelie for 1 km', reward: 5000, stat: 'wheelieDist', goal: 1000 },
  { id: 'wt15', name: 'Balance Point', desc: 'Hold a wheelie for 15 s', reward: 300, stat: 'wheelieTime', goal: 15 },
  { id: 'wt45', name: 'Never Coming Down', desc: 'Hold a wheelie for 45 s', reward: 2000, stat: 'wheelieTime', goal: 45 },
  { id: 'nh5', name: 'Look Ma', desc: 'No-hander wheelie for 5 s', reward: 400, stat: 'var_no', goal: 5 },
  { id: 'ss5', name: 'Standing Ovation', desc: 'Seat-stander wheelie for 5 s', reward: 600, stat: 'var_stand', goal: 5 },
  { id: 'hd3', name: 'Knuckle Sparks', desc: 'One-hand wheelie deep enough to drag your free hand on the road, for 3 s', reward: 700, stat: 'var_hand', goal: 3 },
  { id: 'st12', name: 'Nose Job', desc: 'Stoppie for 12 m', reward: 400, stat: 'stoppieDist', goal: 12 },
  { id: 'c2k', name: 'Warming Up', desc: 'Bank a 2,000 point combo', reward: 300, stat: 'combo', goal: 2000 },
  { id: 'c10k', name: 'Combo Machine', desc: 'Bank a 10,000 point combo', reward: 1500, stat: 'combo', goal: 10000 },
  { id: 'c50k', name: 'Bike Life', desc: 'Bank a 50,000 point combo', reward: 6000, stat: 'combo', goal: 50000 },
  { id: 'nm10', name: 'Lane Splitter', desc: '10 close calls with traffic', reward: 300, stat: 'nearMiss', goal: 10, sum: true },
  { id: 'nm60', name: 'Traffic Surgeon', desc: '60 close calls with traffic', reward: 2000, stat: 'nearMiss', goal: 60, sum: true },
  { id: 'air15', name: 'Frequent Flyer', desc: '1.5 s of airtime', reward: 400, stat: 'air', goal: 1.5 },
  { id: 'flip', name: 'Full Send', desc: 'Land a flip', reward: 2000, stat: 'flip', goal: 1, sum: true },
  { id: 'esc1', name: 'Can\'t Catch Me', desc: 'Escape the cops', reward: 300, stat: 'escape', goal: 1 },
  { id: 'esc3', name: 'Roadblock Runner', desc: 'Escape at heat 3', reward: 1500, stat: 'escape', goal: 3 },
  { id: 'esc5', name: 'Ghost', desc: 'Escape at heat 5', reward: 6000, stat: 'escape', goal: 5 },
  { id: 'spd40', name: 'Quick', desc: 'Hit 40 mph', reward: 400, stat: 'topSpeed', goal: 17.88 },
  { id: 'spd70', name: 'Warp Speed', desc: 'Hit 70 mph', reward: 2500, stat: 'topSpeed', goal: 31.3 },
  { id: 'del1', name: 'First Order', desc: 'Complete a delivery', reward: 200, stat: 'deliveries', goal: 1 },
  { id: 'del25', name: 'Courier', desc: 'Complete 25 deliveries', reward: 3000, stat: 'deliveries', goal: 25 },
  { id: 'gold1', name: 'Podium', desc: 'Win a gold medal', reward: 1000, stat: 'golds', goal: 1 },
  { id: 'gold6', name: 'Clean Sweep', desc: 'Gold in every race and wheelie run', reward: 8000, stat: 'golds', goal: 6 },
];

const DEFAULTS = () => ({
  cash: 0, bike: 'wheelie',
  owned: { wheelie: newEntry() },
  stats: {}, done: {},
  helmets: { owned: { white: true }, on: 'white' },
  jobs: { deliveries: 0, earned: 0, streakBest: 0 }, races: {}, season: { id: '', found: {}, done: false },
  settings: { assist: 1, units: 'mph', time: 'cycle', weather: 'dynamic', quality: 'auto', camera: 'chase', volume: 0.7, mute: false, controls: 'auto', hints: true },
});

export class Save {
  constructor() {
    this.data = DEFAULTS();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw), def = DEFAULTS();
        this.data = { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) }, owned: { ...def.owned, ...(d.owned || {}) }, helmets: { owned: { ...def.helmets.owned, ...((d.helmets || {}).owned || {}) }, on: (d.helmets || {}).on || 'white' }, jobs: { ...def.jobs, ...(d.jobs || {}) }, races: { ...(d.races || {}) }, season: { ...def.season, ...(d.season || {}), found: { ...((d.season || {}).found || {}) } } };
      }
    } catch (e) { /* private mode or corrupt save: start fresh */ }
    // saves from before the day/night cycle start on it once
    if (!this.data.settings.cycleOn) { this.data.settings.time = 'cycle'; this.data.settings.cycleOn = 1; }
    for (const id of Object.keys(this.data.owned)) this.data.owned[id] = upgradeEntry(this.data.owned[id]); // older saves
    // mods that were taken off the pedal bikes (weight reduction, foot brake kit): refund them
    for (const [id, e] of Object.entries(this.data.owned)) {
      const bike = BIKE_BY_ID[id];
      if (bike) for (const m of MODS) if (e.mods[m.id] && !modFits(bike, m)) { this.data.cash += modPrice(bike, m); delete e.mods[m.id]; }
    }
    if (!BIKES.some((b) => b.id === this.data.bike) || !this.data.owned[this.data.bike]) this.data.bike = 'wheelie';
    this._t = null; this.onChallenge = null;
  }

  persist() {
    if (this._t) return;
    this._t = setTimeout(() => { this._t = null; try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ } }, 400);
  }

  reset() { this.data = DEFAULTS(); try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  get cash() { return this.data.cash; }
  earn(n) { this.data.cash = Math.max(0, Math.round(this.data.cash + n)); this.persist(); }
  owns(id) { return !!this.data.owned[id]; }
  entry(id = this.data.bike) {
    const e = this.data.owned[id];
    if (e && !e.look) return (this.data.owned[id] = upgradeEntry(e)); // entry from an older save
    return e;
  }

  // record a stat (max, or sum for counters) and pay out any finished challenges
  stat(name, value) {
    const st = this.data.stats;
    const sum = name === 'nearMiss' || name === 'flip';
    const nv = sum ? (st[name] || 0) + value : Math.max(st[name] || 0, value);
    if (nv === st[name]) return;
    st[name] = nv;
    for (const c of CHALLENGES) {
      if (c.stat !== name || this.data.done[c.id] || nv < c.goal) continue;
      this.data.done[c.id] = true;
      this.data.cash += c.reward;
      if (this.onChallenge) this.onChallenge(c);
    }
    this.persist();
  }

  progress(c) { return Math.min(1, (this.data.stats[c.stat] || 0) / c.goal); }
}
