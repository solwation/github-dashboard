import { demo } from "./demo";
import { statisticsWindow, type StatisticsCommit, type StatisticsData } from "./statistics";

/** Fictional demo data only; never derived from an authenticated session. */
export function demoStatistics(repository: string, now = Date.now()): StatisticsData {
  const window = statisticsWindow(now);
  const lane = demo().find(item => item.repo.full_name === repository) || demo()[0]!;
  const issues = lane.issues.map((issue, index) => ({ ...issue, user: { login: index % 2 ? "demo-alex" : "demo-sam" } }));
  const commits: StatisticsCommit[] = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(now - (index % 30) * 86400000).toISOString();
    return { sha: `demo-${index}`, parents: index % 9 ? [{ sha: "parent" }] : [{ sha: "first" }, { sha: "second" }], author: { login: index % 2 ? "demo-alex" : "demo-sam" }, commit: { author: { name: "Demo", date }, committer: { date } } };
  });
  const source = <T>(data: T[]) => ({ data, complete: true, fetchedAt: now });
  return {
    repository, ...window, fetchedAt: now, temporary: [], issues: source(issues),
    events: source(issues.filter(issue => issue.closed_at).map(issue => ({ id: issue.id, event: "closed", created_at: issue.closed_at!, issue, actor: issue.user }))),
    commits: source(commits),
    changes: source(commits.filter(commit => commit.parents.length < 2).map((commit, index) => ({ sha: commit.sha, date: commit.commit.committer!.date, contributor: commit.author!.login, additions: 20 + index * 3, deletions: 5 + index, files: 1 + index % 4, filesComplete: true }))),
    pulls: source(Array.from({ length: 6 }, (_, index) => ({ id: index, created_at: new Date(now - (index + 2) * 86400000).toISOString(), updated_at: new Date(now - index * 86400000).toISOString(), closed_at: index % 2 ? new Date(now - index * 86400000).toISOString() : null, merged_at: index % 2 ? new Date(now - index * 86400000).toISOString() : null, labels: [{ name: "enhancement" }], user: { login: index % 2 ? "demo-alex" : "demo-sam" } }))),
  };
}
