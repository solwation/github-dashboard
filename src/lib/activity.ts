import { column, type Issue, type Lane, type Rules } from "./model";

export const ACTIVITY_LIFETIME_MS = 2 * 60 * 1000;
interface Snapshot { version: string; column: string; comments: number }
interface Activity {
  version: string;
  at: number;
  kind: "updated" | "moved" | "created";
  newComments?: number;
  commentsAt?: number;
}
/** Existing movement callers keep booleans; creation is a distinct card marker. */
export type ActivityMarker = boolean | "created";
const version = (issue: Issue, col: string) => `${issue.updated_at}:${issue.closed_at}:${col}:${issue.comments ?? 0}`;

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
        const currentComments = Math.max(0, Math.floor(issue.comments ?? 0));
        const next = { version: version(issue, col), column: col, comments: currentComments };
        current.set(issue.id, next);
        const before = previous?.issues.get(issue.id);
        if (!rulesChanged && before && (before.version !== next.version || before.comments !== currentComments)) {
          const existing = pending.get(issue.id);
          const moved = before.column !== col;
          const keepMarker = existing && existing.kind !== "updated" && now - existing.at < ACTIVITY_LIFETIME_MS;
          const addedComments = Math.max(0, currentComments - before.comments);
          const existingComments = existing && existing.commentsAt && now - existing.commentsAt < ACTIVITY_LIFETIME_MS
            ? (existing.newComments ?? 0)
            : 0;
          const unreadComments = Math.min(currentComments, existingComments + addedComments);
          const commentsAt = addedComments > 0 ? now : existing?.commentsAt;
          pending.set(issue.id, {
            version: next.version,
            at: moved || !keepMarker ? now : existing.at,
            kind: moved ? "moved" : keepMarker ? existing.kind : "updated",
            newComments: unreadComments > 0 ? unreadComments : undefined,
            commentsAt: unreadComments > 0 ? commentsAt : undefined,
          });
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
        const movementActive = now - activity.at < ACTIVITY_LIFETIME_MS;
        const commentsActive = Boolean(activity.commentsAt && now - activity.commentsAt < ACTIVITY_LIFETIME_MS);
        if (!current.has(id) || (!movementActive && !commentsActive)) pending.delete(id);
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
  newComments(repo: string, issue: Issue, now: number): number {
    const activity = this.unread.get(repo)?.get(issue.id);
    const snapshot = this.snapshots.get(repo)?.issues.get(issue.id);
    if (!activity || !snapshot || snapshot.version !== activity.version) return 0;
    if (activity.commentsAt && now >= activity.commentsAt && now - activity.commentsAt < ACTIVITY_LIFETIME_MS) {
      return activity.newComments ?? 0;
    }
    return 0;
  }
  /** When a marker next appears or expires, so callers can re-evaluate without a per-second clock. */
  nextChange(now: number): number | null {
    let next = Infinity;
    for (const pending of this.unread.values()) for (const { at, commentsAt } of pending.values()) {
      const change = at > now ? at : at + ACTIVITY_LIFETIME_MS;
      if (change > now) next = Math.min(next, change);
      if (commentsAt) {
        const commentChange = commentsAt > now ? commentsAt : commentsAt + ACTIVITY_LIFETIME_MS;
        if (commentChange > now) next = Math.min(next, commentChange);
      }
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
