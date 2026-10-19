/** Browser wall-clock conversion. Persisted/API timestamps remain absolute UTC instants. */
export function browserTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
const pad = (value: number) => String(value).padStart(2, "0");
export function formatBrowserDateTime(ms: number): string {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** Ambiguous fall-back input selects the earlier occurrence, as native Date does. */
export function parseBrowserDateTime(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(0);
  date.setFullYear(Number(year), Number(month) - 1, Number(day));
  date.setHours(Number(hour), Number(minute), 0, 0);
  return formatBrowserDateTime(date.getTime()) === value ? date.getTime() : NaN;
}

/** A wall-clock time that occurs twice needs an offset even with a shared zone label. */
export function isAmbiguousBrowserTime(ms: number): boolean {
  if (!Number.isFinite(ms)) return false;
  const date = new Date(ms), local = formatBrowserDateTime(ms), offset = date.getTimezoneOffset();
  return [-86_400_000, 86_400_000].some(delta => {
    const otherOffset = new Date(ms + delta).getTimezoneOffset();
    return otherOffset !== offset && formatBrowserDateTime(ms + (otherOffset - offset) * 60_000) === local;
  });
}
