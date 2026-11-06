/**
 * Status-move animation (#419): a card or row whose status column changes at a sync moves
 * visibly from its old place to its new one.
 *
 * Technique: FLIP with the Web Animations API on the real card/row. The board re-renders as
 * usual; before the update the old position of each moved issue is read, after it the new
 * element is translated back to that position and animated to its own place. No clones, no
 * DOM changes and no layout properties: an interrupted or detached animation leaves nothing
 * behind, the element keeps its keyboard/click behaviour and the page never scrolls.
 *
 * Only a sync arms it (`arm()`), so first load, cache restore, filters, sorting, limits and
 * Cards/List switches are never mistaken for moves; detection also compares the status columns
 * of the unfiltered board, which those changes cannot alter.
 */
import { issueDomId } from "./issue-navigation";
import { column, type Lane, type Rules } from "./model";

export type StatusColumn = "backlog" | "progress" | "closed";
export interface StatusMove { id: string; from: StatusColumn; to: StatusColumn }

/** Status column per issue on the shown board, keyed by the repository-qualified DOM id. */
export function boardStatusColumns(lanes: readonly Lane[], rules: Readonly<Record<string, Rules | undefined>> = {}): Map<string, StatusColumn> {
  const columns = new Map<string, StatusColumn>();
  for (const lane of lanes) {
    // A loading lane has no snapshot yet; its first issues are an arrival, not a move.
    if (lane.loading) continue;
    const repoRules = rules[lane.repo.full_name] ?? {};
    for (const issue of lane.issues) {
      if (issue.pull_request) continue;
      columns.set(issueDomId(lane.repo.full_name, issue.number), issue.pendingClosure ? "closed" : column(issue, repoRules) as StatusColumn);
    }
  }
  return columns;
}

/** Issues present on both boards whose status column changed. New or removed issues are not moves. */
export function detectStatusMoves(before: ReadonlyMap<string, StatusColumn>, after: ReadonlyMap<string, StatusColumn>): StatusMove[] {
  const moves: StatusMove[] = [];
  for (const [id, to] of after) {
    const from = before.get(id);
    if (from && from !== to) moves.push({ id, from, to });
  }
  return moves;
}

export const BOARD_MOVE_ANIMATION = "board-move";
export const BOARD_MOVE_FEEDBACK = "board-move-feedback";
/** Long enough to follow a card across the board; the closing arrival already uses 700 ms. */
export const BOARD_MOVE_MS = 420;
export const BOARD_MOVE_FEEDBACK_MS = 1200;
const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])";

interface Captured { move: StatusMove; rect: DOMRect | null; focusIndex: number }

function visible(rect: DOMRect, view: { width: number; height: number }) {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.height && rect.left < view.width;
}

/**
 * Board-level controller. `arm()` right before a sync assigns new lanes; `update(prev, next)`
 * from a pre-flush watcher (old DOM still in place) captures, and plays after the render.
 */
export function createBoardMoves(options: {
  rules: () => Readonly<Record<string, Rules | undefined>>;
  nextTick: (callback: () => void) => unknown;
  doc?: Document;
}) {
  let armed = false;
  const doc = () => options.doc ?? (typeof document === "undefined" ? undefined : document);
  const reducedMotion = () => !!doc()?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function arm() {
    armed = true;
    // An assignment that changes nothing on the board fires no watcher; do not keep the flag
    // for a later, unrelated change.
    options.nextTick(() => options.nextTick(() => { armed = false; }));
  }

  function capture(moves: StatusMove[], document: Document): Captured[] {
    const active = document.activeElement;
    return moves.map((move) => {
      const element = document.getElementById(move.id);
      let focusIndex = -1;
      if (element && active && element.contains(active)) {
        focusIndex = active === element ? 0 : [...element.querySelectorAll(FOCUSABLE)].indexOf(active) + 1;
      }
      return { move, rect: element?.getBoundingClientRect() ?? null, focusIndex };
    });
  }

  function restoreFocus(element: HTMLElement, focusIndex: number, document: Document) {
    if (focusIndex < 0) return;
    const current = document.activeElement;
    if (current && current !== document.body && current.isConnected) return;
    const target = (focusIndex === 0 ? element : element.querySelectorAll<HTMLElement>(FOCUSABLE)[focusIndex - 1])
      ?? element.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus({ preventScroll: true });
  }

  function play(captured: Captured[], document: Document) {
    const view = document.defaultView;
    const size = { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 };
    const still = reducedMotion();
    for (const { move, rect, focusIndex } of captured) {
      const element = document.getElementById(move.id);
      if (!element) continue; // Hidden by a filter or a column limit: the count changes, nothing to show.
      restoreFocus(element, focusIndex, document);
      if (still || typeof element.animate !== "function") continue;
      for (const running of element.getAnimations?.() ?? []) {
        if (running.id === BOARD_MOVE_ANIMATION || running.id === BOARD_MOVE_FEEDBACK) running.cancel();
      }
      const next = element.getBoundingClientRect();
      if (rect && visible(rect, size) && visible(next, size)) {
        const dx = rect.left - next.left, dy = rect.top - next.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        // z-index lifts the flex item above the other columns while it travels.
        const animation = element.animate([
          { transform: `translate(${dx}px, ${dy}px)`, zIndex: 5 },
          { transform: "translate(0, 0)", zIndex: 5 },
        ], { duration: BOARD_MOVE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
        animation.id = BOARD_MOVE_ANIMATION;
      } else if (visible(next, size) || (rect && visible(rect, size))) {
        // One end is off-screen: no flight across the page and no scrolling, just a short
        // outline pulse on the card where it now is.
        const color = view?.getComputedStyle(element).getPropertyValue("--unread-move-border").trim() || "currentColor";
        const animation = element.animate([
          { outline: `2px solid ${color}`, outlineOffset: "-2px" },
          { outline: `2px solid transparent`, outlineOffset: "-2px" },
        ], { duration: BOARD_MOVE_FEEDBACK_MS, easing: "ease-out" });
        animation.id = BOARD_MOVE_FEEDBACK;
      }
    }
  }

  /** Call before the board re-renders (pre-flush watcher on the shown lanes). */
  function update(previous: readonly Lane[] | undefined, next: readonly Lane[]) {
    if (!armed) return;
    armed = false;
    const document = doc();
    if (!previous || !document) return;
    const rules = options.rules();
    const moves = detectStatusMoves(boardStatusColumns(previous, rules), boardStatusColumns(next, rules));
    if (!moves.length) return;
    const captured = capture(moves, document);
    options.nextTick(() => play(captured, document));
  }

  return { arm, update };
}
