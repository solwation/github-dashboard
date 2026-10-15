/** Keep saved positions; append newly discovered repositories in name order. */
export function reconcileOrder(saved: unknown, available: string[]): string[] {
  const names = new Set(available);
  const order = Array.isArray(saved)
    ? [...new Set(saved.filter((name): name is string => typeof name === "string" && names.has(name)))]
    : [];
  const existing = new Set(order);
  return [...order, ...[...names].filter(name => !existing.has(name)).sort()];
}

export function restoreLayout(saved: unknown, available: string[]) {
  const value = saved && typeof saved === "object" ? saved as Record<string, unknown> : {};
  return {
    order: reconcileOrder(value.projectOrder, available),
    collapsed: Array.isArray(value.collapsedRepos)
      ? [...new Set(value.collapsedRepos.filter((name): name is string => typeof name === "string" && available.includes(name)))]
      : [],
  };
}

/** Move a source to the target's position, shifting intervening repositories. */
export function moveProject(order: string[], source: string, target: string): string[] {
  const from = order.indexOf(source);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}

export const projectDragType = "application/x-issueflow-project";
