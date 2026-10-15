type ShortcutKey = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Keep explicit hard reloads and other browser shortcuts available. */
export function isDataRefreshShortcut(event: ShortcutKey): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (event.key === "F5") return !event.ctrlKey && !event.metaKey;
  return event.key.toLowerCase() === "r" && event.ctrlKey !== event.metaKey;
}
