// Issue type derived from common GitHub labels (#195). Pure: icons and colours live in the component and style.css.
// The dashboard has no per-repository type rules; like the other detections it only reads labels, case-insensitively.
export type IssueType = "bug" | "security" | "feature" | "docs" | "question" | "help" | "chore";

// Priority order when several type labels are present: the first matching type wins (bug first).
export const ISSUE_TYPE_ORDER: readonly IssueType[] = ["bug", "security", "feature", "docs", "question", "help", "chore"];

const NAMES: Record<IssueType, readonly string[]> = {
  bug: ["bug", "defect", "regression"],
  security: ["security", "vulnerability"],
  feature: ["enhancement", "feature", "feature request"],
  docs: ["documentation", "docs"],
  question: ["question"],
  help: ["help wanted", "good first issue"],
  chore: ["chore", "refactor", "maintenance"],
};

function normalize(name: string) {
  return name.trim().toLowerCase().replace(/[-_:]+/g, " ").replace(/\s+/g, " ");
}

export function issueType(labels: readonly { name: string }[]): IssueType | null {
  const names = new Set(labels.map((l) => normalize(l.name)));
  return ISSUE_TYPE_ORDER.find((type) => NAMES[type].some((n) => names.has(n))) ?? null;
}
