import type { Issue, Lane } from "./model";

/** Compare only successful snapshots. The first snapshot is a silent baseline. */
export class ClosureTracker {
  private snapshots = new Map<
    string,
    { at: number; issues: Map<number, Pick<Issue, "state" | "closed_at">> }
  >();

  update(lane: Lane, at = Date.now()): Issue[] {
    if (lane.error) return [];
    const previous = this.snapshots.get(lane.repo.full_name);
    this.snapshots.set(lane.repo.full_name, {
      at,
      issues: new Map(
        lane.issues.map((issue) => [
          issue.id,
          { state: issue.state, closed_at: issue.closed_at },
        ]),
      ),
    });
    if (!previous) return [];
    return lane.issues.filter((issue) => {
      if (issue.pull_request || issue.state !== "closed" || !issue.closed_at)
        return false;
      const old = previous.issues.get(issue.id);
      return old
        ? old.state !== "closed" || old.closed_at !== issue.closed_at
        : Date.parse(issue.closed_at) > previous.at;
    });
  }

  retain(repositories: string[]) {
    for (const name of this.snapshots.keys())
      if (!repositories.includes(name)) this.snapshots.delete(name);
  }

  clear() {
    this.snapshots.clear();
  }
}

export const closureKey = (repo: string, issue: Issue) =>
  `${repo}:${issue.id}:${issue.closed_at}`;
