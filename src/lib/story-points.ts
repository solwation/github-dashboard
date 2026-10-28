import type { Issue } from "./model";

// Free text is weak evidence for proportional effort. Historical replay (#351) showed
// that the old 5/8/13 buckets inflated differences without corresponding work durations.
export const MAX_LOCAL_POINTS = 3;
const SCALE = [1, 2, MAX_LOCAL_POINTS] as const;
export type ApproximatePoints = number;
export interface StoryPoints { points: number; source: "label" | "local" }
type SizedIssue = Pick<Issue, "title" | "body" | "labels">;
const cached = new WeakMap<SizedIssue, { title: string; body: string | null | undefined; labels: string; result: StoryPoints }>();

/** Positive integers that JavaScript can represent exactly; reject rounded or infinite label values. */
export const validPoints = (points: number) => Number.isSafeInteger(points) && points > 0;

/** Preserve the numeric sizing API for time calibration and existing consumers. */
export function approximatePoints(issue: SizedIssue): number { return storyPoints(issue).points; }

/** An unambiguous label wins. Equivalent labels agree; distinct values fall back to local sizing. */
export function storyPoints(issue: SizedIssue): StoryPoints {
  const labels = JSON.stringify(issue.labels.map(label => label.name));
  const previous = cached.get(issue);
  if (previous && previous.title === issue.title && previous.body === issue.body && previous.labels === labels) return previous.result;
  const explicit = new Set(issue.labels.flatMap(label => {
    const match = /^(?:story[\s_-]*points?|points?|sp)(?:[\s:=_]+|[ \t]*-[ \t]*)([0-9]+)$/i.exec(label.name.trim());
    const points = match ? Number(match[1]) : NaN;
    return validPoints(points) ? [points] : [];
  }));
  const result: StoryPoints = explicit.size === 1 ? { points: [...explicit][0]!, source: "label" }
    : { points: localPoints(issue), source: "local" };
  cached.set(issue, { title: issue.title, body: issue.body, labels, result });
  return result;
}

/** A total is exact only when every contributing size is explicit and the sum is safely representable. */
export function sumStoryPoints(issues: readonly SizedIssue[]): StoryPoints {
  let points = 0, exact = issues.length > 0;
  for (const issue of issues) {
    const size = storyPoints(issue);
    points += size.points;
    exact &&= size.source === "label" && Number.isSafeInteger(points);
  }
  return { points, source: exact ? "label" : "local" };
}

/** Local sizing aid, not measured complexity or an AI prediction. */
function localPoints(issue: SizedIssue): number {
  const lines = new Set<string>(), scopes = new Set<string>();
  let fence: string | null = null;
  for (const raw of [issue.title, ...(issue.body || "").slice(0, 65536).replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/\r?\n/)]) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1];
    if (marker) { if (!fence) fence = marker[0]!; else if (marker[0] === fence) fence = null; continue; }
    if (fence || /^(?: {4}|\t|\s*[>#|])/.test(raw)) continue;
    if (/^\s*(?:\d{4}-\d{2}-\d{2}[T ]|at\s+\S+|(?:error|warn|info|debug|trace)\b|\w*(?:error|exception):)/i.test(raw)) continue;
    if (/^\s*(?:[{}\[\]]|"[^"]+"\s*:|(?:const|let|var|function|class|import|export|return)\b)/.test(raw)) continue;
    const item = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/.test(raw);
    const text = raw.slice(0, 1000).replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/, "").replace(/[*_~]/g, "")
      .toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
    if (!text || /^(?:n\/a|none|no response|inget svar|please (?:describe|provide|fill)|i (?:have read|agree)|jag har läst)\b/i.test(text)) continue;
    const words = text.match(/[\p{L}]{2,}/gu) || [];
    // Prose must dominate: skip source, JSON and symbol-heavy dumps outside fences too.
    if (words.length < 2 || words.join("").length < text.length * 0.5) continue;
    lines.add(text);
    if (item && text.length >= 12) scopes.add(text);
  }
  const prose = [...lines].join(" ");
  const vocabulary = new Set(prose.match(/[\p{L}]{2,}/gu) || []).size;
  const risks = [
    /\b(?:migrat\w*|schema\w*|databas\w*|database\w*)\b/i,
    /\b(?:auth\w*|oauth|security|säkerhet\w*|behörighet\w*|permission\w*)\b/i,
    /\b(?:concurr\w*|parallel\w*|samtidig\w*|deadlock|locking)\b/i,
    /\b(?:integrat\w*|api|arkitektur\w*|architect\w*|distribut\w*)\b/i,
  ].filter(pattern => pattern.test(prose)).length;
  // Scale index = vocabulary thresholds (30/80/160 distinct words) + scope thresholds
  // (2/5/10 distinct list items) + at most two risk categories, conservatively capped at 3.
  const size = [30, 80, 160].filter(limit => vocabulary >= limit).length
    + [2, 5, 10].filter(limit => scopes.size >= limit).length + Math.min(2, risks);
  return SCALE[Math.min(SCALE.length - 1, size)]!;
}
