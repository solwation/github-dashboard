import { column, type Issue, type Lane, type Rules } from "./model";

export const ACTIVITY_LIFETIME_MS = 2 * 60 * 1000;
interface Snapshot { version: string; column: string }
interface Activity { version: string; at: number; kind: "updated" | "moved" | "created" }
/** Existing movement callers keep booleans; creation is a distinct card marker. */
export type ActivityMarker = boolean | "created";
const version = (issue: Issue, col: string) => `${issue.updated_at}:${issue.closed_at}:${col}`;

/** In-memory acknowledgement of observed changes; refreshes never resurrect read activity. */
export class ActivityTracker {
  private snapshots = new Map<string, { at: number; rules: string; issues: Map<number, Snapshot> }>();
  private unread = new Map<string, Map<number, Activity>>();
  private acknowledged = new Map<string, string>();

  update(lanes: Lane[], rules: Record<string, Rules>, now = Date.now(), options: { discoverNew?: boolean; observedAt?: Record<string, number> } = {}) {
    for (const lane of lanes) {
      if (lane.error) continue;
      const repo = lane.repo.full_name;
      const ruleKey = JSON.stringify(Object.entries(rules[repo] || {}).sort(([a], [b]) => a.localeCompare(b)));
      const previous = this.snapshots.get(repo);
      const pending = this.unread.get(repo) || new Map<number, Activity>();
      const current = new Map<number, Snapshot>();
      // Editing workflow settings is not a GitHub issue movement.
      const rulesChanged = previous && previous.rules !== ruleKey;
      if (rulesChanged) pending.clear();
      for (const issue of lane.issues) {
        if (issue.pull_request) continue;
        const col = column(issue, rules[repo]);
        const next = { version: version(issue, col), column: col };
        current.set(issue.id, next);
        const before = previous?.issues.get(issue.id);
        if (!rulesChanged && before && before.version !== next.version) {
          const existing = pending.get(issue.id);
          const moved = before.column !== col;
          const keepMarker = existing && existing.kind !== "updated" && now - existing.at < ACTIVITY_LIFETIME_MS;
          pending.set(issue.id, { version: next.version, at: moved || !keepMarker ? now : existing.at, kind: moved ? "moved" : keepMarker ? existing.kind : "updated" });
        } else if (!previous || (!rulesChanged && !before)) {
          const created = Date.parse(issue.created_at);
          const changed = Date.parse(issue.updated_at);
          const newlyCreated = options.discoverNew !== false && previous && col === "backlog" && created > previous.at && created <= now && now - created < ACTIVITY_LIFETIME_MS;
          if (newlyCreated) pending.set(issue.id, { version: next.version, at: created, kind: "created" });
          else if (changed <= now && now - changed < ACTIVITY_LIFETIME_MS)
            pending.set(issue.id, { version: next.version, at: changed, kind: "updated" });
        }
        if (this.acknowledged.get(JSON.stringify([repo, issue.id])) === next.version) pending.delete(issue.id);
      }
      for (const [id, activity] of pending) {
        if (!current.has(id) || now - activity.at >= ACTIVITY_LIFETIME_MS) pending.delete(id);
      }
      this.snapshots.set(repo, { at: options.discoverNew === false ? previous?.at ?? now : options.observedAt?.[repo] ?? now, rules: ruleKey, issues: current });
      this.unread.set(repo, pending);
    }
  }
  private activity(repo: string, issue: Issue, now: number) {
    const activity = this.unread.get(repo)?.get(issue.id);
    const snapshot = this.snapshots.get(repo)?.issues.get(issue.id);
    return activity && snapshot?.version === activity.version && now >= activity.at && now - activity.at < ACTIVITY_LIFETIME_MS
      ? activity : undefined;
  }
  changedAt(repo: string, issue: Issue, now: number): string | null {
    const activity = this.activity(repo, issue, now);
    return activity ? new Date(activity.at).toISOString() : null;
  }
  moved(repo: string, issue: Issue, now: number): ActivityMarker {
    const kind = this.activity(repo, issue, now)?.kind;
    return kind === "created" ? "created" : kind === "moved";
  }
  /** When a marker next appears or expires, so callers can re-evaluate without a per-second clock. */
  nextChange(now: number): number | null {
    let next = Infinity;
    for (const pending of this.unread.values()) for (const { at } of pending.values()) {
      const change = at > now ? at : at + ACTIVITY_LIFETIME_MS;
      if (change > now) next = Math.min(next, change);
    }
    return Number.isFinite(next) ? next : null;
  }
  read(repo: string, issue: Issue) {
    this.unread.get(repo)?.delete(issue.id);
    const snapshot = this.snapshots.get(repo)?.issues.get(issue.id);
    if (snapshot) {
      const key = JSON.stringify([repo, issue.id]);
      this.acknowledged.delete(key);
      this.acknowledged.set(key, snapshot.version);
      if (this.acknowledged.size > 500) this.acknowledged.delete(this.acknowledged.keys().next().value!);
    }
  }
  acknowledgements() { return Object.fromEntries(this.acknowledged); }
  restore(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, version] of Object.entries(value).slice(-500))
      if (key.length < 250 && typeof version === "string" && version.length < 200) this.acknowledged.set(key, version);
  }
  retain(repos: string[]) {
    for (const repo of this.snapshots.keys()) if (!repos.includes(repo)) {
      this.snapshots.delete(repo); this.unread.delete(repo);
    }
  }
  clear() { this.snapshots.clear(); this.unread.clear(); this.acknowledged.clear(); }
}
