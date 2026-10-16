/** Deliberately interleaved warm/cool hues; persisted preferences accept only these colors. */
export const repositoryPalette = [
  "#c65d16", "#245bc1", "#8b43b5", "#318343", "#c33f69", "#168692",
  "#987016", "#5148a5", "#9c4934", "#647d20", "#a03991", "#28788d",
] as const;
export function validRepositoryColor(value: unknown): value is string {
  return typeof value === "string" && (repositoryPalette as readonly string[]).includes(value);
}

/** Only selected repositories reserve slots. Retained assignments survive reorder, reload and additions. */
export function reconcileRepositoryColors(selected: string[], saved: unknown): Record<string, string> {
  const names = new Map<string, string>();
  for (const name of selected) {
    if (typeof name !== "string" || names.size >= 100) continue;
    const valid = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(name) &&
      ![".", ".."].includes(name.split("/")[1]!);
    if (valid && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  const ordered = [...names.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const candidates = new Map<string, string>();
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    for (const [name, color] of Object.entries(saved).slice(0, 100)) {
      if (validRepositoryColor(color) && !candidates.has(name.toLowerCase())) candidates.set(name.toLowerCase(), color);
    }
  }
  const result: Record<string, string> = {};
  const counts = new Map<string, number>(repositoryPalette.map(color => [color, 0]));
  // Reserve valid old assignments before additions. Repair duplicates when the whole workspace fits;
  // beyond capacity keep retained colors stable and allocate additions from the least-used slots.
  for (const [key, name] of ordered) {
    const color = candidates.get(key);
    if (color && (ordered.length > repositoryPalette.length || counts.get(color) === 0)) {
      result[name] = color;
      counts.set(color, counts.get(color)! + 1);
    }
  }
  const pending = [...ordered.filter(([key]) => candidates.has(key)), ...ordered.filter(([key]) => !candidates.has(key))];
  for (const [key, name] of pending) {
    if (result[name]) continue;
    const old = candidates.get(key);
    const minimum = Math.min(...counts.values());
    const color = old && counts.get(old) === minimum ? old : repositoryPalette.find(color => counts.get(color) === minimum)!;
    result[name] = color;
    counts.set(color, counts.get(color)! + 1);
  }
  return result;
}

/** Standalone fallback; the dashboard supplies its shared workspace assignments on every surface. */
export function repositoryColor(fullName: string, colors?: Record<string, string>): string {
  const assigned = colors && Object.entries(colors).find(([name]) => name.toLowerCase() === fullName.toLowerCase())?.[1];
  if (validRepositoryColor(assigned)) return assigned;
  let hash = 2166136261;
  for (const char of fullName.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return repositoryPalette[hash % repositoryPalette.length]!;
}
