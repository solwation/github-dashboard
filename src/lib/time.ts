import { t } from "./i18n";
export const RECENT_CLOSURE_MS = 6 * 60 * 60 * 1000;
export function closedTimeLabel(
  timestamp: string,
  now: number,
  locale: string,
): string {
  const closed = Date.parse(timestamp);
  if (!Number.isFinite(closed)) return t("Okänd stängningstid");
  const elapsed = now - closed;
  if (elapsed >= 0 && elapsed < RECENT_CLOSURE_MS) {
    const seconds = Math.floor(elapsed / 1000);
    if (seconds < 60)
      return seconds === 1
        ? t("1 sekund sedan")
        : t("{seconds} sekunder sedan", { seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("{minutes} min sedan", { minutes });
    return t("{hours}h {minutes} min sedan", {
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    });
  }
  return t("Stängd {time}", {
    time: new Date(closed).toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
}
