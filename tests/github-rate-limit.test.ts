import { afterEach, expect, it, vi } from "vitest";
import { GitHub, GitHubApiError } from "../src/lib/github";
import { setLanguage } from "../src/lib/i18n";
import type { Issue, Repo } from "../src/lib/model";

const repo: Repo = { id: 1, name: "test", full_name: "sample/test", html_url: "https://github.com/sample/test", private: true, description: null, owner: { login: "sample" } };
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const limited = () => json({ message: "You have exceeded a secondary rate limit." }, { status: 429, headers: { "Retry-After": "60" } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setLanguage("auto"); });

it.each(["", "fixture-token"])("guards every request during a recorded wait and resumes at the deadline (token: %s)", async token => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T08:00:00Z"));
  setLanguage("en");
  const fetch = vi.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(json({ login: "sample" }));
  vi.stubGlobal("fetch", fetch);
  const api = new GitHub(token);
  await expect(api.request("/user")).rejects.toMatchObject({ rateLimited: true });
  await expect(api.request("https://example.com/invalid")).rejects.toThrow("Invalid API address.");
  const error = await api.request("/graphql", { method: "POST", body: "{}", store: false }).catch(error => error);
  expect(error).toBeInstanceOf(GitHubApiError);
  expect(error).toMatchObject({ status: 429, rateLimited: true, permissionDenied: false });
  expect(error.message).toBe(`GitHub API rate limit reached. Try again after ${new Date(Date.now() + 60_000).toLocaleTimeString("en-GB")}.`);
  setLanguage("sv");
  await expect(api.request("/user")).rejects.toThrow(/^GitHubs API-gräns är nådd\. Försök efter /);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(59_999);
  await expect(api.request("/user")).rejects.toMatchObject({ rateLimited: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(api.request("/user")).resolves.toMatchObject({ data: { login: "sample" } });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["full", "sync"] as const)("stops queued %s-lane timelines and pagination while preserving issues and verified starts", async mode => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T08:00:00Z"));
  const startedAt = new Date(Date.now() - 1_500_000).toISOString();
  const issues: Issue[] = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1, number: index + 1, title: "Synthetic work", html_url: `${repo.html_url}/issues/${index + 1}`,
    state: "open", labels: [{ name: "in-progress", color: "aaa" }], assignees: [], closed_at: null,
    created_at: new Date(Date.now() - 86_400_000).toISOString(), updated_at: new Date(Date.now() - 60_000).toISOString(),
  }));
  const events = [{ event: "labeled", label: { name: "in-progress" }, created_at: startedAt }];
  const api = new GitHub("fixture-token");
  let phase: "seed" | "limited" | "recovered" = "seed";
  let finishInFlight!: (response: Response) => void;
  const timelines: { number: number; page: string | null; waiting: boolean }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    const match = url.pathname.match(/\/issues\/(\d+)\/events$/);
    if (match) {
      const number = Number(match[1]);
      timelines.push({ number, page: url.searchParams.get("page"), waiting: api.retryAfterMs() > 0 });
      if (phase === "limited" && number === 2) return limited();
      if (phase === "limited" && number === 3) return await new Promise<Response>(resolve => { finishInFlight = resolve; });
      return json(events);
    }
    return json(url.pathname.endsWith("/labels") ? [{ name: "in-progress", color: "aaa" }]
      : url.searchParams.get("state") === "closed" ? [] : phase === "seed" ? [issues[0]] : issues);
  }));
  const previous = await api.lane(repo, {});
  expect(previous.issues[0]?.startedAt).toBe(startedAt);
  timelines.length = 0;
  phase = "limited";
  const work = mode === "full" ? api.lane(repo, {}, previous)
    : api.syncLane(previous, {}, Date.now(), { labels: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(api.retryAfterMs()).toBe(60_000);
  // This read began before the 429. Its successful first page may finish, but its next page must wait.
  finishInFlight(json(events, { headers: { Link: `<https://api.github.com/repos/${repo.full_name}/issues/3/events?page=2>; rel="next"` } }));
  const lane = await work;
  expect(timelines).toHaveLength(mode === "full" ? 4 : 3);
  expect(timelines.every(call => !call.waiting && call.page === null)).toBe(true);
  expect(lane.issues.map(issue => issue.id).sort((a, b) => a - b)).toEqual(issues.map(issue => issue.id));
  const byNumber = new Map(lane.issues.map(issue => [issue.number, issue]));
  expect(byNumber.get(1)).toMatchObject({ startedAt, timerError: false });
  expect(byNumber.get(2)).toMatchObject({ startedAt: null, timerError: true });
  expect(byNumber.get(3)).toMatchObject({ startedAt: null, timerError: true });
  expect(byNumber.get(4)).toMatchObject({ startedAt, timerError: false });
  expect(byNumber.get(20)).toMatchObject({ startedAt: null, timerError: true });
  expect(lane.timerWarning).toBe(true);

  phase = "recovered";
  await vi.advanceTimersByTimeAsync(60_000);
  timelines.length = 0;
  const recovered = mode === "full" ? await api.lane(repo, {}, lane)
    : await api.syncLane(lane, {}, Date.now(), { labels: false });
  expect(timelines.some(call => call.number === 2)).toBe(true);
  expect(timelines.every(call => !call.waiting)).toBe(true);
  expect(recovered.issues).toHaveLength(20);
  expect(recovered.issues.every(issue => issue.startedAt === startedAt && issue.timerError === false)).toBe(true);
  expect(recovered.timerWarning).toBe(false);
});
