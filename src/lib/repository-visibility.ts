import { isInactiveRepository, type SidebarRepository } from "./sidebar";

/**
 * Content visibility of a repository (#367). The left menu always lists it; only the board
 * leaves out a hidden one. `hidden` is the account's saved choice, `inactive` comes from
 * "Hide inactive repositories" and yields to a reveal for this session.
 */
export type RepositoryVisibility = "visible" | "hidden" | "inactive";

export interface VisibilityState {
  /** Manually hidden repositories, saved per account. */
  hidden: readonly string[];
  /** Hide inactive repositories from the board. */
  hideInactive: boolean;
  /** Inactive repositories shown anyway for this session. */
  revealed: readonly string[];
}

type VisibilityRepository = Pick<SidebarRepository, "fullName" | "backlog" | "progress" | "loading" | "external" | "unavailable">;

/**
 * A manual choice wins over everything. Automatic hiding uses the sidebar's own inactive group
 * (the account's projects only) and never hides a repository whose error must stay visible.
 */
export function repositoryVisibility(repo: VisibilityRepository, state: VisibilityState): RepositoryVisibility {
  if (state.hidden.includes(repo.fullName)) return "hidden";
  if (state.hideInactive && !repo.external && !repo.unavailable && isInactiveRepository(repo) && !state.revealed.includes(repo.fullName)) return "inactive";
  return "visible";
}

/** Show a repository on the board: clear a manual choice and reveal it past automatic hiding. */
export function showRepository(state: VisibilityState, name: string): { hidden: string[]; revealed: string[] } {
  return {
    hidden: state.hidden.filter(repo => repo !== name),
    revealed: state.revealed.includes(name) ? [...state.revealed] : [...state.revealed, name],
  };
}

/** Hide a repository manually; any session reveal is dropped so showing it again is one step. */
export function hideRepository(state: VisibilityState, name: string): { hidden: string[]; revealed: string[] } {
  return {
    hidden: state.hidden.includes(name) ? [...state.hidden] : [...state.hidden, name],
    revealed: state.revealed.filter(repo => repo !== name),
  };
}

/** Saved manual choices for repositories that still exist, without duplicates or junk. */
export function restoreHiddenRepositories(saved: unknown, available: readonly string[]): string[] {
  if (!Array.isArray(saved)) return [];
  return [...new Set(saved.filter((name): name is string => typeof name === "string" && available.includes(name)))];
}
