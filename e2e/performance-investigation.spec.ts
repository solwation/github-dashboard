import { expect, test, type Page, type CDPSession } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { loadavg, freemem, totalmem } from "node:os";
import { previewOrigin } from "./ports";

// Opt-in measurement, not a hardware-dependent pass/fail performance budget (#357).
// Only fictional data is generated; no GitHub traffic or private snapshots are captured.
test.skip(process.env.PERF_INVESTIGATION !== "1", "Set PERF_INVESTIGATION=1 to collect the bounded production probe");
test.use({ baseURL: previewOrigin, actionTimeout: 15000 });
const base = "/github-dashboard/";
const stamp = Date.now();
type RequestSample = { path: string; status: number; bytes: number };
async function fixture(page: Page, count: number, perRepo: number) {
  const repos = Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `probe-${index + 1}`, full_name: `sample/probe-${index + 1}`, private: true, description: "Fictional performance probe", html_url: `https://github.com/sample/probe-${index + 1}`, owner: { login: "sample" } }));
  const labels = [{ name: "priority: medium", color: "888888" }, { name: "in-progress", color: "888888" }, { name: "a-long-fictional-label-for-layout", color: "888888" }];
  const issues = new Map(repos.map(repo => [repo.full_name, Array.from({ length: perRepo }, (_, index) => {
    const number = index + 1, closed = index % 3 === 2, active = index % 3 === 1;
    return { id: repo.id * 10000 + number, number, title: `${repo.name} ${number % 2 ? "needle" : "ordinary"} fictional issue ${number} with a long title for representative truncation`, body: "Fictional description. ".repeat(12), comments: 0,
      html_url: `${repo.html_url}/issues/${number}`, state: closed ? "closed" : "open", created_at: new Date(stamp - 86400000 * (1 + number % 20)).toISOString(), updated_at: new Date(stamp - 60000).toISOString(), closed_at: closed ? new Date(stamp - 3600000).toISOString() : null,
      labels: active ? labels : [labels[0], labels[2]], assignees: [] };
  })]));
  const state = { hold: false, requests: [] as RequestSample[], pending: [] as (() => Promise<void>)[] };
  await page.route("https://api.github.com/**", async route => {
    const respond = async () => {
      const url = new URL(route.request().url());
      const repo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
      const timeline = /\/issues\/(\d+)\/events$/.exec(url.pathname);
      let data: unknown = [];
      let next = false;
      if (url.pathname === "/user") data = { login: "performance-fixture", avatar_url: "" };
      else if (url.pathname === "/user/repos") data = repos;
      else if (url.pathname === "/graphql") {
        const variables = route.request().postDataJSON()?.variables;
        const subject = issues.get(`${variables?.owner}/${variables?.name}`)?.find(issue => issue.number === variables?.number);
        data = { data: { repository: { issue: subject ? { state: subject.state.toUpperCase(), closedAt: subject.closed_at, parent: null, subIssuesSummary: { total: 0, completed: 0 }, timelineItems: { nodes: subject.closed_at ? [{ createdAt: subject.closed_at, closer: null }] : [] } } : null } } };
      }
      else if (repo && timeline) data = [{ id: 1, event: "labeled", label: { name: "in-progress" }, created_at: new Date(stamp - 25 * 60000).toISOString() }];
      else if (repo && url.pathname.endsWith("/labels")) data = labels;
      else if (repo && url.pathname.endsWith("/issues")) {
        const status = url.searchParams.get("state"), since = Date.parse(url.searchParams.get("since") || "");
        const filtered = issues.get(repo.full_name)!.filter(issue => status === "all" ? !Number.isFinite(since) || Date.parse(issue.updated_at) >= since : issue.state === status);
        const size = Number(url.searchParams.get("per_page") || 100), pageNumber = Number(url.searchParams.get("page") || 1);
        data = filtered.slice((pageNumber - 1) * size, pageNumber * size); next = filtered.length > pageNumber * size;
      }
      const json = JSON.stringify(data);
      const etag = `"probe-${url.pathname}-${url.search}"`;
      const unchanged = route.request().method() === "GET" && route.request().headers()["if-none-match"] === etag;
      const headers: Record<string, string> = { etag, "access-control-expose-headers": "etag,link" };
      if (next) { const link = new URL(url); link.searchParams.set("page", String(Number(url.searchParams.get("page") || 1) + 1)); headers.link = `<${link.href}>; rel="next"`; }
      state.requests.push({ path: timeline ? "issue-timeline" : url.pathname === "/graphql" ? "graphql" : url.pathname.endsWith("/issues") ? `issue-list-${url.searchParams.get("state")}` : url.pathname.endsWith("/labels") ? "labels" : "identity/repositories", status: unchanged ? 304 : 200, bytes: unchanged ? 0 : Buffer.byteLength(json) });
      await route.fulfill({ status: unchanged ? 304 : 200, headers, ...(unchanged ? {} : { body: json, contentType: "application/json" }) });
    };
    if (state.hold) await new Promise<void>(resolve => state.pending.push(async () => { await respond(); resolve(); }));
    else await respond();
  });
  return { repos, state };
}
async function instrumentation(page: Page) {
  await page.addInitScript(() => {
    const probe = { tasks: [] as { start: number; duration: number }[], mutations: 0, firstCard: 0, contentWrites: 0 };
    Object.assign(window, { performanceProbe: probe });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) probe.tasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: "longtask", buffered: true });
    new MutationObserver(records => { probe.mutations += records.length; }).observe(document, { subtree: true, childList: true, characterData: true });
    const first = () => { if (document.querySelector(".issue-card, .issue-row")) probe.firstCard = performance.now(); else requestAnimationFrame(first); };
    requestAnimationFrame(first);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) { if (key === "content") probe.contentWrites++; return put.call(this, value, key); };
  });
}
const probe = (page: Page) => page.evaluate(() => (window as unknown as { performanceProbe: { tasks: { start: number; duration: number }[]; mutations: number; firstCard: number; contentWrites: number } }).performanceProbe);
async function metrics(cdp: CDPSession) {
  return Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
}
async function ciphertextBytes(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("issueflow-vault", 1); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<number>(resolve => { const request = db.transaction("credentials").objectStore("credentials").get("content"); request.onsuccess = () => resolve(request.result?.ciphertext.byteLength ?? 0); }); } finally { db.close(); }
  });
}
for (const size of [{ name: "small", repos: 1, issues: 60 }, { name: "large", repos: 12, issues: 120 }]) {
  for (const mobile of [false, true]) test(`production performance investigation ${size.name} ${mobile ? "phone" : "desktop"}`, async ({ browser }, info) => {
    test.setTimeout(240000);
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 }, isMobile: mobile, hasTouch: mobile, locale: "sv-SE", reducedMotion: "reduce" });
    const page = await context.newPage(), cdp = await context.newCDPSession(page);
    const { repos, state } = await fixture(page, size.repos, size.issues);
    await instrumentation(page); await cdp.send("Performance.enable");
    const stages: unknown[] = [];
    // Capture app update/frame cost inside the page, excluding Playwright locator/scroll polling.
    const nativeAction = (kind: "filter" | "list" | "combined" | "split" | "cards", value = "") => page.evaluate(async ({ kind, value }) => {
      const element = kind === "filter" ? document.querySelector<HTMLInputElement>("#issue-search input")!
        : kind === "list" || kind === "cards" ? document.querySelectorAll<HTMLButtonElement>(".board-toolbar .board-mode-toggle button")[kind === "cards" ? 0 : 1]!
        : document.querySelectorAll<HTMLInputElement>(".board-toolbar .coord-toggle input")[1]!;
      const nativeStart = performance.now();
      if (kind === "filter") { (element as HTMLInputElement).value = value; element.dispatchEvent(new Event("input", { bubbles: true })); }
      else element.click();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return { nativeStart, nativeEnd: performance.now(), nativeActionMs: performance.now() - nativeStart };
    }, { kind, value });
    async function measure(name: string, action: () => Promise<unknown>) {
      console.log(`stage ${name}`);
      const before = await metrics(cdp), sample = await probe(page), start = await page.evaluate(() => performance.now()), requestStart = state.requests.length;
      const actionResult = await action();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const end = await page.evaluate(() => performance.now()), after = await metrics(cdp), next = await probe(page);
      const tasks = next.tasks.filter(task => task.start >= start && task.start < end);
      const requests = state.requests.slice(requestStart);
      const native = actionResult && typeof actionResult === "object" && "nativeStart" in actionResult ? actionResult as { nativeStart: number; nativeEnd: number; nativeActionMs: number } : null;
      stages.push({ name, ...(native ? { nativeActionMs: native.nativeActionMs, nativeLongestTaskMs: Math.max(0, ...next.tasks.filter(task => task.start >= native.nativeStart && task.start < native.nativeEnd).map(task => task.duration)) } : {}), ...(name === "cold-board" ? { firstCardWithinStageMs: next.firstCard - start } : {}), elapsedMs: end - start, mainThreadMs: ((after.TaskDuration || 0) - (before.TaskDuration || 0)) * 1000, scriptMs: ((after.ScriptDuration || 0) - (before.ScriptDuration || 0)) * 1000, layoutMs: ((after.LayoutDuration || 0) - (before.LayoutDuration || 0)) * 1000, longTasks: tasks.length, longestTaskMs: Math.max(0, ...tasks.map(task => task.duration)), mutations: next.mutations - sample.mutations, domNodes: after.Nodes, heapMiB: (after.JSHeapUsedSize || 0) / 1048576, requests: requests.length, notModified: requests.filter(request => request.status === 304).length, responseBytes: requests.reduce((sum, request) => sum + request.bytes, 0), requestKinds: Object.fromEntries([...new Set(requests.map(request => request.path))].map(path => [path, requests.filter(request => request.path === path).length])) });
      writeFileSync(info.outputPath("stages.partial.json"), JSON.stringify(stages, null, 2));
    }
    try {
      await page.goto(base);
      await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
      await page.getByLabel("GitHub personal access token").fill("fictional-performance-probe-token");
      await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
      for (const repo of repos) await page.getByRole("checkbox", { name: new RegExp(`^${repo.full_name}(?: |$)`) }).check();
      await measure("cold-board", async () => {
        await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
        await expect(page.locator(".issue-card")).toHaveCount(size.repos * 18, { timeout: 60000 });
        await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false", { timeout: 60000 });
      });
      const coldFirstCard = (await probe(page)).firstCard;
      await expect.poll(() => ciphertextBytes(page)).toBeGreaterThan(0);
      // All lanes loaded above; allow the coalesced encrypted write to finish.
      // The blocked-network reload below verifies every lane really reached the cache.
      await page.waitForTimeout(500);
      const cacheBytes = await ciphertextBytes(page);
      await cdp.send("HeapProfiler.collectGarbage");
      const heapBeforeCycles = (await metrics(cdp)).JSHeapUsedSize! / 1048576;
      if (process.env.PERF_CPU_PROFILE === "1") { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
      for (let repeat = 0; repeat < 3; repeat++) {
        await measure(`filter-${repeat}`, async () => { const timing = await nativeAction("filter", "needle"); await expect(page.locator(".issue-card").filter({ hasText: "ordinary" })).toHaveCount(0); return timing; });
        await measure(`clear-filter-${repeat}`, async () => { const timing = await nativeAction("filter"); await expect(page.locator(".issue-card")).toHaveCount(size.repos * 18); return timing; });
        await measure(`list-${repeat}`, async () => { const timing = await nativeAction("list"); await expect(page.locator(".issue-row")).toHaveCount(size.repos * 18); return timing; });
        await measure(`combined-${repeat}`, async () => { const timing = await nativeAction("combined"); await expect(page.locator(".issue-row")).toHaveCount(18); return timing; });
        await measure(`split-${repeat}`, async () => { const timing = await nativeAction("split"); await expect(page.locator(".issue-row")).toHaveCount(size.repos * 18); return timing; });
        await measure(`cards-${repeat}`, async () => { const timing = await nativeAction("cards"); await expect(page.locator(".issue-card")).toHaveCount(size.repos * 18); return timing; });
      }
      if (process.env.PERF_CPU_PROFILE === "1") { const { profile } = await cdp.send("Profiler.stop"); writeFileSync(info.outputPath("scene.cpuprofile"), JSON.stringify(profile)); }
      await cdp.send("HeapProfiler.collectGarbage");
      const heapAfterCycles = (await metrics(cdp)).JSHeapUsedSize! / 1048576;
      for (let repeat = 0; repeat < 2; repeat++) await measure(`manual-refresh-${repeat}`, async () => {
        const before = state.requests.length;
        await page.keyboard.press("Control+r");
        await expect.poll(() => state.requests.length).toBeGreaterThan(before);
        await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false", { timeout: 60000 });
      });
      const writesBeforeReload = (await probe(page)).contentWrites;
      state.hold = true;
      await page.reload();
      await expect(page.locator(".issue-card")).toHaveCount(size.repos * 18, { timeout: 60000 });
      const cached = await probe(page);
      const cacheRestore = { firstCardFromNavigationMs: cached.firstCard, longestTaskMs: Math.max(0, ...cached.tasks.map(task => task.duration)), heldRequests: state.pending.length, cards: await page.locator(".issue-card").count() };
      state.hold = false; await Promise.all(state.pending.splice(0).map(resume => resume()));
      const result = { revision: process.env.PERF_REVISION || "run git rev-parse HEAD", startedUTC: new Date(stamp).toISOString(), browser: browser.version(), viewport: mobile ? "390x844 touch/mobile" : "1600x1000 desktop", cpuThrottle: 1, host: { loadavg: loadavg(), freeMiB: freemem() / 1048576, totalMiB: totalmem() / 1048576 }, dataset: { repositories: size.repos, issuesPerRepository: size.issues, totalIssues: size.repos * size.issues, progressIssues: size.repos * size.issues / 3, initialVisibleCards: size.repos * 18, apiLatencyMs: 0 }, stages, coldFirstCardFromNavigationMs: coldFirstCard, cacheRestore, cacheCiphertextBytes: cacheBytes, contentWritesBeforeReload: writesBeforeReload, heapAfterGC: { beforeCyclesMiB: heapBeforeCycles, afterCyclesMiB: heapAfterCycles }, totalMockRequests: state.requests.length };
      writeFileSync(info.outputPath("metrics.json"), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ case: `${size.name}-${mobile ? "phone" : "desktop"}`, cacheRestore, heapAfterGC: result.heapAfterGC }));
    } finally { state.hold = false; await Promise.all(state.pending.splice(0).map(resume => resume().catch(() => {}))); await context.close().catch(() => {}); }
  });
}
