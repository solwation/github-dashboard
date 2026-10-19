import {
  clampStatisticsResolution, formatStatisticsBound, hasStatisticsTime, parseStatisticsBound,
  statisticsDurationMs, statisticsMetrics, statisticsRanges, statisticsResolutions, statisticsWindowMs, validStatisticsBound,
  type StatisticsMetric, type StatisticsPreference, type StatisticsRangePreset, type StatisticsResolution,
} from "./statistics";

/**
 * Shared validation for in-memory preferences and settings imported by QR.
 * from/to may be legacy "YYYY-MM-DD" or UTC "YYYY-MM-DDTHH:mm" (#168). Date-only
 * values clamp to the period's dates as before; datetime values clamp to the
 * period's concrete [00:00 of from, end of to] span and keep their format.
 */
export function normalizeStatisticsPreference(
  value: Partial<StatisticsPreference> | undefined,
  window: { from: string; to: string },
  choices?: { labels: string[]; contributors: string[]; metrics?: StatisticsMetric[] },
): StatisticsPreference {
  const periodStart = parseStatisticsBound(window.from, "start"), periodEnd = parseStatisticsBound(window.to, "end");
  const clamp = (date: unknown, fallback: string, edge: "start" | "end") => {
    if (!validStatisticsBound(date)) return fallback;
    if (!hasStatisticsTime(date)) return date < window.from ? window.from : date > window.to ? window.to : date;
    const ms = parseStatisticsBound(date, edge);
    if (Number.isFinite(periodStart) && ms < periodStart) return formatStatisticsBound(periodStart);
    if (Number.isFinite(periodEnd) && ms > periodEnd) return formatStatisticsBound(periodEnd);
    return date;
  };
  let from = clamp(value?.from, window.from, "start"), to = clamp(value?.to, window.to, "end");
  if (!Number.isFinite(statisticsWindowMs({ from, to }).start)) { from = window.from; to = window.to; }
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
