/** Pure delta logic for animated "+1"/"−1" feedback on overview sub-values (#188). */
export const VALUE_DELTA_MS = 2000;
export type ValueMap<K extends string> = Record<K, number>;

/**
 * Compares successive value snapshots. The first snapshot, a changed scope (board/filter switch)
 * and non-live data only set the baseline and never report a delta.
 */
export class ValueDeltaTracker<K extends string> {
  private scope: string | null = null;
  private baseline: ValueMap<K> | null = null;

  update(values: ValueMap<K>, scope: string, live: boolean): Partial<Record<K, number>> {
    const before = this.baseline;
    const sameScope = this.scope === scope;
    if (!live) { this.reset(); return {}; }
    this.scope = scope;
    this.baseline = { ...values };
    const deltas: Partial<Record<K, number>> = {};
    if (!before || !sameScope) return deltas;
    for (const key of Object.keys(values) as K[]) {
      const change = values[key] - before[key];
      if (change) deltas[key] = change;
    }
    return deltas;
  }
  /** Adopt values as the baseline without reporting (e.g. time-driven drift). */
  rebaseline(values: ValueMap<K>) { if (this.baseline) this.baseline = { ...values }; }
  reset() { this.scope = null; this.baseline = null; }
}

/** Sums rapid changes per key into one coalesced delta; a net zero removes the delta. */
export function coalesceDeltas<K extends string>(current: Partial<Record<K, number>>, incoming: Partial<Record<K, number>>): Partial<Record<K, number>> {
  const next: Partial<Record<K, number>> = { ...current };
  for (const key of Object.keys(incoming) as K[]) {
    const sum = (next[key] || 0) + (incoming[key] || 0);
    if (sum) next[key] = sum; else delete next[key];
  }
  return next;
}
