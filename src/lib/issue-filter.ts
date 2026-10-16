import type { Issue } from "./model";

/** Global and repository searches use the same text and must both match. */
export function matchesIssueFilters(issue: Issue, globalQuery: string, repositoryQuery: string): boolean {
  const text = `${issue.title} #${issue.number} ${issue.labels.map(label => label.name).join(" ")}`.toLowerCase();
  return [globalQuery, repositoryQuery].every(query => text.includes(query.toLowerCase()));
}
