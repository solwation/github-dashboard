/** Account-local diagnostic history. All persisted state belongs in encrypted settings. */
export const EVENT_HISTORY_LIMIT = 100;
const MESSAGE_LIMIT = 8000;
export type EventSeverity = "info" | "warning" | "error";
export type EventSignal = { source: string; severity: EventSeverity; message: string; repository?: string; recovery?: string };
export type AppEvent = Omit<EventSignal, "recovery"> & { id: number; timestamp: number; seen: boolean };
export type EventHistoryState = { entries: AppEvent[]; active: EventSignal[] };
export function emptyEventHistory(): EventHistoryState { return { entries: [], active: [] }; }
function signal(value: unknown): value is EventSignal {
  if (!value || typeof value !== "object") return false;
  const item = value as EventSignal;
  return typeof item.source === "string" && item.source.length <= 512 &&
    ["info", "warning", "error"].includes(item.severity) && typeof item.message === "string" && item.message.length > 0 &&
    item.message.length <= MESSAGE_LIMIT && (item.repository === undefined || typeof item.repository === "string") &&
    (item.recovery === undefined || typeof item.recovery === "string");
}
export function restoreEventHistory(value: unknown): EventHistoryState {
  if (!value || typeof value !== "object") return emptyEventHistory();
  const saved = value as EventHistoryState;
  const entries = Array.isArray(saved.entries) ? saved.entries.filter(item => signal(item) && Number.isSafeInteger(item.id) && item.id > 0 && Number.isFinite(item.timestamp) && Number.isFinite(new Date(item.timestamp).getTime()) && typeof item.seen === "boolean").slice(-EVENT_HISTORY_LIMIT) : [];
  const ids = new Set<number>();
  return {
    entries: entries.filter(item => !ids.has(item.id) && !!ids.add(item.id)).map(item => ({ source: item.source, severity: item.severity, message: item.message, repository: item.repository, id: item.id, timestamp: item.timestamp, seen: item.seen })),
    active: Array.isArray(saved.active) ? saved.active.filter(signal) : [],
  };
}
/** Identical active failures/notices add nothing; clearing a recoverable source adds one info event.
 * Removing a repository is not recovery: callers retain only sources still in their scope. */
export function reconcileEventHistory(state: EventHistoryState, signals: EventSignal[], now: number, scope?: Set<string>, foreground = false): EventHistoryState {
  const active = signals.map(item => ({ ...item, message: item.message.slice(0, MESSAGE_LIMIT) }));
  const previous = new Map(state.active.map(item => [item.source, item]));
  const current = new Map(active.map(item => [item.source, item]));
  const additions: EventSignal[] = [];
  for (const item of active) {
    const old = previous.get(item.source);
    if (!old || old.message !== item.message || old.severity !== item.severity) additions.push(item);
  }
  for (const old of state.active) {
    if (old.recovery && !current.has(old.source) && (!scope || scope.has(old.source))) {
      additions.push({ source: old.source, severity: "info", repository: old.repository, message: old.recovery });
    }
  }
  return appendEvents({ ...state, active }, additions, now, foreground);
}
/** Foreground information stays in the timeline without creating a notification. */
export function appendEvents(state: EventHistoryState, additions: EventSignal[], now: number, foreground: boolean): EventHistoryState {
  if (!additions.length) return state;
  let id = Math.max(0, ...state.entries.map(item => item.id));
  const entries = [...state.entries, ...additions.map(({ recovery: _, ...item }) => ({ ...item, message: item.message.slice(0, MESSAGE_LIMIT), id: ++id, timestamp: now, seen: foreground && item.severity === "info" }))].slice(-EVENT_HISTORY_LIMIT);
  return { ...state, entries };
}
export function unseenSeverity(entries: AppEvent[]): EventSeverity | null {
  const unseen = entries.filter(item => !item.seen);
  return unseen.some(item => item.severity === "error") ? "error" : unseen.some(item => item.severity === "warning") ? "warning" : unseen.length ? "info" : null;
}
/** Only the snapshot rendered by the user is acknowledged; later arrivals remain unseen. */
export function seeEvents(state: EventHistoryState, ids: number[]): EventHistoryState {
  const viewed = new Set(ids);
  return { ...state, entries: state.entries.map(item => viewed.has(item.id) ? { ...item, seen: true } : item) };
}
