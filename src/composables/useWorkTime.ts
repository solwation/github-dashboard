import { computed, type Ref } from "vue";
import { activeWorkMs, activeWorkStart, awaitsIntegration, durationLabel, type Issue, type Rules } from "../lib/model";
import { locale, t } from "../lib/i18n";

/**
 * Shared In progress time text for cards and list rows (#392). Active issues show active working
 * time, without earlier integration waits; an issue waiting for integration shows the waiting
 * indicator instead of a running timer, with its frozen active time in the title.
 */
export function useWorkTime(issue: () => Issue, rules: () => Rules, now: Ref<number>) {
  const waiting = computed(() => awaitsIntegration(issue(), rules()));
  const activeStart = computed(() => activeWorkStart(issue(), rules()));
  const label = computed(() => activeStart.value ? durationLabel(now.value - Date.parse(activeStart.value)) : null);
  const timerTitle = computed(() => {
    const current = issue();
    if (!current.startedAt) return t("Ingen säker starttid kunde hämtas");
    const wait = current.waitMs ?? 0;
    return t("Arbetslabel satt ") + new Date(current.startedAt).toLocaleString(locale.value) +
      (wait > 0 ? t(" · aktiv arbetstid utan {duration} väntan på integration", { duration: durationLabel(wait) }) : "");
  });
  const waitingTitle = computed(() => {
    const active = activeWorkMs(issue(), now.value, rules());
    return Number.isFinite(active)
      ? t("Väntar på integration. Aktiv arbetstid {duration}; väntan räknas inte som arbete.", { duration: durationLabel(active) })
      : t("Väntar på integration. Väntan räknas inte som arbete.");
  });
  return { waiting, activeStart, label, timerTitle, waitingTitle };
}
