/** Identity-based rather than position-based: selection and sorting never recolor a repo. */
export function repositoryColor(fullName: string): string {
  let hash = 2166136261;
  for (const char of fullName.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const hue = (hash % 36000) / 100;
  const saturation = 52 + ((hash >>> 16) % 19);
  const lightness = 34 + ((hash >>> 24) % 10);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
