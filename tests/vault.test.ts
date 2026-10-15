import { afterEach, expect, test, vi } from "vitest";
import { clearToken, loadToken, saveToken, VaultError } from "../src/lib/vault";

afterEach(() => vi.unstubAllGlobals());

test("unavailable storage returns friendly errors without poisoning later operations", async () => {
  vi.stubGlobal("indexedDB", undefined);
  await expect(loadToken()).rejects.toMatchObject({ name: "VaultError", code: "unavailable" });
  await expect(clearToken()).rejects.toBeInstanceOf(VaultError);
  await expect(saveToken("test-only")).rejects.toMatchObject({ code: "unavailable" });
});

test("storage denied by the browser is reported as a stable vault error", async () => {
  vi.stubGlobal("indexedDB", { open() { throw new DOMException("Denied", "SecurityError"); } });
  await expect(loadToken()).rejects.toMatchObject({ code: "unavailable" });
});
