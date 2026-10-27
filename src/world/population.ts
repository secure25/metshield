import { createRng, nextInt } from './rng.js';
import type { Surface } from '../contract.js';
import type { Archetype, City, Persona, WorldAccount } from './types.js';

export const CITIES: City[] = [
  { name: 'Kiverton', utcOffset: -5 },
  { name: 'Balmaris', utcOffset: 1 },
  { name: 'Ostbridge', utcOffset: 5 },
  { name: 'Telmora', utcOffset: 9 }
];

export const CITY_SYLLABLES: Record<string, string[]> = {
  Kiverton: ['ki', 'ver', 'lo', 'ma', 'ti', 'ra', 'pe', 'so', 'na', 'li', 'do', 'fa'],
  Balmaris: ['bal', 'mar', 'sel', 'dor', 'fin', 'hal', 'ren', 'sor', 'tal', 'wen', 'yor', 'zel'],
  Ostbridge: ['ost', 'bren', 'cal', 'dun', 'ell', 'far', 'gar', 'hol', 'ish', 'jor', 'kel', 'lun'],
  Telmora: ['tel', 'mor', 'zan', 'quil', 'vor', 'xan', 'yth', 'eph', 'il', 'or', 'ath', 'esh']
};

export const INTERESTS: string[] = [
  'sky-weaving',
  'mud-racing',
  'glass-fishing',
  'cloud-mending',
  'star-charting',
  'dust-sculpting',
  'fog-hiking',
  'ink-diving',
  'sand-singing',
  'leaf-casting',
  'wave-binding',
  'ember-tending',
  'frost-gardening',
  'mist-running',
  'stone-whispering',
  'wind-braiding',
  'clay-dreaming',
  'firefly-counting',
  'tide-mapping',
  'shadow-puppetry',
  'rain-harvesting',
  'snow-carving',
  'thorn-weaving',
  'light-keeping'
];

// Tripwire handle: no syllable pool can generate these tokens, so the marker
// is unique by construction. If either form ever reaches the public feed,
// the integrity gate has failed. See the W6 notes in the README.
export const CANARY_HANDLE = 'canary.sentinel';
export const CANARY_SLUG = 'canarysentinel';

const SURFACES: Surface[] = ['facebook', 'whatsapp', 'messenger'];

const PREFIX: Record<Surface, string> = {
  facebook: 'FB',
  whatsapp: 'WA',
  messenger: 'MS'
};

export function hashSeedString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle<T>(rng: () => number, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(rng, 0, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[nextInt(rng, 0, arr.length)];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function createPersona(seed: number, personId: string): Persona {
  const rng = createRng(hashSeedString(`${seed}:${personId}`));
  const r = rng();
  let archetype: Archetype;
  if (r < 0.08) archetype = 'social';
  else if (r < 0.4) archetype = 'daily';
  else if (r < 0.76) archetype = 'light';
  else archetype = 'lurker';

  let actionsPerDay: number;
  if (archetype === 'social') actionsPerDay = nextInt(rng, 8, 15);
  else if (archetype === 'daily') actionsPerDay = nextInt(rng, 3, 8);
  else if (archetype === 'light') actionsPerDay = nextInt(rng, 1, 4);
  else actionsPerDay = nextInt(rng, 0, 2);

  const sociability = Math.round(rng() * 100) / 100;
  const vigilance = Math.round(rng() * 100) / 100;
  const gullibility = Math.round(rng() * 100) / 100;

  const citySrc = pick(rng, CITIES);
  const city: City = { name: citySrc.name, utcOffset: citySrc.utcOffset };

  const pool = [...INTERESTS];
  shuffle(rng, pool);
  const interests = pool.slice(0, 3) as [string, string, string];

  const wakeHour = nextInt(rng, 5, 10);

  return { archetype, actionsPerDay, sociability, vigilance, gullibility, interests, city, wakeHour };
}

function displayNameFor(rng: () => number, cityName: string): string {
  const pool = CITY_SYLLABLES[cityName] ?? CITY_SYLLABLES.Kiverton;
  const first = capitalize(pick(rng, pool) + pick(rng, pool));
  const last = capitalize(pick(rng, pool) + pick(rng, pool));
  return `${first} ${last}`;
}

function handleFor(rng: () => number, cityName: string, used: Set<string>): string {
  const pool = CITY_SYLLABLES[cityName] ?? CITY_SYLLABLES.Kiverton;
  for (let attempt = 0; attempt < 20; attempt++) {
    const nTokens = nextInt(rng, 2, 5);
    const tokens: string[] = [];
    for (let i = 0; i < nTokens; i++) tokens.push(pick(rng, pool));
    let handle = tokens[0];
    for (let i = 1; i < tokens.length; i++) {
      handle += (rng() < 0.5 ? '.' : '_') + tokens[i];
    }
    if (!used.has(handle)) return handle;
  }
  const base = `${pick(rng, pool)}.${pick(rng, pool)}`;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function bioFor(rng: () => number, persona: Persona): string {
  const i0 = persona.interests[0];
  const i1 = persona.interests[1];
  const city = persona.city.name;
  const t = nextInt(rng, 0, 4);
  if (t === 0) return `${capitalize(i0)} fan from ${city}.`;
  if (t === 1) return `Into ${i0}, ${i1} and quiet mornings.`;
  if (t === 2) return `${city} local who loves ${i0}.`;
  return `Here for ${i0} and ${i1}.`;
}

export function avatarFor(displayName: string, avatarSeed: number): { initials: string; hue: number } {
  const parts = displayName.split(' ').filter(Boolean);
  const initials = parts
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
  const hue = ((avatarSeed % 360) + 360) % 360;
  return { initials, hue };
}

export function generatePopulation(seed: number): WorldAccount[] {
  const rng = createRng(seed);
  const P = 338;
  const N_THREE = 27;
  const N_TWO = 88;

  const personIds = Array.from({ length: P }, (_, i) => `P-${String(i + 1).padStart(4, '0')}`);
  const shuffled = [...personIds];
  shuffle(rng, shuffled);
  const threeSet = new Set(shuffled.slice(0, N_THREE));
  const twoSet = new Set(shuffled.slice(N_THREE, N_THREE + N_TWO));

  const counters: Record<Surface, number> = { facebook: 0, whatsapp: 0, messenger: 0 };
  const usedHandles = new Set<string>();
  const accounts: WorldAccount[] = [];

  for (const personId of personIds) {
    const persona = createPersona(seed, personId);
    const cityName = persona.city.name;
    let surfaces: Surface[];
    if (threeSet.has(personId)) {
      surfaces = [...SURFACES];
    } else if (twoSet.has(personId)) {
      const excluded = nextInt(rng, 0, 3);
      surfaces = SURFACES.filter((_, i) => i !== excluded);
    } else {
      surfaces = [SURFACES[nextInt(rng, 0, 3)]];
    }

    for (const surface of surfaces) {
      counters[surface]++;
      const id = `${PREFIX[surface]}-${String(counters[surface]).padStart(4, '0')}`;
      const displayName = displayNameFor(rng, cityName);
      const handle = handleFor(rng, cityName, usedHandles);
      usedHandles.add(handle);
      const avatarSeed = nextInt(rng, 0, 1000000);
      const joinedMonthsAgo = nextInt(rng, 6, 81);
      const bio = bioFor(rng, persona);
      const finalKind = rng() < 0.12 ? 'business' : 'person';
      let followerCount: number;
      let followingCount: number;
      if (finalKind === 'business') {
        followerCount = nextInt(rng, 50, 2000);
        followingCount = nextInt(rng, 20, 500);
      } else {
        followerCount = nextInt(rng, 5, 800);
        followingCount = nextInt(rng, 10, 400);
      }
      const verified = rng() < 0.03;
      accounts.push({
        id,
        personId,
        displayName,
        handle,
        avatarSeed,
        joinedMonthsAgo,
        bio,
        followerCount,
        followingCount,
        kind: finalKind,
        verified,
        role: 'legit',
        surface,
        persona
      });
    }
  }

  const indices = accounts.map((_, i) => i);
  shuffle(rng, indices);
  const N_SCAM = 48;
  const N_OP = 8;
  const scam = indices.slice(0, N_SCAM);
  const ops = new Set(scam.slice(0, N_OP));
  for (const i of scam) {
    accounts[i].role = ops.has(i) ? 'operator' : 'shell';
  }

  accounts[0].handle = CANARY_HANDLE;

  return accounts;
}
