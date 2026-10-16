import { readonly, ref } from "vue";

export type ThemePreference = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export const THEME_STORAGE_KEY = "issueflow-theme";
/** Browser chrome colors; index.html's pre-paint script uses the same values. */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: "#147d69", dark: "#10191b" };
const darkQuery = "(prefers-color-scheme: dark)";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "auto";
}
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  return preference === "auto" ? (systemPrefersDark ? "dark" : "light") : preference;
}
function storedPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "auto"; /* Theme selection works without storage. */
  }
}
function mediaQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(darkQuery) : null;
}
export function applyTheme(theme: ResolvedTheme, root: Document | undefined = typeof document === "undefined" ? undefined : document) {
  if (!root) return;
  root.documentElement.dataset.theme = theme;
  root.documentElement.style.colorScheme = theme;
  root.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

const selected = ref<ThemePreference>(storedPreference());
const query = mediaQuery();
const systemDark = ref(query?.matches ?? false);
const resolved = ref<ResolvedTheme>(resolveTheme(selected.value, systemDark.value));
function update() {
  resolved.value = resolveTheme(selected.value, systemDark.value);
  applyTheme(resolved.value);
}
update();
// Auto follows live operating-system/browser changes without a reload.
query?.addEventListener?.("change", (event) => {
  systemDark.value = event.matches;
  update();
});

export function setTheme(value: ThemePreference) {
  selected.value = parseThemePreference(value);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, selected.value);
  } catch {
    /* Remain usable without storage. */
  }
  update();
}
export function useTheme() {
  return { preference: readonly(selected), theme: readonly(resolved), setTheme };
}
