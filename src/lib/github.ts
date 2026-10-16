import { permissionDefinitions, permissionEndpoint, permissionForPath, permissionResult, type PermissionObservation, type PermissionReport } from "./permissions";
import { IssueRelationsCache, issueRelationsQuery, parseIssueRelations } from "./issue-relations";
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
  type IssueComment,
  type Label,
  type Lane,
  type Repo,
  type Rules,
} from "./model";
export class GitHubApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly permissionDenied = false, public readonly rateLimited = false, public readonly emptyRepository = false) {
    super(message);
    this.name = "GitHubApiError";
  }
}
export class GitHub {
  private readonly permissionObservations = new Map<string, PermissionObservation>();
  private observePermission(path: string, ok: boolean, permissionDenied = false) {
    const permission = permissionForPath(path);
    if (permission) {
      const key = `${permission.repo}:${permission.permission}`;
      this.permissionObservations.delete(key);
      this.permissionObservations.set(key, { ok, permissionDenied, checkedAt: Date.now() });
      if (this.permissionObservations.size > 400) this.permissionObservations.delete(this.permissionObservations.keys().next().value!);
    }
  }
  async checkPermissions(repos: Repo[], options: { force?: boolean } = {}): Promise<PermissionReport> {
    const report: PermissionReport = permissionDefinitions.map(def => ({ permission: def.id, repositories: [] }));
    // Sequential repositories and four small read requests avoid bursts and pagination.
    for (const repo of repos) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)) continue;
      await Promise.all(report.map(async entry => {
        const key = `${repo.full_name}:${entry.permission}`;
        let observation = this.permissionObservations.get(key);
        if (options.force || !observation || Date.now() - observation.checkedAt > 300000) {
          if (!this.retryAfterMs()) {
            try { await this.request(permissionEndpoint(repo.full_name, entry.permission)); }
            catch (error) {
              if (!(error instanceof GitHubApiError)) this.observePermission(new URL(permissionEndpoint(repo.full_name, entry.permission), "https://api.github.com").pathname, false);
            }
          }
          observation = this.permissionObservations.get(key);
        }
        entry.repositories.push(permissionResult(repo, observation && Date.now() - observation.checkedAt <= 300000 ? observation : undefined));
      }));
    }
    return report;
  }

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
  private readonly relations = new IssueRelationsCache(async (repository, number) => {
    if (this.retryAfterMs()) return null;
    const parts = repository.split("/");
    if (parts.length !== 2 || parts.some(part => !/^[\w.-]+$/.test(part)) || !Number.isSafeInteger(number) || number < 1) return null;
    const response = await this.request<unknown>("/graphql", {
      method: "POST", body: JSON.stringify({ query: issueRelationsQuery, variables: { owner: parts[0], name: parts[1], number } }),
    });
    return parseIssueRelations(response.data);
  });
  issueRelations(repository: string, issue: Issue) { return this.relations.get(repository, issue); }
  invalidateIssueRelations() { this.relations.clear(); }
  constructor(private token: string) {}
  exportResponses() {
    return [...this.responses.entries()].slice(-100);
  }
  restoreResponses(value: unknown) {
    if (!Array.isArray(value)) return;
    for (const entry of value.slice(-100)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [url, response] = entry;
      try {
        if (typeof url !== "string" || new URL(url).origin !== "https://api.github.com" ||
          !response || typeof response !== "object" || typeof response.etag !== "string" || response.etag.length > 1024 ||
          !("data" in response) || (response.next !== null && (typeof response.next !== "string" || new URL(response.next).origin !== "https://api.github.com"))) continue;
        this.responses.set(url, { etag: response.etag, data: response.data, next: response.next });
      } catch { /* Ignore malformed cache metadata. */ }
    }
  }
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
    if (response.status === 304 && cached) {
      this.observePermission(url.pathname, true);
      return { data: cached.data as T, next: cached.next };
    }
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
      const rateLimited = response.status === 429 || !!retry || response.headers.get("x-ratelimit-remaining") === "0";
      const body = await response.json().catch(() => null) as { message?: unknown } | null;
      const permissionDenied = response.status === 403 && !rateLimited && typeof body?.message === "string" &&
        /^Resource not accessible by (personal access token|integration)\.?$/i.test(body.message);
      this.observePermission(url.pathname, false, permissionDenied);
      throw new GitHubApiError(
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
        response.status, permissionDenied, rateLimited,
        response.status === 409 && typeof body?.message === "string" && /^Git Repository is empty\.?$/i.test(body.message),
      );
    }
    this.observePermission(url.pathname, true);
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
  issueComments(repoFullName: string, issueNumber: number) {
    const parts = repoFullName.split("/");
    if (parts.length !== 2 || parts.some(part => !/^[\w.-]+$/.test(part)) ||
      !Number.isSafeInteger(issueNumber) || issueNumber < 1)
      throw new Error(t("Ogiltig API-adress."));
    return this.all<IssueComment>(`/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=100`);
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
    // A day-stable request URL allows ETags to survive reloads. Filter by the exact window below.
    const requestSince = new Date(Math.floor(Date.now() / 86400000) * 86400000 - 30 * 86400000).toISOString();
    const [open, closed, labels] = await Promise.all([
      this.all<Issue>(
        `${root}/issues?state=open&per_page=100&sort=created&direction=asc`,
      ),
      this.all<Issue>(
        `${root}/issues?state=closed&per_page=100&sort=updated&direction=desc&since=${requestSince}`,
      ),
      this.all<Label>(`${root}/labels?per_page=100`),
    ]);
    // Copy before enrichment: request() returns the objects held in the ETag cache.
    const issues = [
      ...open,
      ...closed.filter((i) => i.closed_at && i.closed_at >= since),
    ].filter((i) => !i.pull_request).map((i) => ({ ...i }));
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
            issue.timerError = false;
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
