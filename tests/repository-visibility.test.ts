import { describe, expect, it } from "vitest";
import { hideRepository, repositoryVisibility, restoreHiddenRepositories, showRepository, type VisibilityState } from "../src/lib/repository-visibility";

const active = { fullName: "me/active", backlog: 1, progress: 0 };
const inactive = { fullName: "me/inactive", backlog: 0, progress: 0 };
const external = { fullName: "other/quiet", backlog: 0, progress: 0, external: true };
const state = (overrides: Partial<VisibilityState> = {}): VisibilityState => ({ hidden: [], hideInactive: false, revealed: [], ...overrides });

describe("repository board visibility (#367)", () => {
  it("hides manual choices for own and external repositories regardless of activity", () => {
    const hidden = state({ hidden: ["me/active", "other/quiet"] });
    expect(repositoryVisibility(active, hidden)).toBe("hidden");
    expect(repositoryVisibility(external, hidden)).toBe("hidden");
    expect(repositoryVisibility(inactive, hidden)).toBe("visible");
  });

  it("hides inactive own repositories only while automatic hiding is on", () => {
    expect(repositoryVisibility(inactive, state())).toBe("visible");
    expect(repositoryVisibility(inactive, state({ hideInactive: true }))).toBe("inactive");
    expect(repositoryVisibility(active, state({ hideInactive: true }))).toBe("visible");
    // The sidebar never groups other people's repositories as inactive, nor loading or failed ones.
    expect(repositoryVisibility(external, state({ hideInactive: true }))).toBe("visible");
    expect(repositoryVisibility({ ...inactive, loading: true }, state({ hideInactive: true }))).toBe("visible");
    expect(repositoryVisibility({ ...inactive, unavailable: true }, state({ hideInactive: true }))).toBe("visible");
  });

  it("lets a reveal override automatic hiding but never a manual choice", () => {
    expect(repositoryVisibility(inactive, state({ hideInactive: true, revealed: ["me/inactive"] }))).toBe("visible");
    expect(repositoryVisibility(inactive, state({ hideInactive: true, revealed: ["me/inactive"], hidden: ["me/inactive"] }))).toBe("hidden");
  });

  it("keeps manual choices when automatic hiding is turned off", () => {
    const current = state({ hideInactive: true, hidden: ["me/active"] });
    expect(repositoryVisibility(active, { ...current, hideInactive: false })).toBe("hidden");
  });

  it("shows and hides in one step from either hiding cause", () => {
    const auto = state({ hideInactive: true });
    const shown = { ...auto, ...showRepository(auto, "me/inactive") };
    expect(repositoryVisibility(inactive, shown)).toBe("visible");
    const hidden = { ...shown, ...hideRepository(shown, "me/inactive") };
    expect(hidden).toMatchObject({ hidden: ["me/inactive"], revealed: [] });
    expect(repositoryVisibility(inactive, hidden)).toBe("hidden");
    const again = { ...hidden, ...showRepository(hidden, "me/inactive") };
    expect(repositoryVisibility(inactive, again)).toBe("visible");
    expect(hideRepository(hidden, "me/inactive").hidden).toEqual(["me/inactive"]);
  });

  it("restores saved choices for available repositories only", () => {
    expect(restoreHiddenRepositories(["me/a", "me/a", 3, "gone/x", "other/b"], ["me/a", "other/b"])).toEqual(["me/a", "other/b"]);
    expect(restoreHiddenRepositories("me/a", ["me/a"])).toEqual([]);
    expect(restoreHiddenRepositories(undefined, ["me/a"])).toEqual([]);
  });
});
