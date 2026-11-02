export interface RefreshPriorityTarget {
  fullName: string;
  isLoading?: boolean;
  isHidden?: boolean;
  isCollapsed?: boolean;
  hasActive?: boolean;
}

/**
 * Priority rank for refreshing repositories:
 * 0: Loading / initial startup (highest priority)
 * 1: Visible on board, expanded, with active (in progress) issues
 * 2: Visible on board, expanded, idle
 * 3: Visible on board, but collapsed
 * 4: Hidden from board (lowest priority)
 */
export function refreshTargetPriority(target: RefreshPriorityTarget): number {
  if (target.isLoading) return 0;
  if (!target.isHidden && !target.isCollapsed && target.hasActive) return 1;
  if (!target.isHidden && !target.isCollapsed) return 2;
  if (!target.isHidden && target.isCollapsed) return 3;
  return 4;
}

export function sortRefreshTargets<T extends { full_name: string }>(
  targets: readonly T[],
  options: {
    visualOrder: readonly string[];
    getState(target: T): RefreshPriorityTarget;
  },
): T[] {
  const visualPosition = new Map(options.visualOrder.map((name, index) => [name, index]));
  return [...targets].sort((a, b) => {
    const prioA = refreshTargetPriority(options.getState(a));
    const prioB = refreshTargetPriority(options.getState(b));
    if (prioA !== prioB) return prioA - prioB;
    return (visualPosition.get(a.full_name) ?? 9999) - (visualPosition.get(b.full_name) ?? 9999);
  });
}
