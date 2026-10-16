import { describe, expect, it } from "vitest";
import { reconcileRepositoryColors, repositoryColor, repositoryPalette } from "../src/lib/repository-color";

// These six names previously hashed to neighboring blue/green hues (185–200 degrees).
const names = [15, 27, 41, 59, 79, 84].map(n => `sample/project-${n}`);
describe("workspace repository palette", () => {
  it("spreads neighboring legacy hashes across six distinct warm and cool palette colors", () => {
    const assigned = reconcileRepositoryColors(names, {});
    expect(Object.values(assigned)).toEqual(repositoryPalette.slice(0, 6));
    expect(new Set(Object.values(assigned)).size).toBe(6);
    expect(names.map(name => repositoryColor(name.toUpperCase(), assigned))).toEqual(Object.values(assigned));
  });
  it("retains assignments across order, reload and replacing a selected repository", () => {
    const original = reconcileRepositoryColors(names, {});
    expect(reconcileRepositoryColors([...names].reverse(), JSON.parse(JSON.stringify(original)))).toEqual(original);
    const next = reconcileRepositoryColors(["sample/aaa", ...names.slice(1)], original);
    names.slice(1).forEach(name => expect(next[name]).toBe(original[name]));
    expect(next["sample/aaa"]).toBe(original[names[0]!]);
    expect(next).not.toHaveProperty(names[0]!);
  });
  it("repairs duplicates before assigning additions, preserving first canonical retained assignment", () => {
    const assigned = reconcileRepositoryColors(["sample/c", "sample/b", "Sample/A", "sample/new"], {
      "SAMPLE/A": repositoryPalette[2], "sample/b": repositoryPalette[2], "sample/c": repositoryPalette[0],
      "inaccessible/repo": repositoryPalette[1],
    });
    expect(assigned["Sample/A"]).toBe(repositoryPalette[2]);
    expect(assigned["sample/c"]).toBe(repositoryPalette[0]);
    expect(new Set(Object.values(assigned)).size).toBe(4);
    expect(Object.keys(assigned).sort()).toEqual(["Sample/A", "sample/b", "sample/c", "sample/new"]);
  });
  it("ignores malformed storage and unsupported CSS, canonicalizes identity and bounds selection", () => {
    expect(reconcileRepositoryColors(["Sample/Repo", "SAMPLE/REPO", "../bad"], { "sample/repo": "url(unsafe)" })).toEqual({ "Sample/Repo": repositoryPalette[0] });
    for (const saved of [null, [], "bad", 42]) expect(reconcileRepositoryColors(names, saved)).toEqual(reconcileRepositoryColors(names, {}));
    const many = Array.from({ length: 101 }, (_, n) => `sample/repo-${n}`);
    expect(Object.keys(reconcileRepositoryColors(many, {}))).toHaveLength(100);
  });
  it("reuses the finite palette evenly and keeps overflow assignments stable on reload", () => {
    const many = Array.from({ length: 40 }, (_, n) => `sample/repo-${n}`);
    const assigned = reconcileRepositoryColors(many, {});
    const counts = repositoryPalette.map(color => Object.values(assigned).filter(value => value === color).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(reconcileRepositoryColors([...many].reverse(), assigned)).toEqual(assigned);
    const replaced = reconcileRepositoryColors(["sample/aaa", ...many.slice(1)], assigned);
    many.slice(1).forEach(name => expect(replaced[name]).toBe(assigned[name]));
  });
});
