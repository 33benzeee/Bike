// Seasons. Each one hides a fresh set of collectibles around the city and pays out its own
// reward for finding them all. To start a new season, add an entry: a new seed moves every
// hiding place, and progress resets because it is saved against the season id.
export const SEASONS = [
  {
    id: 's1', n: 1, name: 'Neon Nights', starts: '2026-11-01',
    seed: 1101, count: 20,
    item: 'Neon Sprocket', color: 0x29f0d0, css: '#29f0d0', each: 250,
    reward: { helmet: 'aurora', name: 'Aurora helmet' },
  },
];

// the newest season that has started
export function currentSeason(now = new Date()) {
  let cur = SEASONS[0];
  for (const s of SEASONS) if (new Date(s.starts + 'T00:00:00Z') <= now) cur = s;
  return cur;
}
