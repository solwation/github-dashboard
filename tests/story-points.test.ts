import { describe, expect, it } from "vitest";
import { approximatePoints } from "../src/lib/story-points";
const score = (title = "Fix button spelling", body = "", labels: string[] = []) => approximatePoints({ title, body, labels: labels.map(name => ({ name, color: "000000" })) });

describe("rough local story points", () => {
  it("prefers one explicit bounded point label, but ignores ambiguous or unrelated labels", () => {
    expect(score("Small fix", "", ["story-points: 13"])).toBe(13);
    expect(score("Small fix", "", ["SP: 3", "points: 3"])).toBe(3);
    expect(score("Small fix", "", ["points: 3", "points: 8"])).toBe(1);
    expect(score("Small fix", "", ["priority: high", "points: 100", "estimate: 8", "3 hours"])).toBe(1);
  });
  it("handles absent text and gives additional scope a higher bounded score in both languages", () => {
    expect(score("", "")).toBe(1);
    const english = "- Add account selection\n- Restore saved account settings\n- Validate callback permissions\n- Migrate the database schema\n- Integrate external authentication";
    const swedish = "- Lägg till kontoval\n- Återställ sparade kontoinställningar\n- Kontrollera användarens behörigheter\n- Migrera databasens schema\n- Integrera extern autentisering";
    expect(score("Expand account support", english)).toBeGreaterThan(1);
    expect(score("Utöka kontostöd", swedish)).toBeGreaterThan(1);
    for (const body of [english, swedish]) expect(score("Account support", body)).toBeLessThanOrEqual(13);
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
    expect(score("Document example", paragraphs)).toBe(5);
    expect(score("Migrate database authentication API", words.map(word => "- Implement " + word + " support").join("\n"))).toBe(13);
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
