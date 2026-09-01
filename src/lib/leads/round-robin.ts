export type WeightedEntry = {
  email: string;
  /** Whole number. 0 means "not taking leads right now", not "takes very few". */
  weight: number;
  /** Rotation cursor. The caller MUST persist this between calls. */
  currentWeight: number;
  /** Admin ordering; used to break ties so a run is reproducible. */
  position: number;
};

/**
 * Smooth weighted round-robin — the algorithm nginx uses to pick an upstream.
 *
 * Why not the two more obvious approaches. Handing out in blocks (70 to A, then
 * 30 to B) gives A every lead from the morning and B every lead from the
 * afternoon, and those are not the same quality of lead. Weighted random hits
 * the ratio eventually, but a single import of ten can still be ten A's — and
 * "eventually" is no comfort to whoever got nothing this month.
 *
 * `currentWeight` is the whole of the state, and the caller must save
 * `nextState`. Drop it and ten imports of one lead each all land on the first
 * agent, because every call would restart the cycle.
 */
export function pickWeighted(
  entries: readonly WeightedEntry[],
  count: number
): { picks: string[]; nextState: WeightedEntry[] } {
  const state = entries
    .filter((entry) => entry.weight > 0)
    .map((entry) => ({ ...entry }))
    .sort((a, b) => a.position - b.position || a.email.localeCompare(b.email));

  const total = state.reduce((sum, entry) => sum + entry.weight, 0);
  const picks: string[] = [];
  if (state.length === 0 || total <= 0) return { picks, nextState: state };

  for (let index = 0; index < count; index += 1) {
    // Every entry is credited BEFORE any comparison. Folding these two loops
    // together would credit later entries after they had already been compared,
    // which skews the ratio in favour of whoever sorts first.
    for (const entry of state) {
      entry.currentWeight += entry.weight;
    }
    let best = state[0];
    for (const entry of state) {
      if (entry.currentWeight > best.currentWeight) best = entry;
    }
    best.currentWeight -= total;
    picks.push(best.email);
  }
  return { picks, nextState: state };
}

/**
 * What the next `count` leads would look like, without spending the cursor.
 * The config screen shows this: "in the next 10 leads — A 7, B 3" lands faster
 * than a percentage does.
 */
export function previewDistribution(
  entries: readonly WeightedEntry[],
  count: number
): { email: string; count: number }[] {
  const { picks } = pickWeighted(entries, count);
  const tally = new Map<string, number>();
  for (const email of picks) tally.set(email, (tally.get(email) ?? 0) + 1);
  return [...tally.entries()]
    .map(([email, n]) => ({ email, count: n }))
    .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email));
}
