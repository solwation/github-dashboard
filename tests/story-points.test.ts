import { describe, expect, it } from "vitest";
import { approximatePoints, storyPoints, sumStoryPoints } from "../src/lib/story-points";
const score = (title = "Fix button spelling", body = "", labels: string[] = []) => approximatePoints({ title, body, labels: labels.map(name => ({ name, color: "000000" })) });

describe("rough local story points", () => {
  it("prefers one explicit point value, but ignores ambiguous or unrelated labels", () => {
    expect(score("Small fix", "", ["story-points: 13"])).toBe(13);
    expect(score("Small fix", "", ["SP: 3", "points: 3"])).toBe(3);
    expect(score("Small fix", "", ["points: 3", "points: 8"])).toBe(1);
    expect(score("Small fix", "", ["priority: high", "points: 0", "estimate: 8", "3 hours"])).toBe(1);
  });
  it("uses positive safe integers and preserves label provenance, including equivalent labels", () => {
    for (const [label, points] of [["sp-1", 1], ["sp-2", 2], ["sp-4", 4], ["SP: 5", 5], ["points: 100", 100], [`sp-${Number.MAX_SAFE_INTEGER}`, Number.MAX_SAFE_INTEGER]] as const) {
      expect(storyPoints({ title: "Small fix", body: "", labels: [{ name: label, color: "" }] })).toEqual({ points, source: "label" });
    }
    expect(score("Small fix", "", ["SP: 04", "points: 4"])).toBe(4);
    for (const label of ["sp-0", "sp--1", "points: -2", "sp-1.5", "sp-1e3", "sp-Infinity", "sp-9007199254740992", "sp-" + "9".repeat(400), "estimate: 4", "sp4"]) {
      expect(storyPoints({ title: "Small fix", labels: [{ name: label, color: "" }] })).toEqual({ points: 1, source: "local" });
    }
    expect(score("Small fix", "", ["sp-4", "SP: 5"])).toBe(1);
  });
  it("keeps source fresh when label changes leave the numeric score unchanged, and marks mixed/unsafe totals approximate", () => {
    const issue = { title: "Small fix", labels: [{ name: "sp-1", color: "" }] };
    expect(storyPoints(issue)).toEqual({ points: 1, source: "label" });
    issue.labels[0]!.name = "bug";
    expect(storyPoints(issue)).toEqual({ points: 1, source: "local" });
    const explicit = (points: number) => ({ title: "Small fix", labels: [{ name: `sp-${points}`, color: "" }] });
    expect(sumStoryPoints([explicit(2), explicit(4)])).toEqual({ points: 6, source: "label" });
    expect(sumStoryPoints([explicit(4), issue])).toEqual({ points: 5, source: "local" });
    expect(sumStoryPoints([explicit(Number.MAX_SAFE_INTEGER), explicit(1)]).source).toBe("local");
    expect(sumStoryPoints([])).toEqual({ points: 0, source: "local" });
  });
  it("handles absent text and gives additional scope a higher bounded score in both languages", () => {
    expect(score("", "")).toBe(1);
    const english = "- Add account selection\n- Restore saved account settings\n- Validate callback permissions\n- Migrate the database schema\n- Integrate external authentication";
    const swedish = "- Lägg till kontoval\n- Återställ sparade kontoinställningar\n- Kontrollera användarens behörigheter\n- Migrera databasens schema\n- Integrera extern autentisering";
    expect(score("Expand account support", english)).toBeGreaterThan(1);
    expect(score("Utöka kontostöd", swedish)).toBeGreaterThan(1);
    for (const body of [english, swedish]) expect(score("Account support", body)).toBeLessThanOrEqual(3);
  });
  it("does not inflate scores from repeated scope, template boilerplate or pasted logs/code", () => {
    const substantive = "- Update the button label\n- Preserve the existing focus";
    const baseline = score("Fix button spelling", substantive);
    expect(score("Fix button spelling", Array(500).fill(substantive).join("\n"))).toBe(baseline);
    const pasted = [
      "```typescript\n" + Array(500).fill("const schema = authenticate(database.migrate());").join("\n") + "\n```",
      "~~~\n" + "integration concurrency database security\n".repeat(500) + "~~~",
      "    const database = authenticate();\n".repeat(500),
      '2026-10-20T12:00:00 INFO database authentication integration\n'.repeat(500),
      '{\n"database": "schema authentication concurrency",\n}\n'.repeat(500),
      "### Acceptance criteria\n_No response_\n- I have read the contribution guidelines\n".repeat(500),
      "<!-- database authentication concurrency -->\n".repeat(500),
    ];
    for (const addition of pasted) expect(score("Fix button spelling", substantive + "\n" + addition)).toBe(baseline);
  });
  it("caps even large distinct scopes and text, rather than treating length as unlimited effort", () => {
    const words = Array.from({ length: 400 }, (_, i) => "word" + String.fromCharCode(97 + i % 26, 97 + Math.floor(i / 26)));
    const paragraphs = Array.from({ length: 16 }, (_, i) => words.slice(i * 25, (i + 1) * 25).join(" ")).join("\n");
    expect(score("Document example", paragraphs)).toBe(3);
    expect(score("Migrate database authentication API", words.map(word => "- Implement " + word + " support").join("\n"))).toBe(3);
  });
  it("invalidates the in-memory cache when mutable text or point labels change", () => {
    const issue = { title: "Fix button spelling", body: "", labels: [] as { name: string; color: string }[] };
    expect(approximatePoints(issue)).toBe(1);
    issue.title = "Migrate database authentication";
    expect(approximatePoints(issue)).toBe(3);
    issue.title = "Fix button spelling";
    issue.body = "- Update the button label\n- Preserve the existing focus";
    expect(approximatePoints(issue)).toBe(2);
    issue.labels.push({ name: "points: 8", color: "000000" });
    expect(approximatePoints(issue)).toBe(8);
    issue.labels[0]!.name = "points: 3";
    expect(approximatePoints(issue)).toBe(3);
  });
});
