import type { Issue } from "./model";

export interface ClosingCommit {
  kind: "commit" | "pull-request";
  sha: string | null;
  url: string;
  additions: number | null;
  deletions: number | null;
  pullRequestNumber?: number;
}
export interface ClosingResponse {
  errors?: { message: string }[];
  data?: {
    repository: {
      issue: {
        state: string;
        closedAt: string | null;
        timelineItems: { nodes: {
          createdAt: string;
          closer: null | {
            __typename: "Commit" | "PullRequest";
            oid?: string;
            url: string;
            additions?: number;
            deletions?: number;
            merged?: boolean;
            number?: number;
            mergeCommit?: { oid: string } | null;
          };
        }[] };
      } | null;
    } | null;
  };
}
export const closingQuery = `query ClosingCommit($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      state closedAt
      timelineItems(last: 1, itemTypes: [CLOSED_EVENT]) {
        nodes { ... on ClosedEvent {
          createdAt
          closer {
            __typename
            ... on Commit { oid url additions deletions }
            ... on PullRequest { number url merged additions deletions mergeCommit { oid } }
          }
        } }
      }
    }
  }
}`;

export function parseClosingCommit(response: ClosingResponse, issue: Issue): ClosingCommit | null {
  if (response.errors?.length || !response.data?.repository?.issue)
    throw new Error("Stängande commit kunde inte hämtas.");
  const current = response.data.repository.issue;
  const event = current.timelineItems.nodes.at(-1);
  const sameTime = (value: string | null | undefined) =>
    Boolean(value && issue.closed_at && Date.parse(value) === Date.parse(issue.closed_at));
  if (issue.state !== "closed" || current.state !== "CLOSED" ||
    !sameTime(current.closedAt) || !event || !sameTime(event.createdAt)) return null;
  const closer = event.closer;
  if (!closer || (closer.__typename === "PullRequest" && !closer.merged)) return null;
  // Only render GitHub HTTPS destinations returned by the authenticated API.
  const url = new URL(closer.url);
  if (url.origin !== "https://github.com") throw new Error("Stängande commit kunde inte hämtas.");
  return {
    kind: closer.__typename === "Commit" ? "commit" : "pull-request",
    sha: closer.__typename === "Commit" ? closer.oid ?? null : closer.mergeCommit?.oid ?? null,
    url: url.href,
    additions: closer.additions ?? null,
    deletions: closer.deletions ?? null,
    ...(closer.__typename === "PullRequest" ? { pullRequestNumber: closer.number } : {}),
  };
}

/** Per-session cache. Successful misses are cached; transient errors can be retried. */
export class ClosingCommitCache {
  private entries = new Map<string, Promise<ClosingCommit | null>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly fetchCommit: (repo: string, issue: Issue) => Promise<ClosingCommit | null>) {}

  get(repo: string, issue: Issue): Promise<ClosingCommit | null> {
    if (issue.state !== "closed" || !issue.closed_at) return Promise.resolve(null);
    const key = JSON.stringify([repo, issue.number, issue.closed_at]);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const result = this.run(repo, { ...issue }).catch((error) => {
      if (this.entries.get(key) === result) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, result);
    if (this.entries.size > 300) this.entries.delete(this.entries.keys().next().value!);
    return result;
  }

  private async run(repo: string, issue: Issue): Promise<ClosingCommit | null> {
    if (this.active >= 3) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try { return await this.fetchCommit(repo, issue); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
