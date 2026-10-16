import { statisticsMetrics, type StatisticsMetric, type StatisticsPreference } from "./statistics";

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Shared validation for in-memory preferences and settings imported by QR. */
export function normalizeStatisticsPreference(
  value: Partial<StatisticsPreference> | undefined,
  window: { from: string; to: string },
  choices?: { labels: string[]; contributors: string[]; metrics?: StatisticsMetric[] },
): StatisticsPreference {
  const clamp = (date: unknown, fallback: string) => validDate(date) ? date < window.from ? window.from : date > window.to ? window.to : date : fallback;
  let from = clamp(value?.from, window.from), to = clamp(value?.to, window.to);
  if (from > to) { from = window.from; to = window.to; }
  const label = typeof value?.label === "string" && (!choices || choices.labels.includes(value.label)) ? value.label : "";
  const contributor = typeof value?.contributor === "string" && (!choices || choices.contributors.includes(value.contributor)) ? value.contributor : "";
  const metrics = choices?.metrics || [...statisticsMetrics];
  const metric = value?.metric && metrics.includes(value.metric) ? value.metric : metrics[0] || "closed";
  return { from, to, label, contributor, metric };
}
