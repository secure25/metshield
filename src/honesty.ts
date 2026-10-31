// Honesty clauses (P12). Every run report renders these verbatim under
// 'Limitations' — they are constants so the report cannot drift from them,
// and so a reviewer reads the same sentences in code and in output.

export const HONESTY_LIMITATIONS: string[] = [
  'Synthetic volume: most observations in world runs are synthetic fixture data, and every world-sourced observation is labeled synthetic:true; results measure the pipeline, not real users.',
  'Single-scenario results: each report covers one fixed scenario at one seed, not a sweep; its numbers are engineering evidence from that run, not an accuracy estimate.',
  'No real Meta integration: MetShield has not been built into Facebook, Messenger, or WhatsApp; it is a proposed layer demonstrated on synthetic and public data.',
  'No prevalence estimate: nothing here estimates scam prevalence or detector precision/recall; the run contains no ground-truth labels by design.',
  'Validator thresholds not tuned on real data: citation counts, tiers, and time windows were set by judgment against synthetic scenarios, not fitted to real-world measurements.'
];
