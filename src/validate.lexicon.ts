// Banned-token lists for validator rule V5. Exported so a reviewer can read
// exactly what the validator refuses. Matching is case-insensitive with a
// custom boundary: a token fires only when not adjacent to [a-z0-9-], so
// template F's "reported-scam" never trips the "scam" token, and neither
// would a compound like "anti-scam".
export const URGENCY_TOKENS: string[] = [
  'urgent',
  'urgently',
  'hurry',
  'immediately',
  'immediate',
  'act now',
  'last chance',
  'limited time',
  'expire',
  'expires',
  'expired',
  'expiring',
  'deadline',
  'final notice',
  'asap',
  'now or never',
  'right now',
  'at once',
  'instantly'
];

export const GUILT_TOKENS: string[] = [
  'scam',
  'scams',
  'scammer',
  'scammers',
  'fraud',
  'fraudster',
  'fraudsters',
  'criminal',
  'criminals',
  'guilty',
  'thief',
  'thieves',
  'steal',
  'stole',
  'stolen'
];
