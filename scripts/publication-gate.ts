import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parsePublicationDelta, parsePublishedReleaseNotes, parseReleaseNotes } from "../src/lib/release-notes.ts";

export interface QueueIssue { number: number; state: "open"; labels: { name: string }[]; pull_request?: unknown }
export interface GateInput {
  runCommit: string; mainCommit: string; published: unknown; openIssues: unknown;
  sourceDelta: unknown; sourceNotes: unknown; artifact?: unknown;
}
export interface GateDecision { allowed: boolean; reason: string; commit: string }
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function queue(value: unknown): QueueIssue[] {
  if (!Array.isArray(value) || !value.every(item => record(item) && Number.isSafeInteger(item.number) && (item.number as number) > 0 &&
    item.state === "open" && Array.isArray(item.labels) && item.labels.every(label => record(label) && typeof label.name === "string" && label.name.length > 0)))
    throw new Error("Invalid issue metadata");
  const issues = value as QueueIssue[];
  if (new Set(issues.map(issue => issue.number)).size !== issues.length) throw new Error("Inconsistent issue pagination");
  return issues;
}

/** The same fail-closed policy runs before building and immediately before deploying. */
export function decidePublication(input: GateInput): GateDecision {
  const result = (reason: string, allowed = false): GateDecision => ({ allowed, reason, commit: sha(input.runCommit) ? input.runCommit : "" });
  try {
    if (!sha(input.runCommit) || !sha(input.mainCommit)) return result("commit-invalid");
    if (input.runCommit !== input.mainCommit) return result("main-advanced");
    const published = parsePublishedReleaseNotes(input.published);
    if (!published || !sha(published.build.commit)) return result("published-baseline-invalid");
    if (published.build.commit === input.runCommit) return result("already-published");
    const delta = parsePublicationDelta(input.sourceDelta);
    const notes = parseReleaseNotes(input.sourceNotes);
    if (!delta || !notes) return result("prepared-metadata-invalid");
    if (delta.baseCommit !== published.build.commit) return result("published-baseline-changed");
    const traceable = new Set(notes.flatMap(day => day.sections.flatMap(section => section.issues)));
    if (!delta.issues.every(issue => traceable.has(issue))) return result("delta-untraceable");
    for (const issue of queue(input.openIssues)) {
      const labels = issue.labels.map(label => label.name);
      if (Object.hasOwn(issue, "pull_request") || labels.includes("orkester")) continue;
      const claimed = labels.includes("in-progress") || labels.some(label => /^(orkester|owner):/i.test(label) || /^(?:status[\s:_-]+)?blocked$/i.test(label));
      if (claimed) return result("queue-not-ready");
      const ready = labels.includes("needs-deploy"), included = delta.issues.includes(issue.number);
      // Unclaimed backlog outside this batch never reaches main unfinished, so it does not hold back publication (#118).
      if (!ready && !included) continue;
      if (!ready) return result("queue-not-ready");
      if (!included) return result("ready-issue-missing-from-delta");
    }
    if (input.artifact !== undefined) {
      const artifact = parsePublishedReleaseNotes(input.artifact);
      if (!artifact || artifact.build.commit !== input.runCommit || !artifact.build.builtAt ||
        JSON.stringify(artifact.delta) !== JSON.stringify(delta) || JSON.stringify(artifact.days) !== JSON.stringify(notes))
        return result("artifact-mismatch");
    }
    return result("ready", true);
  } catch { return result("metadata-invalid"); }
}

export interface GateTransport {
  fetcher: typeof fetch; api: string; repository: string; token: string; publishedUrl: string;
}
async function json(url: string, options: RequestInit, fetcher: typeof fetch) {
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error("Gate request failed");
  return { value: await response.json() as unknown, next: /rel="next"/.test(response.headers.get("link") || "") };
}
function apiOptions(token: string): RequestInit {
  return { credentials: "omit", headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" } };
}
export async function fetchOpenQueue(transport: GateTransport): Promise<QueueIssue[]> {
  const issues: QueueIssue[] = [];
  for (let page = 1; page <= 1000; page++) {
    const response = await json(transport.api + "/repos/" + transport.repository + "/issues?state=open&per_page=100&page=" + page, apiOptions(transport.token), transport.fetcher);
    const items = queue(response.value);
    issues.push(...items);
    if (!response.next && items.length < 100) return queue(issues);
  }
  throw new Error("Issue pagination incomplete");
}
export async function inspectPublication(transport: GateTransport, source: Pick<GateInput, "runCommit" | "sourceDelta" | "sourceNotes" | "artifact">): Promise<GateDecision> {
  try {
    if (!transport.token || !/^[\w.-]+\/[\w.-]+$/.test(transport.repository) || new URL(transport.api).protocol !== "https:") throw new Error("Invalid gate configuration");
    const publicUrl = new URL(transport.publishedUrl);
    if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password) throw new Error("Invalid public manifest");
    publicUrl.searchParams.set("publication-gate", String(Date.now()));
    const [main, published, openIssues] = await Promise.all([
      json(transport.api + "/repos/" + transport.repository + "/commits/main", apiOptions(transport.token), transport.fetcher),
      // Deliberately separate options: the public Pages request never receives GITHUB_TOKEN.
      json(publicUrl.href, { credentials: "omit", headers: { Accept: "application/json", "Cache-Control": "no-cache" } }, transport.fetcher),
      fetchOpenQueue(transport),
    ]);
    return decidePublication({ ...source, mainCommit: record(main.value) ? main.value.sha as string : "", published: published.value, openIssues });
  } catch { return { allowed: false, reason: "metadata-unavailable", commit: sha(source.runCommit) ? source.runCommit : "" }; }
}

async function main() {
  const phase = process.argv[2];
  let decision: GateDecision = { allowed: false, reason: "metadata-unavailable", commit: "" };
  try {
    if (phase !== "prepare" && phase !== "final") throw new Error("Invalid phase");
    const artifactPath = process.argv[3];
    if (phase === "final" && !artifactPath) throw new Error("Missing artifact");
    const [sourceDelta, sourceNotes, artifact] = await Promise.all([
      readFile("src/update-summary.json", "utf8").then(JSON.parse),
      readFile("src/release-notes.json", "utf8").then(JSON.parse),
      phase === "final" ? readFile(artifactPath!, "utf8").then(JSON.parse) : Promise.resolve(undefined),
    ]);
    decision = await inspectPublication({
      fetcher: fetch, api: process.env.GITHUB_API_URL || "https://api.github.com",
      repository: process.env.GITHUB_REPOSITORY || "", token: process.env.GITHUB_TOKEN || "",
      publishedUrl: process.env.PUBLIC_MANIFEST_URL || "",
    }, { runCommit: process.env.GATE_RUN_SHA || "", sourceDelta, sourceNotes, ...(phase === "final" ? { artifact } : {}) });
  } catch { /* Never print request bodies, tokens or exception contents. */ }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "allowed=" + decision.allowed + "\ncommit=" + decision.commit + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, "Publication gate: **" + decision.reason + "**.\n");
  console.log("Publication gate: " + decision.reason);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
