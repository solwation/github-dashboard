import {
  clampStatisticsResolution, statisticsDurationMs, statisticsMetrics, statisticsRanges, statisticsResolutions,
  type StatisticsMetric, type StatisticsPreference, type StatisticsRangePreset, type StatisticsResolution,
} from "./statistics";

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
  const allowedMetrics = choices?.metrics || [...statisticsMetrics];
  const validList = Array.isArray(value?.metrics)
    ? [...new Set(value.metrics.filter((item): item is StatisticsMetric => allowedMetrics.includes(item as StatisticsMetric)))]
    : undefined;
  const metric = validList?.length
    ? (value?.metric && validList.includes(value.metric) ? value.metric : validList[0]!)
    : (value?.metric && allowedMetrics.includes(value.metric) ? value.metric : allowedMetrics[0] || "closed");
  const range = value?.range && statisticsRanges.includes(value.range as StatisticsRangePreset)
    ? (value.range as StatisticsRangePreset)
    : undefined;
  const rawResolution = value?.resolution && statisticsResolutions.includes(value.resolution as StatisticsResolution)
    ? (value.resolution as StatisticsResolution)
    : undefined;
  const result: StatisticsPreference = { from, to, label, contributor, metric };
  if (validList !== undefined) result.metrics = validList.length ? validList : [metric];
  if (range) result.range = range;
  if (rawResolution) result.resolution = clampStatisticsResolution(rawResolution, statisticsDurationMs({ from, to, range }), range);
  return result;
}
