import type { Issue } from "./model";

const SCALE = [1, 2, 3, 5, 8, 13] as const;
export type ApproximatePoints = typeof SCALE[number];
type SizedIssue = Pick<Issue, "title" | "body" | "labels">;
const cached = new WeakMap<SizedIssue, { title: string; body: string | null | undefined; labels: string; points: ApproximatePoints }>();

/** Local sizing aid, not measured complexity or an AI prediction. Conflicting labels fall back to text. */
export function approximatePoints(issue: SizedIssue): ApproximatePoints {
  const labels = JSON.stringify(issue.labels.map(label => label.name));
  const previous = cached.get(issue);
  if (previous && previous.title === issue.title && previous.body === issue.body && previous.labels === labels) return previous.points;
  const points = sizeIssue(issue);
  cached.set(issue, { title: issue.title, body: issue.body, labels, points });
  return points;
}

function sizeIssue(issue: SizedIssue): ApproximatePoints {
  const explicit = new Set(issue.labels.flatMap(label => {
    const match = /^(?:story[\s_-]*points?|points?|sp)[\s:=_-]+(1|2|3|5|8|13)$/i.exec(label.name.trim());
    return match ? [Number(match[1]) as ApproximatePoints] : [];
  }));
  if (explicit.size === 1) return [...explicit][0]!;

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
  // (2/5/10 distinct list items) + at most two risk categories, capped at Fibonacci 13.
  const size = [30, 80, 160].filter(limit => vocabulary >= limit).length
    + [2, 5, 10].filter(limit => scopes.size >= limit).length + Math.min(2, risks);
  return SCALE[Math.min(SCALE.length - 1, size)]!;
}
