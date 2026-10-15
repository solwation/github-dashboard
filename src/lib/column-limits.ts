export const defaultColumnLimit = 6;
export const maxColumnLimit = 100;
export function validColumnLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maxColumnLimit;
}
export function restoreColumnLimits(saved: unknown, available: string[]) {
  const preferences = saved && typeof saved === "object" ? saved as Record<string, unknown> : {};
  const overrides = preferences.repositoryColumnLimits;
  return {
    global: validColumnLimit(preferences.columnLimit) ? preferences.columnLimit : defaultColumnLimit,
    overrides: Object.fromEntries(Object.entries(overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {})
      .filter(([name, value]) => available.includes(name) && validColumnLimit(value))) as Record<string, number>,
  };
}
export function effectiveColumnLimit(global: number, overrides: Record<string, number>, repo: string) {
  return overrides[repo] ?? global;
}
