import { afterEach, describe, expect, it, vi } from "vitest";
import { detectBrowserLanguage, locale, setLanguage, t, useLanguage } from "../src/lib/i18n";
afterEach(() => { setLanguage("auto"); vi.unstubAllGlobals(); });
describe("language selection", () => {
  it("uses the first supported browser language and falls back to English", () => {
    expect(detectBrowserLanguage(["de-DE", "sv-FI", "en-US"])).toBe("sv");
    expect(detectBrowserLanguage(["en-US", "sv-SE"])).toBe("en");
    expect(detectBrowserLanguage(["de-DE"])).toBe("en");
    expect(detectBrowserLanguage([])).toBe("en");
  });
  it("changes shared reactive locale and persists the preference", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    setLanguage("sv");
    expect(locale.value).toBe("sv-SE");
    expect(t("Översikt")).toBe("Översikt");
    expect(t("1 kommentar")).toBe("1 kommentar");
    expect(t("{count} kommentarer", { count: 0 })).toBe("0 kommentarer");
    expect(t("{count} kommentarer", { count: 5 })).toBe("5 kommentarer");
    setLanguage("en");
    expect(useLanguage().locale.value).toBe("en-GB");
    expect(t("Översikt")).toBe("Overview");
    expect(t("1 kommentar")).toBe("1 comment");
    expect(t("{count} kommentarer", { count: 0 })).toBe("0 comments");
    expect(t("{count} kommentarer", { count: 5 })).toBe("5 comments");
    expect(useLanguage().preference.value).toBe("en");
    expect(setItem).toHaveBeenLastCalledWith("issueflow-language", "en");
  });
  it("interpolates parameters without modifying issue content or unknown keys", () => {
    setLanguage("en");
    expect(t("GitHub svarade {status}. Kontrollera att du har åtkomst till repot.", { status: 404 })).toBe("GitHub returned 404. Check that you have access to the repository.");
    expect(t("Repository title: {title}", { title: "Min svenska issue" })).toBe("Repository title: Min svenska issue");
    expect(t("Unknown {parameter}")).toBe("Unknown {parameter}");
  });
  it("still changes language when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("blocked"); } });
    expect(() => setLanguage("sv")).not.toThrow();
    expect(t("Inställningar")).toBe("Inställningar");
  });
});
