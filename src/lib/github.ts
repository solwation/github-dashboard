import { t, locale } from "./i18n";
import {
  ClosingCommitCache,
  closingQuery,
  parseClosingCommit,
  type ClosingResponse,
} from "./commits";
import {
  column,
  progressStart,
  type Event,
  type Issue,
  type Label,
  type Lane,
  type Repo,
  type Rules,
} from "./model";
export class GitHub {
  private readonly responses = new Map<
    string,
    { etag: string; data: unknown; next: string | null }
  >();
  private limitedUntil = 0;
  retryAfterMs() {
    return Math.max(0, this.limitedUntil - Date.now());
  }

  private readonly commits = new ClosingCommitCache(async (repo, issue) => {
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new Error(t("Ogiltig API-adress."));
    const response = await this.request<ClosingResponse>("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query: closingQuery,
        variables: { owner, name, number: issue.number },
      }),
    });
    return parseClosingCommit(response.data, issue);
  });
  constructor(private token: string) {}
  closingCommit(repoFullName: string, issue: Issue) {
    return this.commits.get(repoFullName, issue);
  }
  async request<T>(
    path: string,
    options: { method?: "GET" | "POST"; body?: string } = {},
  ): Promise<{ data: T; next: string | null }> {
    const url = new URL(path, "https://api.github.com");
    if (url.origin !== "https://api.github.com")
      throw new Error(t("Ogiltig API-adress."));
    const cacheable = !options.method || options.method === "GET";
    const cached = cacheable ? this.responses.get(url.href) : undefined;
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        ...(cached ? { "If-None-Match": cached.etag } : {}),
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (response.status === 304 && cached)
      return { data: cached.data as T, next: cached.next };
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      const resetAt = response.headers.get("x-ratelimit-reset");
      if (retry)
        this.limitedUntil = Math.max(
          this.limitedUntil,
          /^\d+$/.test(retry)
            ? Date.now() + Number(retry) * 1000
            : Date.parse(retry) || 0,
        );
      if (resetAt && response.headers.get("x-ratelimit-remaining") === "0")
        this.limitedUntil = Math.max(this.limitedUntil, Number(resetAt) * 1000);
      const reset = response.headers.get("x-ratelimit-reset");
      throw new Error(
        response.status === 401
          ? t("Sessionen har gått ut. Logga in igen.")
          : response.status === 403 || response.status === 429
            ? t("Åtkomst nekad eller API-gräns nådd.") +
              (reset
                ? t(" Försök efter {time}.", {
                    time: new Date(Number(reset) * 1000).toLocaleTimeString(
                      locale.value,
                    ),
                  })
                : t(" Kontrollera tokenens behörigheter."))
            : t(
                "GitHub svarade {status}. Kontrollera att du har åtkomst till repot.",
                { status: response.status },
              ),
      );
    }
    const result = {
      data: (await response.json()) as T,
      next:
        response.headers.get("link")?.match(/<([^>]+)>; rel="next"/)?.[1] ||
        null,
    };
    const etag = response.headers.get("etag");
    if (cacheable && etag) {
      this.responses.delete(url.href);
      this.responses.set(url.href, { etag, ...result });
      if (this.responses.size > 600)
        this.responses.delete(this.responses.keys().next().value!);
    }
    return result;
  }

  async all<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    let next: string | null = path;
    while (next) {
      const page: { data: T[]; next: string | null } =
        await this.request<T[]>(next);
      result.push(...page.data);
      next = page.next;
    }
    return result;
  }
  async user() {
    return (await this.request<{ login: string; avatar_url: string }>("/user"))
      .data;
  }
  repos() {
    return this.all<Repo>(
      "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    );
  }
  private async startTime(
    repo: Repo,
    issue: Issue,
    rules: Rules,
    old?: Issue,
  ): Promise<Issue> {
    if (column(issue, rules) !== "progress") return issue;
    if (
      old?.updated_at === issue.updated_at &&
      old.startedAt &&
      !old.timerError
    )
      return { ...issue, startedAt: old.startedAt };
    try {
      const events = await this.all<Event>(
        `/repos/${repo.full_name}/issues/${issue.number}/events?per_page=100`,
      );
      return {
        ...issue,
        startedAt: progressStart(events, rules),
        timerError: false,
      };
    } catch {
      return { ...issue, startedAt: null, timerError: true };
    }
  }
  async activeIssue(repo: Repo, issue: Issue, rules: Rules): Promise<Issue> {
    const { data } = await this.request<Issue>(
      `/repos/${repo.full_name}/issues/${issue.number}`,
    );
    return this.startTime(repo, data, rules, issue);
  }
  async syncLane(previous: Lane, rules: Rules, since: number): Promise<Lane> {
    const root = `/repos/${previous.repo.full_name}`;
    const [changed, labels] = await Promise.all([
      this.all<Issue>(
        `${root}/issues?state=all&per_page=100&sort=updated&direction=desc&since=${new Date(since - 5000).toISOString()}`,
      ),
      this.all<Label>(`${root}/labels?per_page=100`),
    ]);
    const issues = new Map(previous.issues.map((issue) => [issue.id, issue]));
    const candidates = changed.filter((issue) => !issue.pull_request);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, candidates.length) }, async () => {
        while (cursor < candidates.length) {
          const issue = candidates[cursor++]!;
          issues.set(
            issue.id,
            await this.startTime(
              previous.repo,
              issue,
              rules,
              issues.get(issue.id),
            ),
          );
        }
      }),
    );
    const cutoff = Date.now() - 30 * 86400000;
    const current = [...issues.values()].filter(
      (issue) =>
        issue.state !== "closed" ||
        (issue.closed_at && Date.parse(issue.closed_at) >= cutoff),
    );
    return {
      repo: previous.repo,
      labels,
      issues: current,
      timerWarning: current.some(
        (issue) => column(issue, rules) === "progress" && issue.timerError,
      ),
    };
  }
  async lane(repo: Repo, rules: Rules): Promise<Lane> {
    const root = `/repos/${repo.full_name}`;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [open, closed, labels] = await Promise.all([
      this.all<Issue>(
        `${root}/issues?state=open&per_page=100&sort=created&direction=asc`,
      ),
      this.all<Issue>(
        `${root}/issues?state=closed&per_page=100&sort=updated&direction=desc&since=${since}`,
      ),
      this.all<Label>(`${root}/labels?per_page=100`),
    ]);
    const issues = [
      ...open,
      ...closed.filter((i) => i.closed_at && i.closed_at >= since),
    ].filter((i) => !i.pull_request);
    const active = issues.filter((i) => column(i, rules) === "progress");
    // Limit simultaneous timeline requests; each timeline is fully paginated.
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, active.length) }, async () => {
        while (cursor < active.length) {
          const issue = active[cursor++]!;
          try {
            issue.startedAt = progressStart(
              await this.all<Event>(
                `${root}/issues/${issue.number}/events?per_page=100`,
              ),
              rules,
            );
          } catch {
            issue.timerError = true;
          }
        }
      }),
    );
    return {
      repo,
      issues,
      labels,
      timerWarning: active.some((i) => i.timerError),
    };
  }
}
