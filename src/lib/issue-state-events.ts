import { awaitsIntegration, column, isCoordination, type Issue, type Lane, type Rules } from "./model";
export type IssueEventStatus = "backlog" | "progress" | "integration" | "closed";
export type IssueStateChange = { repository: string; issue: Issue; from: IssueEventStatus; to: IssueEventStatus };
const status = (issue: Issue, rules: Rules): IssueEventStatus => awaitsIntegration(issue, rules) ? "integration" : column(issue, rules) as IssueEventStatus;
/** Live observations only: initial loads and rule edits establish a baseline, never movements. */
export class IssueStateEventTracker {
  private snapshots = new Map<string, { rules: string; issues: Map<number, IssueEventStatus> }>();
  update(lanes: Lane[], rules: Record<string, Rules>, hideCoordination = false): IssueStateChange[] {
    const changes: IssueStateChange[] = [];
    for (const lane of lanes) {
      if (lane.loading || lane.error) continue;
      const repository = lane.repo.full_name, repoRules = rules[repository] || {};
      const ruleKey = JSON.stringify(Object.entries(repoRules).sort(([a], [b]) => a.localeCompare(b)));
      const previous = this.snapshots.get(repository), current = new Map<number, IssueEventStatus>();
      for (const issue of lane.issues) {
        if (issue.pull_request || issue.pendingClosure) continue;
        const to = status(issue, repoRules), from = previous?.issues.get(issue.id);
        current.set(issue.id, to);
        if (from && from !== to && previous?.rules === ruleKey && !(hideCoordination && isCoordination(issue))) changes.push({ repository, issue, from, to });
      }
      this.snapshots.set(repository, { rules: ruleKey, issues: current });
    }
    return changes;
  }
  retain(repositories: string[]) { for (const name of this.snapshots.keys()) if (!repositories.includes(name)) this.snapshots.delete(name); }
  clear() { this.snapshots.clear(); }
}
