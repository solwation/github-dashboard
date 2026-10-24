# Design rules

How Issueflow looks and lines up. Derived from the existing UI in
[`src/style.css`](src/style.css), not a redesign. **New and changed UI code follows these
rules.** Existing code still drifts in places (for example 3/5/9/11/13px gaps and 11/13px
icons); the audit in #297 handles that, so do not reformat unrelated code in a feature change.
Verification is part of the [AI.md project rules](AI.md#project-and-verification).

## 1. Grid and spacing

- Base unit **4px**. Use the tokens in `src/style.css` `:root` for padding, margin and gap:

  | Token | `--space-1` | `--space-2` | `--space-3` | `--space-4` | `--space-5` | `--space-6` | `--space-8` |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Value | 4px | 8px | 12px | 16px | 20px | 24px | 32px |

- Inside a control or chip: `--space-1`/`--space-2`. Between items in a row or list: `--space-2`/`--space-3`.
  Card and panel padding: `--space-3`/`--space-4`. Between sections: `--space-6`/`--space-8`.
- No new arbitrary pixel values for spacing. `2px` is allowed only for hairline nudges (chip
  padding, underline offset); `1px` only for borders.
- Layout widths that are not spacing (sidebar 226px/70px, grid columns, max-widths) may keep
  their own values, but prefer `rem`/`fr`/`minmax()` for columns.

## 2. Alignment

- **Shared edges.** Siblings in a panel start at the same left edge; headings, captions
  (`.nav-caption`) and rows below them use the same inset. Do not compensate with per-item margins.
- **Fixed slots in repeated rows.** When an icon, badge or metadata item is optional, reserve
  its slot (fixed `width`/`flex: 0 0 <size>` or a grid column) so the columns of all rows line up
  whether or not it is present.
  - Do: `.issue-row` uses fixed grid columns, and `.row-id .type-slot { flex: 0 0 16px }`
    keeps issue numbers aligned whether or not the row has a type icon.
  - Don't: the sidebar repository list (#295) let the visibility icon, unread dot and Pages
    link appear only when present, so names, icons and counts shifted from row to row and the
    right edge was ragged.
- **Vertical centring.** Icons beside text sit in an `inline-flex`/`flex` container with
  `align-items: center`; never nudge with `top`/`margin-top`. Numbers that line up in columns
  use `font-variant-numeric: tabular-nums`.
- **Consistent right edges.** Trailing counts, times and actions are right-aligned in their own
  slot (`margin-left: auto` or a fixed grid column), so the right edge is straight across rows.
- Measure, don't eyeball: rows that should align differ by at most **±1px** (see §8).

## 3. Icons

- Use [Lucide](https://lucide.dev) (`@lucide/vue`) with its default 2px stroke. Do not mix
  icon sets or set `stroke-width` per icon; custom SVGs (for example `GithubIcon.vue`) match
  the same visual weight.
- Sizes, via `:size` matching the tokens:

  | Token | Size | Context |
  | --- | --- | --- |
  | `--icon-xs` | 12px | Inline metadata beside 9–11px text: counts, visibility, dates, labels |
  | `--icon-sm` | 16px | Buttons and controls beside 12–14px text, row type slot, sidebar actions |
  | `--icon-md` | 20px | Primary navigation, toolbar and header actions, empty states |

  Larger illustrative icons (empty/welcome states) are the only exception.
  The brand logo (`Layers3` in the sidebar header, 23px) is the one documented exception.
- Colour: icons inherit `currentColor`. Decorative and metadata icons use `var(--muted)`;
  `var(--green)` (accent) only for active state, primary action or a meaningful status. Status
  colours follow the text they belong to.
- Decorative icons get `aria-hidden="true"`. An icon that carries meaning on its own gets an
  accessible name (`role="img"` + `aria-label`, or `.sr-only` text).
- **Icon-only controls** are a real `<button>`/`<a>` with `aria-label` **and** a `title`
  tooltip on that element (the wrapper), not on the SVG.
- **Touch targets:** on `(pointer: coarse)` and in phone layouts, controls are at least
  **44×44px** (`min-width`/`min-height`, as `.column-sort-menu button` and the phone
  `.lane-actions > .icon-button` do). The visible icon stays
  its normal size; enlarge the hit area, not the glyph.

## 4. Typography and density

- Fonts: **DM Sans** for UI text, **Manrope** for headings and large numbers.
- Existing scale (do not add new sizes):

  | Use | Size / weight |
  | --- | --- |
  | Captions, eyebrows (uppercase, letter-spaced) | 9–10px, 700 |
  | Card metadata, labels, issue numbers | 8–11px |
  | Body and row text | 12–13px, titles 550–600 |
  | Lead text, coarse-pointer menus | 14px |
  | Dialog headings (`.modal h2`) / page `h1` | Manrope 22px / 33px |
  | Stat figures (`.stat strong`) | Manrope 27px, 700 |

- Line height: 1.4–1.5 for UI text, 1 for single-line figures. Weights 400–800 as loaded
  from Google Fonts in `style.css`.
- **Truncation:** single-line names and titles in repeated rows use `min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap` and carry the full text in a
  `title` (or an accessible name). Wrap instead when the text is the content being read
  (issue body, dialogs, summary footer values, which wrap as whole fields).
- Density: keep the existing compact density; do not increase row heights to fit new
  metadata — give it a slot or hide it at narrower breakpoints.

## 5. Colour

- Use the theme tokens only: `--bg`, `--surface`, `--text`, `--muted`, `--line`, `--green`,
  `--on-green`, `--hover`, `--focus`, `--input-border`, `--code-bg`, `--chart-*`, `--card`,
  `--faint`, `--tint-*`, `--accent-*`, and the semantic state tokens (`--status-*`, `--unread*`,
  `--timeout-*`, `--marker-*`, `--badge-*`, `--diff-add`/`--diff-del`). `--card`, `--faint`,
  `--accent-red` and `--accent-amber` have light values; `--tint-*` and
  `--accent-green/-blue/-purple` are dark-only, so give them a light fallback
  (`var(--accent-green, #147d69)`) or use a semantic token when used outside dark rules.
- **No new hard-coded colours** in component or rule bodies. If a colour is missing, add a
  token with both a light value (`:root`) and a dark value (`:root[data-theme="dark"]`).
  Repository colours come from `--repository-color` mixed with `color-mix()`.
- **Light/dark parity:** every new surface, border and text colour is checked in both themes.
- **Contrast:** text ≥ 4.5:1 (WCAG AA) on its background; meaningful icons, borders and chart
  marks ≥ 3:1. Do not rely on colour alone; pair status colour with an icon or text.

## 6. Motion

- Short transitions only (about 0.15s on colour, border, opacity, transform).
- Every animation or transition has a `@media (prefers-reduced-motion: reduce)` override that
  removes it (`transition: none; animation: none`).

## 7. Responsive breakpoints

| Breakpoint | Layout |
| --- | --- |
| `min-width: 1600px` | Wide desktop: slightly larger card text and padding |
| `max-width: 1250px` | Narrow desktop: sidebar narrows to 195px |
| `max-width: 950px` | Sidebar collapses to a 70px icon rail |
| `max-width: 650px`, or `max-width: 950px and max-height: 500px` | Phone: sidebar becomes a 64px top bar, single column (landscape phone included) |
| `max-width: 480px` / `360px` | Narrow phone: hide secondary metadata |
| `pointer: coarse` | Touch: 44px targets, larger menu text |
| `hover: hover` | Hover-only affordances; never the only way to reach an action |

Reuse these breakpoints; do not add new ones without a reason in the issue.

## 8. Verification checklist

For every UI change, before review:

- [ ] Spacing, icon sizes, type and colours use the tokens and scales above.
- [ ] Repeated rows align: measure left edges, icon slots and right edges across rows with
      Playwright `boundingBox()`; differences ≤ 1px, including rows without the optional item.
- [ ] Icons are vertically centred with their text.
- [ ] No overflow: long titles, labels and repository names truncate with ellipsis and tooltip;
      no horizontal page scroll; no unexpectedly tall rows.
- [ ] Light and dark themes both inspected; contrast as in §5.
- [ ] Icon-only controls have `aria-label` + `title`, keyboard focus, and 44px targets on touch.
- [ ] Reduced motion honoured.
- [ ] Cards/List changes: the four-scenario matrix in [AI.md](AI.md#project-and-verification)
      (1600×1000, 1000×900, mobile 390×844 and 844×390, plus 320×568 for density/truncation).
- [ ] Other UI (sidebar, overview, dialogs): at least wide desktop, the 950px rail and a
      mobile 390×844 context.
