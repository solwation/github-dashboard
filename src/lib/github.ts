import { publicRepositoryName, publicRepositoryRecord } from "./public-workspace";
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
  carriedWorkStart,
  deriveWorkStarts,
  type RepositoryIssueEvent,
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
  /** When each in-memory entry was last confirmed by GitHub (200 or 304); restored entries have none (#136). */
  private readonly validatedAt = new WeakMap<object, number>();
  /** The latest full lane load per repository, so statistics can reuse its list responses (#136). */
  private readonly laneRuns = new Map<string, { startedAt: number; done: boolean; open: string; closed: string; closedSince: string }>();
  private limitedUntil = 0;
  retryAfterMs() {
    return Math.max(0, this.limitedUntil - Date.now());
  }
  private quota: { remaining: number; limit: number; resetAt: number } | null = null;
  /** Latest REST core quota from response headers; null when unknown or already reset (#135). */
  rateLimit() {
    return this.quota && this.quota.resetAt > Date.now() ? { ...this.quota } : null;
  }
  private observeQuota(url: URL, headers: Headers) {
    const resource = headers.get("x-ratelimit-resource");
    if (url.pathname === "/graphql" || (resource && resource !== "core")) return;
    const remaining = Number(headers.get("x-ratelimit-remaining") ?? NaN), limit = Number(headers.get("x-ratelimit-limit") ?? NaN), reset = Number(headers.get("x-ratelimit-reset") ?? NaN);
    if (Number.isFinite(remaining) && Number.isFinite(limit) && Number.isFinite(reset) && limit > 0) this.quota = { remaining, limit, resetAt: reset * 1000 };
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
  issueRelations(repository: string, issue: Issue) { return this.token ? this.relations.get(repository, issue) : Promise.resolve(null); }
  invalidateIssueRelations(repositories?: readonly string[]) { this.relations.clear(repositories); }
  constructor(private token: string = "") {}
  get authenticated() { return Boolean(this.token); }
  async publicRepository(input: string): Promise<Repo> {
    const name = publicRepositoryName(input);
    if (!name) throw new Error(t("Ange ägare/repo eller en GitHub-adress till repot."));
    const { data } = await this.request<Repo>(`/repos/${name}`);
    const repo = publicRepositoryRecord(data);
    if (!repo) throw new Error(t("Endast publika repositories kan läggas till här."));
    return repo;
  }
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
    return this.token ? this.commits.get(repoFullName, issue) : Promise.resolve(null);
  }
  async request<T>(
    path: string,
    options: { method?: "GET" | "POST"; body?: string; store?: boolean } = {},
  ): Promise<{ data: T; next: string | null }> {
    const url = new URL(path, "https://api.github.com");
    if (url.origin !== "https://api.github.com")
      throw new Error(t("Ogiltig API-adress."));
    // One-shot URLs (store: false) would never be revalidated and only evict reusable ETags (#108).
    const { store = true, ...init } = options;
    const cacheable = store && (!init.method || init.method === "GET");
    const cached = cacheable ? this.responses.get(url.href) : undefined;
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        ...(cached ? { "If-None-Match": cached.etag } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    this.observeQuota(url, response.headers);
    if (response.status === 304 && cached) {
      this.observePermission(url.pathname, true);
      // Keep revalidated entries most recent so exportResponses() retains them (#108).
      this.responses.delete(url.href);
      this.responses.set(url.href, cached);
      this.validatedAt.set(cached, Date.now());
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
      const rateLimited = response.status === 429 || !!retry || response.headers.get("x-ratelimit-remaining") === "0";
      // Only a genuine rate limit shows a retry time; GitHub sends X-RateLimit-Reset on every response (#107).
      const retryAt = rateLimited
        ? this.limitedUntil > Date.now() ? this.limitedUntil : Number(resetAt) * 1000 || 0
        : 0;
      const body = await response.json().catch(() => null) as { message?: unknown } | null;
      const permissionDenied = response.status === 403 && !rateLimited && typeof body?.message === "string" &&
        /^Resource not accessible by (personal access token|integration)\.?$/i.test(body.message);
      this.observePermission(url.pathname, false, permissionDenied);
      throw new GitHubApiError(
        response.status === 401
          ? this.token ? t("Sessionen har gått ut. Logga in igen.") : t("Åtkomst nekad.")
          : response.status === 403 || response.status === 429
            ? rateLimited
              ? t("GitHubs API-gräns är nådd.") +
                (retryAt > Date.now()
                  ? t(" Försök efter {time}.", {
                      time: new Date(retryAt).toLocaleTimeString(locale.value),
                    })
                  : t(" Försök igen senare."))
              : t("Åtkomst nekad.") + (this.token ? t(" Kontrollera tokenens behörigheter.") : "")
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
      const entry = { etag, ...result };
      this.responses.delete(url.href);
      this.responses.set(url.href, entry);
      this.validatedAt.set(entry, Date.now());
      if (this.responses.size > 600)
        this.responses.delete(this.responses.keys().next().value!);
    }
    return result;
  }

  /**
   * A fully cached page chain from one pass: all() fetches pages in order, so every page must be
   * confirmed at or after `after` and no earlier than the page before it. Returns the first page's time.
   */
  private cachedChain(href: string, after: number) {
    const data: unknown[] = [];
    let next: string | null = href, previous = after, validated = NaN;
    for (let page = 0; next; page++) {
      const entry: { data: unknown; next: string | null } | undefined = page < 100 ? this.responses.get(new URL(next, "https://api.github.com").href) : undefined;
      const at = entry ? this.validatedAt.get(entry) : undefined;
      if (!entry || at === undefined || at < previous || !Array.isArray(entry.data)) return null;
      if (!page) validated = at;
      data.push(...entry.data);
      previous = at;
      next = entry.next;
    }
    return { data, validated };
  }
  /**
   * Issues (without pull requests) updated at or after `since`, rebuilt from the board's own list
   * responses without any request (#136): the last complete full lane load (all open issues plus
   * closed issues updated since its day-stable window) merged with a later incremental `since` list
   * anchored at or before that load. Returns null unless every page was confirmed by GitHub within
   * `maxAgeMs` and the board window covers `since`, so callers fall back to their own request.
   */
  boardIssues(repoFullName: string, since: string, maxAgeMs = 300_000, now = Date.now()): Issue[] | null {
    const run = this.laneRuns.get(repoFullName), from = Date.parse(since);
    if (!run?.done || !Number.isFinite(from) || Date.parse(run.closedSince) > from) return null;
    const open = this.cachedChain(run.open, run.startedAt), closed = this.cachedChain(run.closed, run.startedAt);
    if (!open || !closed) return null;
    let fresh = Math.min(open.validated, closed.validated);
    const lists = [open.data, closed.data];
    const incremental = this.sinceUrls.get(repoFullName);
    const anchor = incremental ? Date.parse(new URL(incremental).searchParams.get("since") || "") : NaN;
    const changes = incremental && anchor <= run.startedAt ? this.cachedChain(incremental, -Infinity) : null;
    if (changes) { lists.push(changes.data); fresh = Math.max(fresh, changes.validated); }
    if (now - fresh > maxAgeMs || fresh > now + 60_000) return null;
    const issues = new Map<number, Issue>();
    for (const item of lists.flat() as Issue[]) {
      if (!item || typeof item !== "object" || !Number.isSafeInteger(item.id) || typeof item.updated_at !== "string") return null;
      const known = issues.get(item.id);
      if (!known || item.updated_at >= known.updated_at) issues.set(item.id, item);
    }
    return [...issues.values()].filter(issue => !issue.pull_request && Date.parse(issue.updated_at) >= from).map(issue => ({ ...issue }));
  }

  async all<T>(path: string, options: { store?: boolean } = {}): Promise<T[]> {
    const result: T[] = [];
    let next: string | null = path;
    while (next) {
      const page: { data: T[]; next: string | null } =
        await this.request<T[]>(next, options);
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
    if (column(issue, rules) !== "progress") {
      // A closing seen by sync keeps the in-progress start for estimates, without extra requests (#141).
      const workStartedAt = carriedWorkStart(issue, old, rules);
      return workStartedAt ? { ...issue, workStartedAt } : issue;
    }
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
  /** Revalidates label definitions at most this often during reconciliation (#123). */
  static readonly LABELS_TTL_MS = 600_000;
  private readonly labelsCheckedAt = new Map<string, number>();
  private readonly sinceUrls = new Map<string, string>();
  private async labels(repoFullName: string) {
    const labels = await this.all<Label>(`/repos/${repoFullName}/labels?per_page=100`);
    this.labelsCheckedAt.set(repoFullName, Date.now());
    return labels;
  }
  /**
   * Incremental lane update from one conditional list request per repository (#123).
   * `since` should be the start of the repository's last full load: the anchor stays fixed between
   * full loads, so unchanged repositories answer 304, which GitHub does not count against the rate
   * limit. Only the current anchor's entry is kept, so superseded URLs never evict stable ETags (#108).
   * Labels are revalidated when `labels` is not false and the TTL has passed, or when a changed issue
   * carries a label the lane has not seen.
   */
  async syncLane(previous: Lane, rules: Rules, since: number, options: { labels?: boolean } = {}): Promise<Lane> {
    const name = previous.repo.full_name;
    const root = `/repos/${name}`;
    const anchor = Math.floor((since - 5000) / 60000) * 60000;
    const path = `${root}/issues?state=all&per_page=100&sort=updated&direction=desc&since=${new Date(anchor).toISOString()}`;
    const href = new URL(path, "https://api.github.com").href;
    const superseded = this.sinceUrls.get(name);
    if (superseded && superseded !== href) this.responses.delete(superseded);
    this.sinceUrls.delete(name);
    this.sinceUrls.set(name, href);
    if (this.sinceUrls.size > 200) this.sinceUrls.delete(this.sinceUrls.keys().next().value!);
    const labelsDue = options.labels !== false && Date.now() - (this.labelsCheckedAt.get(name) ?? 0) >= GitHub.LABELS_TTL_MS;
    const [changed, revalidated] = await Promise.all([
      this.all<Issue>(path),
      labelsDue ? this.labels(name) : undefined,
    ]);
    // Copy before enrichment: request() returns the objects held in the ETag cache.
    const candidates = changed.filter((issue) => !issue.pull_request).map((issue) => ({ ...issue }));
    const known = new Set(previous.labels.map((label) => label.name));
    const labels = revalidated ?? (candidates.some((issue) => issue.labels.some((label) => !known.has(label.name)))
      ? await this.labels(name) : previous.labels);
    const issues = new Map(previous.issues.map((issue) => [issue.id, issue]));
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
  /**
   * Full lane load. `previous` (the shown lane, if any) only carries local closing work starts
   * (#141) for issues it held in progress or already closed with a known start; it adds no requests.
   */
  async lane(repo: Repo, rules: Rules, previous?: Pick<Lane, "issues">): Promise<Lane> {
    const root = `/repos/${repo.full_name}`;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    // A day-stable request URL allows ETags to survive reloads. Filter by the exact window below.
    const requestSince = new Date(Math.floor(Date.now() / 86400000) * 86400000 - 30 * 86400000).toISOString();
    const openPath = `${root}/issues?state=open&per_page=100&sort=created&direction=asc`;
    const closedPath = `${root}/issues?state=closed&per_page=100&sort=updated&direction=desc&since=${requestSince}`;
    const run = { startedAt: Date.now(), done: false, open: new URL(openPath, "https://api.github.com").href, closed: new URL(closedPath, "https://api.github.com").href, closedSince: requestSince };
    this.laneRuns.delete(repo.full_name);
    this.laneRuns.set(repo.full_name, run);
    if (this.laneRuns.size > 200) this.laneRuns.delete(this.laneRuns.keys().next().value!);
    const [open, closed, labels] = await Promise.all([
      this.all<Issue>(openPath),
      this.all<Issue>(closedPath),
      this.labels(repo.full_name),
    ]);
    run.done = true;
    // Copy before enrichment: request() returns the objects held in the ETag cache.
    const issues = [
      ...open,
      ...closed.filter((i) => i.closed_at && i.closed_at >= since),
    ].filter((i) => !i.pull_request).map((i) => ({ ...i }));
    const known = previous?.issues.length ? new Map(previous.issues.map((issue) => [issue.id, issue])) : undefined;
    if (known) for (const issue of issues) {
      const workStartedAt = carriedWorkStart(issue, known.get(issue.id), rules);
      if (workStartedAt) issue.workStartedAt = workStartedAt;
    }
    if (!this.token) {
      // One shared, bounded history read replaces per-active-issue fan-out in public mode.
      // Missing history stays unknown; closure time is never substituted for a work start.
      const events: RepositoryIssueEvent[] = [];
      let next: string | null = `${root}/issues/events?per_page=100`;
      try {
        for (let page = 0; next && page < 2 && !this.retryAfterMs(); page++) {
          const response: { data: RepositoryIssueEvent[]; next: string | null } = await this.request(next);
          events.push(...response.data); next = response.next;
        }
      } catch { /* Optional timeline data can be absent while the public board remains usable. */ }
      const enriched = deriveWorkStarts({ repo, issues, labels }, events, rules);
      return { ...enriched, issues: enriched.issues.map(issue => column(issue, rules) === "progress"
        ? { ...issue, startedAt: progressStart(events.filter(event => event.issue?.id === issue.id), rules) ?? (known?.get(issue.id)?.updated_at === issue.updated_at ? known?.get(issue.id)?.startedAt : null) ?? null }
        : issue) };
    }
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
