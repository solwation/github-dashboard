/**
 * Optimistic "pending" closures (#381).
 *
 * A full lane load reads open and closed issues from two list endpoints. Right after an issue is
 * closed, GitHub's closed list can lag behind, so the issue is missing from both lists and its
 * card would vanish from In progress without appearing in Closed. This module notices that
 * departure, keeps the last known issue visible in Closed as a pending card, and verifies it at
 * once with a single-issue request. The verified issue (closed, reopened, moved back) is merged
 * into the board; a deleted or transferred issue is removed; an unverifiable one expires after a
 * bounded lifetime into a final repository reconciliation.
 *
 * Pending state lives in memory only. It is never written into `lanes`, so the encrypted content
 * cache cannot persist and later resurrect a guessed state.
 */
import { MIN_REMAINING_QUOTA } from "./adhoc-refresh";
import { column, type Issue, type Lane, type Rules } from "./model";

/**
 * Upper bound for a pending card. The closed list usually catches up within about a minute; two
 * minutes leaves room for a few verification retries (and matches the active reconcile interval)
 * while a guessed state never lingers.
 */
export const PENDING_CLOSURE_TTL_MS = 120_000;
/** A closed issue that drops out of a load this soon after closing is also treated as pending. */
export const RECENT_CLOSURE_MS = 10 * 60_000;
/** Verification retry delays after a failed attempt: 5 s, 10 s, 20 s, then 30 s. */
export function verificationRetryMs(failures: number): number {
  return Math.min(30_000, 5_000 * 2 ** Math.max(0, failures - 1));
}

export interface PendingClosure {
  repository: string;
  /** The last issue the board showed before it went missing. */
  issue: Issue;
  detectedAt: number;
  deadline: number;
  failures: number;
  nextAttemptAt: number;
}

/** Result of a single-issue verification request. */
export type Verification =
  | { kind: "issue"; issue: Issue }
  /** 404/410: the issue was deleted or is no longer accessible. */
  | { kind: "gone" }
  /** Network, permission or rate-limit failure: try again later. */
  | { kind: "error" };

export type VerificationOutcome = "merge" | "remove" | "retry";

const key = (repository: string, id: number) => `${repository.toLowerCase()}#${id}`;

function recentlyClosed(issue: Issue, now: number) {
  const closed = issue.state === "closed" && issue.closed_at ? Date.parse(issue.closed_at) : NaN;
  return Number.isFinite(closed) && now - closed <= RECENT_CLOSURE_MS;
}

/**
 * Issues shown in `previous` that `next` no longer contains although they were in progress or
 * closed moments ago. Loading or failed lanes never count: they carry no complete snapshot.
 */
export function departedIssues(previous: Lane | undefined, next: Lane, rules: Rules = {}, now = Date.now()): Issue[] {
  if (!previous || previous === next || previous.loading || previous.error || next.loading || next.error) return [];
  if (previous.repo.full_name.toLowerCase() !== next.repo.full_name.toLowerCase()) return [];
  const present = new Set(next.issues.map((issue) => issue.id));
  return previous.issues.filter((issue) => !issue.pull_request && !issue.pendingClosure && !present.has(issue.id) &&
    (column(issue, rules) === "progress" || recentlyClosed(issue, now)));
}

/** How the board shows a pending issue: a closed card that is visibly not yet confirmed. */
export function pendingIssue(entry: PendingClosure): Issue {
  const { startedAt, timerError, ...issue } = entry.issue;
  const wasClosed = issue.state === "closed" && !!issue.closed_at;
  const workStartedAt = issue.workStartedAt ?? (!wasClosed && startedAt && !timerError ? startedAt : undefined);
  return {
    ...issue,
    state: "closed",
    closed_at: wasClosed ? issue.closed_at : new Date(entry.detectedAt).toISOString(),
    ...(workStartedAt ? { workStartedAt } : {}),
    pendingClosure: true,
  };
}

/**
 * Board lanes with pending cards added. Lanes without a pending issue keep their identity, and
 * the input is never mutated. An issue the lane already contains again needs no pending card.
 */
export function withPendingClosures(lanes: readonly Lane[], pending: readonly PendingClosure[]): Lane[] {
  if (!pending.length) return lanes as Lane[];
  let changed = false;
  const result = lanes.map((lane) => {
    if (lane.loading) return lane;
    const name = lane.repo.full_name.toLowerCase();
    const ids = new Set(lane.issues.map((issue) => issue.id));
    const extra = pending.filter((entry) => entry.repository.toLowerCase() === name && !ids.has(entry.issue.id)).map(pendingIssue);
    if (!extra.length) return lane;
    changed = true;
    return { ...lane, issues: [...lane.issues, ...extra] };
  });
  return changed ? result : (lanes as Lane[]);
}

/** True when an issue response belongs to `repository`; a transferred issue redirects elsewhere. */
export function belongsTo(issue: Issue, repository: string): boolean {
  const url = typeof issue.html_url === "string" ? issue.html_url.toLowerCase() : "";
  return url.startsWith(`https://github.com/${repository.toLowerCase()}/issues/`);
}

export function verificationOutcome(entry: PendingClosure, result: Verification): VerificationOutcome {
  if (result.kind === "error") return "retry";
  if (result.kind === "gone") return "remove";
  const issue = result.issue;
  if (!issue || issue.id !== entry.issue.id || issue.pull_request || !belongsTo(issue, entry.repository)) return "remove";
  return "merge";
}

/**
 * The lane with a verified issue in place. An older response than the lane's own copy is ignored,
 * so a verification never undoes a newer sync. Closed issues outside the board's 30-day window are
 * left out as in a full load.
 */
export function mergeVerified(lane: Lane, issue: Issue, rules: Rules = {}, now = Date.now()): Lane {
  const existing = lane.issues.find((item) => item.id === issue.id);
  if (existing && Date.parse(existing.updated_at) > Date.parse(issue.updated_at)) return lane;
  const closed = issue.state === "closed" ? Date.parse(issue.closed_at ?? "") : NaN;
  const keep = issue.state !== "closed" || (Number.isFinite(closed) && closed >= now - 30 * 86400000);
  const others = lane.issues.filter((item) => item.id !== issue.id);
  const issues = keep ? (existing ? lane.issues.map((item) => (item.id === issue.id ? issue : item)) : [...lane.issues, issue]) : others;
  return {
    ...lane,
    issues,
    timerWarning: issues.some((item) => column(item, rules) === "progress" && item.timerError),
  };
}

export interface PendingClosureOptions {
  /** One targeted request for the issue's current state at GitHub. */
  verify(repository: string, issue: Issue): Promise<Verification>;
  /** Put a verified issue on the board. */
  apply(repository: string, issue: Issue): void;
  /** Final reconciliation after an entry expired without verification. */
  reconcile(repository: string): void;
  /** The pending entries changed (for the board overlay). */
  onChange(entries: readonly PendingClosure[]): void;
  /** False while GitHub asked us to wait, quota is low or the browser is offline. */
  canRequest(): boolean;
  now?: () => number;
  ttlMs?: number;
}

/** Quota guard shared with ad-hoc refreshes. */
export function verificationAllowed(state: { retryAfterMs: number; remainingQuota?: number | null; online?: boolean }): boolean {
  if (state.online === false || state.retryAfterMs > 0) return false;
  return state.remainingQuota == null || state.remainingQuota >= MIN_REMAINING_QUOTA;
}

/** Owns the pending entries, their verification requests and their deadlines. */
export class PendingClosures {
  private readonly entries = new Map<string, PendingClosure>();
  private readonly inFlight = new Set<PendingClosure>();
  /** Snapshots that already expired unverified; the same snapshot is not made pending again. */
  private readonly expired = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private epoch = 0;
  private readonly now: () => number;
  private readonly ttl: number;

  constructor(private readonly options: PendingClosureOptions) {
    this.now = options.now ?? Date.now;
    this.ttl = options.ttlMs ?? PENDING_CLOSURE_TTL_MS;
  }

  list(): PendingClosure[] {
    return [...this.entries.values()];
  }

  /**
   * Compares a repository's shown lane with its freshly synced lane: departed issues become
   * pending and are verified at once; pending issues the synced lane contains again are settled.
   */
  observe(previous: Lane | undefined, next: Lane, rules: Rules = {}): void {
    const now = this.now();
    const repository = next.repo.full_name;
    let changed = false;
    if (!next.loading && !next.error) {
      const ids = new Set(next.issues.map((issue) => issue.id));
      for (const [id, entry] of this.entries) {
        if (entry.repository.toLowerCase() === repository.toLowerCase() && ids.has(entry.issue.id)) {
          this.entries.delete(id);
          changed = true;
        }
      }
    }
    for (const issue of departedIssues(previous, next, rules, now)) {
      const id = key(repository, issue.id);
      if (this.entries.has(id) || this.expired.has(`${id}@${issue.updated_at}`)) continue;
      this.entries.set(id, { repository, issue, detectedAt: now, deadline: now + this.ttl, failures: 0, nextAttemptAt: now });
      changed = true;
    }
    if (changed) this.changed();
    this.run();
  }

  /** Forget entries of repositories that are no longer on the board. */
  retain(repositories: readonly string[]): void {
    const keep = new Set(repositories.map((name) => name.toLowerCase()));
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (!keep.has(entry.repository.toLowerCase())) {
        this.entries.delete(id);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  clear(): void {
    this.epoch++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.inFlight.clear();
    this.expired.clear();
    if (this.entries.size) {
      this.entries.clear();
      this.changed();
    }
  }

  private changed() {
    this.options.onChange(this.list());
  }

  /** Expire overdue entries, start due verifications and schedule the next wake-up. */
  run(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const now = this.now();
    const reconcile = new Set<string>();
    for (const [id, entry] of this.entries) {
      if (now < entry.deadline || this.inFlight.has(entry)) continue;
      this.entries.delete(id);
      this.expired.add(`${id}@${entry.issue.updated_at}`);
      if (this.expired.size > 200) this.expired.delete(this.expired.values().next().value!);
      reconcile.add(entry.repository);
    }
    if (reconcile.size) {
      this.changed();
      for (const repository of reconcile) this.options.reconcile(repository);
    }
    const allowed = this.options.canRequest();
    for (const [id, entry] of this.entries) {
      if (this.inFlight.has(entry) || now < entry.nextAttemptAt) continue;
      if (!allowed) {
        entry.nextAttemptAt = now + verificationRetryMs(1);
        continue;
      }
      void this.verify(id, entry);
    }
    let next = Infinity;
    for (const entry of this.entries.values())
      if (!this.inFlight.has(entry)) next = Math.min(next, entry.deadline, entry.nextAttemptAt);
    if (Number.isFinite(next)) this.timer = setTimeout(() => this.run(), Math.max(0, next - this.now()));
  }

  private async verify(id: string, entry: PendingClosure) {
    const epoch = this.epoch;
    this.inFlight.add(entry);
    let result: Verification;
    try {
      result = await this.options.verify(entry.repository, entry.issue);
    } catch {
      result = { kind: "error" };
    }
    if (epoch !== this.epoch) return;
    this.inFlight.delete(entry);
    if (this.entries.get(id) !== entry) {
      this.run();
      return;
    }
    const outcome = verificationOutcome(entry, result);
    if (outcome === "retry") {
      entry.failures++;
      entry.nextAttemptAt = this.now() + verificationRetryMs(entry.failures);
    } else {
      this.entries.delete(id);
      // Apply first, so the board never shows neither the pending nor the verified card.
      if (outcome === "merge" && result.kind === "issue") this.options.apply(entry.repository, result.issue);
      this.changed();
    }
    this.run();
  }
}
