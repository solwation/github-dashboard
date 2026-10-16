import { afterEach, describe, expect, it, vi } from "vitest";
import { parseThemePreference, resolveTheme, THEME_COLORS } from "../src/lib/theme";

function fakeEnvironment(saved: string | null, prefersDark: boolean, storage?: Partial<Storage>) {
  const listeners: ((event: { matches: boolean }) => void)[] = [];
  const meta = { content: "", setAttribute(_: string, value: string) { this.content = value; } };
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", storage ?? { getItem: () => saved, setItem });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: prefersDark, addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.push(listener) }),
  });
  vi.stubGlobal("document", { documentElement: root, querySelector: () => meta });
  return { root, meta, setItem, systemChange: (matches: boolean) => listeners.forEach(listener => listener({ matches })) };
}
async function freshTheme() {
  vi.resetModules();
  return import("../src/lib/theme");
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("theme preference", () => {
  it("defaults unknown or missing values to Auto and resolves against the system scheme", () => {
    expect(parseThemePreference(null)).toBe("auto");
    expect(parseThemePreference("sepia")).toBe("auto");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows live system changes in Auto and lets a manual choice override them", async () => {
    const env = fakeEnvironment(null, false);
    const { useTheme } = await freshTheme();
    const theme = useTheme();
    expect(theme.preference.value).toBe("auto");
    expect(env.root.dataset.theme).toBe("light");
    env.systemChange(true);
    expect(theme.theme.value).toBe("dark");
    expect(env.root.dataset.theme).toBe("dark");
    expect(env.root.style.colorScheme).toBe("dark");
    expect(env.meta.content).toBe(THEME_COLORS.dark);
    theme.setTheme("light");
    expect(env.root.dataset.theme).toBe("light");
    expect(env.meta.content).toBe(THEME_COLORS.light);
    expect(env.setItem).toHaveBeenLastCalledWith("issueflow-theme", "light");
    env.systemChange(false);
    env.systemChange(true);
    expect(env.root.dataset.theme).toBe("light");
  });

  it("restores a saved choice and works when storage is blocked", async () => {
    let env = fakeEnvironment("dark", false);
    expect((await freshTheme()).useTheme().theme.value).toBe("dark");
    expect(env.root.dataset.theme).toBe("dark");
    vi.unstubAllGlobals();
    const blocked = () => { throw new Error("blocked"); };
    env = fakeEnvironment(null, true, { getItem: blocked, setItem: blocked });
    const { useTheme } = await freshTheme();
    expect(useTheme().theme.value).toBe("dark");
    expect(() => useTheme().setTheme("light")).not.toThrow();
    expect(env.root.dataset.theme).toBe("light");
  });
});
