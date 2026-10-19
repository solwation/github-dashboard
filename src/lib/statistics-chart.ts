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
