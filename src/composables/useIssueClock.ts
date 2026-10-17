import { untilNext, useNow } from "./useNow";
import { RECENT_CLOSURE_MS } from "../lib/time";
import type { Issue } from "../lib/model";

/**
 * The clock behind an issue's time label, shared by cards and list rows (#120, #127). It ticks per
 * second only while the label shows seconds, otherwise at the next label change, and only while
 * `active` (the issue is on screen).
 */
export function useIssueClock(issue: () => Issue, col: () => string, active: () => boolean) {
  return useNow((at) => {
    const { created_at, startedAt, closed_at } = issue();
    const key = col();
    const elapsed = at - Date.parse((key === "backlog" ? created_at : key === "progress" ? startedAt : closed_at) || "");
    if (!Number.isFinite(elapsed)) return Infinity;
    if (elapsed < 0) return -elapsed;
    if (elapsed < 60000 || (key === "progress" && elapsed < 3600000)) return 1000;
    if (key === "closed") return elapsed < RECENT_CLOSURE_MS ? untilNext(elapsed, 60000) : Infinity;
    return untilNext(elapsed, key === "progress" || elapsed < 3600000 ? 60000 : 3600000);
  }, { board: true, active });
}
