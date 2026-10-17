// Local benchmark for summarizeStatistics (issue #125). Not part of the production bundle.
// Run: node --experimental-strip-types scripts/bench-statistics.ts
import { summarizeStatistics, statisticsWindow, type StatisticsData } from "../src/lib/statistics.ts";

const now = Date.parse("2026-10-16T15:00:00Z");
const window = statisticsWindow(now);
const users = ["alice", "bob", "carol", "dave", "erin"];
const labels = ["bug", "feature", "docs", "priority: low"];
const at = (index: number) => new Date(now - (index % 40) * 86400000 - (index % 24) * 3600000).toISOString().replace(/\.\d{3}Z$/, "Z");
const source = <T>(data: T[]) => ({ data, complete: true, fetchedAt: now });
function dataset(): StatisticsData {
  const issues = Array.from({ length: 300 }, (_, i) => ({ id: i, number: i, created_at: at(i), updated_at: at(i), labels: [{ name: labels[i % labels.length]! }], user: { login: users[i % users.length]! } }));
  return {
    repository: "bench/repo", ...window, fetchedAt: now, temporary: [], issues: source(issues),
    events: source(Array.from({ length: 500 }, (_, i) => ({ id: i, event: i % 3 ? "closed" : "reopened", created_at: at(i + 3), actor: { login: users[i % users.length]! }, issue: issues[i % issues.length] }))),
    commits: source(Array.from({ length: 300 }, (_, i) => ({ sha: `c${i}`, parents: [{ sha: "p" }], author: { login: users[i % users.length]! }, commit: { author: { name: users[i % users.length]!, date: at(i) }, committer: { date: at(i) } } }))),
    changes: source(Array.from({ length: 60 }, (_, i) => ({ sha: `c${i}`, date: at(i), contributor: users[i % users.length]!, additions: i * 3, deletions: i, files: 2, filesComplete: true }))),
    pulls: source(Array.from({ length: 300 }, (_, i) => ({ id: i, created_at: at(i), updated_at: at(i), closed_at: i % 2 ? at(i + 1) : null, merged_at: i % 4 === 1 ? at(i + 1) : null, labels: [{ name: labels[i % labels.length]! }], user: { login: users[i % users.length]! } }))),
  };
}
const data = [dataset()];
const filter = { ...window, label: "", contributor: "" };
const coldStart = performance.now();
summarizeStatistics(data, filter);
const cold = performance.now() - coldStart;
for (let i = 0; i < 50; i++) summarizeStatistics(data, filter);
const rounds = 200, samples: number[] = [];
for (let i = 0; i < rounds; i++) { const start = performance.now(); summarizeStatistics(data, filter); samples.push(performance.now() - start); }
samples.sort((a, b) => a - b);
const mean = samples.reduce((sum, value) => sum + value, 0) / rounds;
console.log(`summarizeStatistics: mean ${mean.toFixed(3)} ms, median ${samples[rounds >> 1]!.toFixed(3)} ms, p95 ${samples[Math.floor(rounds * 0.95)]!.toFixed(3)} ms (${rounds} runs); first call ${cold.toFixed(3)} ms`);
