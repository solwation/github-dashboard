import type { StatisticsResolution } from "./statistics";

/** Swedish source strings (translated through i18n) for the activity chart heading per resolution. */
export const activityHeadings: Record<StatisticsResolution, string> = {
  "1m": "Aktivitet per minut",
  "5m": "Aktivitet per 5 minuter",
  "15m": "Aktivitet per 15 minuter",
  "30m": "Aktivitet per 30 minuter",
  "1h": "Aktivitet per timme",
  "6h": "Aktivitet per 6 timmar",
  "12h": "Aktivitet per 12 timmar",
  "1d": "Aktivitet per dag",
};

/** Parses a bucket date ("YYYY-MM-DD" or "YYYY-MM-DD HH:mm", always UTC) to epoch milliseconds. */
export function bucketTime(date: string): number {
  const [day, time] = date.split(" ");
  return Date.parse(`${day}T${time || "00:00"}:00Z`);
}

export function hasTime(date: string) { return /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(date); }

/** Evenly spaced indices (3–6 depending on width, never more than the number of points). */
export function axisTickIndices(count: number, plotWidth: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const wanted = Math.min(6, Math.max(3, Math.floor(plotWidth / 95) + 1), count);
  const indices = new Set<number>();
  for (let tick = 0; tick < wanted; tick++) indices.add(Math.round(tick * (count - 1) / (wanted - 1)));
  return [...indices];
}

/** Rounded y-axis ticks (about three intervals) covering min..max. */
export function valueTicks(min: number, max: number): number[] {
  const span = Math.max(1, max - min);
  const raw = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(factor => factor * magnitude).find(value => value >= raw) || 10 * magnitude);
  const start = Math.floor(min / step) * step, end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 1000; value += step) ticks.push(Math.round(value * 1000) / 1000);
  if (ticks.length < 2) ticks.push(start + step);
  return ticks;
}

/** Theme tokens from style.css used for chart series, in series order, so other views can match a line's colour. */
export const seriesColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;
export function seriesColor(index: number) { return seriesColors[((index % seriesColors.length) + seriesColors.length) % seriesColors.length]!; }
/** Dash pattern for a series: the first is solid, later ones are dashed so lines differ without colour. */
export function seriesDash(index: number) { return index ? `${Math.max(2, 8 - (index % 5))} ${(index % 5) + 2}` : undefined; }

/** Unit a metric is measured in; series of different units get separate y-axes (#283). */
export type ChartUnit = "count" | "hours" | "percent";
export function statisticsMetricUnit(metric: string): ChartUnit {
  return metric === "timePerPoint" ? "hours" : metric === "estimateDeviation" ? "percent" : "count";
}
/** The chart has a left and a right axis, so at most this many units can be shown together. */
export const maxChartUnits = 2;
/**
 * Keeps the metrics whose unit is among the `max` most recently used units (later entries are newer),
 * so adding a metric of a third unit replaces the oldest unit instead of squashing a scale (#283).
 */
export function limitChartUnits<T>(metrics: readonly T[], unitOf: (metric: T) => string, max = maxChartUnits): { kept: T[]; removed: T[] } {
  const recent: string[] = [];
  for (let index = metrics.length - 1; index >= 0; index--) {
    const unit = unitOf(metrics[index]!);
    if (!recent.includes(unit)) recent.push(unit);
  }
  const allowed = new Set(recent.slice(0, max));
  return { kept: metrics.filter(metric => allowed.has(unitOf(metric))), removed: metrics.filter(metric => !allowed.has(unitOf(metric))) };
}
/**
 * Ticks for several y-axes sharing one plot: each axis keeps its own rounded step, and all axes get the
 * same number of steps below and above zero so grid lines and the zero line coincide. Negative ticks on an
 * axis whose data are never negative stay unlabeled (for example negative counts next to a negative deviation).
 * A single range returns exactly `valueTicks`, so single-unit charts are unchanged.
 */
export function alignedValueTicks(ranges: readonly { min: number; max: number }[]): { ticks: number[]; labeled: boolean[] }[] {
  const natural = ranges.map(range => valueTicks(Math.min(0, range.min), Math.max(1, range.max)));
  if (natural.length <= 1) return natural.map(ticks => ({ ticks, labeled: ticks.map(() => true) }));
  const shape = natural.map(ticks => {
    const step = ticks[1]! - ticks[0]!;
    return { step, below: Math.round(-ticks[0]! / step), above: Math.round(ticks.at(-1)! / step) };
  });
  const below = Math.max(...shape.map(item => item.below)), above = Math.max(...shape.map(item => item.above));
  return shape.map(({ step }, axis) => {
    const ticks: number[] = [];
    for (let k = -below; k <= above; k++) ticks.push(Math.round(k * step * 1000) / 1000 || 0);
    return { ticks, labeled: ticks.map(tick => tick >= 0 || ranges[axis]!.min < 0) };
  });
}
