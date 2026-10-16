import { column, isCoordination, normalize, type Issue, type Lane, type Rules } from "./model";

export type StatusSound = "progress" | "closed" | "negative";
interface Snapshot { column: string; blocked: boolean; closedAt: string | null }
const snapshot = (issue: Issue, rules: Rules): Snapshot => ({
  column: column(issue, rules),
  blocked: issue.labels.some(label => ["blocked", "status blocked"].includes(normalize(label.name))),
  closedAt: issue.closed_at,
});

/** Only live, observed transitions generate sounds. Cached data must not seed this tracker. */
export class StatusTransitionTracker {
  private snapshots = new Map<string, { rules: string; issues: Map<number, Snapshot> }>();

  update(lanes: Lane[], rules: Record<string, Rules>, enabled: (repo: string) => boolean, hideCoordination = false): StatusSound[] {
    const sounds = new Set<StatusSound>();
    for (const lane of lanes) {
      if (lane.error) continue;
      const repo = lane.repo.full_name;
      const repoRules = rules[repo] || {};
      const ruleKey = JSON.stringify(Object.entries(repoRules).sort(([a], [b]) => a.localeCompare(b)));
      const previous = this.snapshots.get(repo);
      const current = new Map<number, Snapshot>();
      for (const issue of lane.issues) {
        if (issue.pull_request) continue;
        const next = snapshot(issue, repoRules);
        current.set(issue.id, next);
        const before = previous?.issues.get(issue.id);
        if (!before || previous?.rules !== ruleKey || !enabled(repo) || (hideCoordination && isCoordination(issue))) continue;
        if ((!before.blocked && next.blocked) || (before.column !== "backlog" && next.column === "backlog")) sounds.add("negative");
        else if (next.column === "closed" && (before.column !== "closed" || before.closedAt !== next.closedAt)) sounds.add("closed");
        else if (before.column !== "progress" && next.column === "progress") sounds.add("progress");
      }
      this.snapshots.set(repo, { rules: ruleKey, issues: current });
    }
    return [...sounds];
  }

  retain(repos: string[]) {
    for (const repo of this.snapshots.keys()) if (!repos.includes(repo)) this.snapshots.delete(repo);
  }
  clear() { this.snapshots.clear(); }
}

const priority: Record<StatusSound, number> = { progress: 0, closed: 1, negative: 2 };
const notes: Record<StatusSound, number[]> = {
  progress: [440, 554], closed: [523, 659, 784], negative: [330, 247, 196],
};

/** Synthesized local tones: no assets, network calls, or overlapping audio. */
export class StatusSoundPlayer {
  private context: AudioContext | null = null;
  private pending: StatusSound | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busyUntil = 0;

  constructor(private readonly unavailable: () => void = () => {}, private readonly createContext = () => new AudioContext()) {}

  /** Call directly in a click/key handler, before awaiting notification permission. */
  async unlock(): Promise<boolean> {
    try {
      this.context ||= this.createContext();
      if (this.context.state !== "running") await this.context.resume();
      return this.context.state === "running";
    } catch { return false; }
  }

  play(sounds: StatusSound[]) {
    if (!sounds.length) return;
    if (this.context?.state !== "running") { this.unavailable(); return; }
    for (const sound of sounds) {
      if (!this.pending || priority[sound] > priority[this.pending]) this.pending = sound;
    }
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), Math.max(120, this.busyUntil - this.context.currentTime * 1000));
  }

  private flush() {
    this.timer = null;
    const sound = this.pending;
    this.pending = null;
    if (!sound) return;
    const context = this.context;
    if (context?.state !== "running") { this.unavailable(); return; }
    try {
      const start = context.currentTime;
      for (const [index, frequency] of notes[sound].entries()) {
        const at = start + index * 0.12;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.09, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.105);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at);
        oscillator.stop(at + 0.11);
      }
      this.busyUntil = (start + notes[sound].length * 0.12 + 0.12) * 1000;
    } catch { this.unavailable(); }
  }

  /** Forget queued sounds when changing account or leaving the board. */
  clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
