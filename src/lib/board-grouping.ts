/**
 * Board grouping (#390): one combined board, one board per repository, or one combined board
 * with a lane per repository (horizontal rows in Cards, vertical columns in List).
 */
export const boardGroupings = ["none", "split", "swimlanes"] as const;
export type BoardGrouping = (typeof boardGroupings)[number];
export const defaultBoardGrouping: BoardGrouping = "split";

export function validBoardGrouping(value: unknown): value is BoardGrouping {
  return typeof value === "string" && (boardGroupings as readonly string[]).includes(value);
}

/**
 * Read the grouping from stored or transferred preferences. An explicit boardGrouping wins;
 * otherwise the legacy splitByRepository boolean maps true→split and false→none, so the
 * user's effective choice is unchanged. Without either the current choice is kept.
 */
export function boardGroupingFrom(
  preferences: { boardGrouping?: unknown; splitByRepository?: unknown },
  current: BoardGrouping = defaultBoardGrouping,
): BoardGrouping {
  if (validBoardGrouping(preferences.boardGrouping)) return preferences.boardGrouping;
  if (typeof preferences.splitByRepository === "boolean") return preferences.splitByRepository ? "split" : "none";
  return current;
}
