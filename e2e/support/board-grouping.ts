import { expect, type Page } from "@playwright/test";

export type BoardGrouping = "none" | "split" | "swimlanes";
const optionNames: Record<BoardGrouping, RegExp> = { none: /^(Ingen|None)$/, split: /^(Dela upp|Split)$/, swimlanes: /^(Simbanor|Swimlanes)$/ };

/** The None/Split/Swimlanes control (#390) in either language. */
export function groupingControl(page: Page) {
  return page.getByRole("group", { name: /^(Gruppering per repository|Group by repository)$/ });
}
export function groupingOption(page: Page, grouping: BoardGrouping) {
  return groupingControl(page).getByRole("button", { name: optionNames[grouping] });
}
export async function setBoardGrouping(page: Page, grouping: BoardGrouping) {
  await groupingOption(page, grouping).click();
  await expect(groupingOption(page, grouping)).toHaveAttribute("aria-pressed", "true");
}
/**
 * Checkbox-like access for specs written for the former "Split by repository" checkbox:
 * checked means Split and unchecked means None.
 */
export function boardSplit(page: Page) {
  return {
    check: () => setBoardGrouping(page, "split"),
    uncheck: () => setBoardGrouping(page, "none"),
    setChecked: (split: boolean) => setBoardGrouping(page, split ? "split" : "none"),
    count: () => groupingControl(page).count(),
    isChecked: async () => await groupingOption(page, "split").getAttribute("aria-pressed") === "true",
    expectChecked: (split = true) => expect(groupingOption(page, "split")).toHaveAttribute("aria-pressed", split ? "true" : "false"),
  };
}

const longName = "a-very-long-repository-name-that-keeps-going-for-truncation-checks";
/** Fictional repositories: one long name, one with no work in progress, and enough lanes to scroll. */
export async function groupingFixture(page: Page, count = 5, login = "grouping-fixture") {
  const names = ["alpha", longName, "gamma", "delta", "epsilon", "zeta", "eta", "theta"].slice(0, count);
  const repos = names.map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, description: "Fictional grouping fixture with a long description that should truncate", private: index % 2 === 0, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  const now = Date.now();
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login, avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    const repo = repos.find(item => url.pathname.includes(`/${item.name}/`));
    if (url.pathname.endsWith("/events")) return route.fulfill({ json: [{ id: 1, event: "labeled", created_at: iso(3), label: { name: "in-progress" } }] });
    if (repo && url.pathname.endsWith("/issues") && url.searchParams.has("state")) {
      const index = repos.indexOf(repo);
      // gamma has no work in progress; the long-named repository has extra backlog with a long title.
      const plan = [
        { state: "open", labels: [] as { name: string; color: string }[], title: `${repo.name} backlog task` },
        { state: "open", labels: [{ name: "priority: high", color: "b60205" }], title: index === 1 ? "A deliberately long backlog title that wraps or truncates without pushing the time columns away" : `${repo.name} second backlog task` },
        ...(index === 2 ? [] : [{ state: "open", labels: [{ name: "in-progress", color: "147d69" }], title: `${repo.name} work in progress` }]),
        { state: "closed", labels: [], title: `${repo.name} finished task` },
      ];
      const issues = plan.map((item, position) => ({ id: index * 100 + position + 1, number: position + 1, title: item.title, body: `${repo.name} description`, comments: 0,
        state: item.state, created_at: iso(48 + position), updated_at: iso(2), closed_at: item.state === "closed" ? iso(1) : null,
        html_url: `${repo.html_url}/issues/${position + 1}`, labels: item.labels, assignees: [] }));
      return route.fulfill({ json: issues.filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) });
    }
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    return route.fulfill({ json: [] });
  });
  return repos;
}
export async function connectGrouping(page: Page, repos: { full_name: string }[], token = "fictional-grouping-token") {
  await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill(token);
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(repos.length);
}
