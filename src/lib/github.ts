import { t, locale } from "./i18n";
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
  constructor(private token: string) {}
  async request<T>(path: string): Promise<{ data: T; next: string | null }> {
    const url = new URL(path, "https://api.github.com");
    if (url.origin !== "https://api.github.com")
      throw new Error("Ogiltig API-adress.");
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      const reset = response.headers.get("x-ratelimit-reset");
      throw new Error(
        response.status === 401
          ? t("Sessionen har gått ut. Logga in igen.")
          : response.status === 403 || response.status === 429
            ? t("Åtkomst nekad eller API-gräns nådd.") + (reset
              ? t(" Försök efter {time}.", { time: new Date(Number(reset) * 1000).toLocaleTimeString(locale.value) })
              : t(" Kontrollera tokenens behörigheter."))
            : t("GitHub svarade {status}. Kontrollera att du har åtkomst till repot.", { status: response.status }),
      );
    }
    return {
      data: (await response.json()) as T,
      next:
        response.headers.get("link")?.match(/<([^>]+)>; rel="next"/)?.[1] ||
        null,
    };
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
