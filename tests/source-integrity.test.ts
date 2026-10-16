import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const scanner = fileURLToPath(new URL("../scripts/check-source-integrity.mjs", import.meta.url));
const folders: string[] = [];
function check(source: string) {
  const folder = mkdtempSync(join(tmpdir(), "issueflow-integrity-test-")); folders.push(folder);
  execFileSync("git", ["init", "--quiet", folder]);
  writeFileSync(join(folder, "Settings.vue"), source);
  execFileSync("git", ["add", "Settings.vue"], { cwd: folder });
  return spawnSync(process.execPath, [scanner, folder], { encoding: "utf8" });
}
afterEach(() => { folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true })); });
describe("source integrity build gate", () => {
  it("rejects conflict markers that Vue would render as ordinary template text", () => {
    const result = check('<template>\n<<<<<<< HEAD\n<button>Permissions</button>\n=======\n<input name="timeout">\n>>>>>>> feature/timeout\n</template>');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Settings.vue:2");
    expect(result.stderr).toContain("Settings.vue:4");
    expect(result.stderr).toContain("Settings.vue:6");
  });
  it("rejects indented diff3 ancestor markers and accepts resolved template content", () => {
    expect(check('<template>\r\n  ||||||| base\r\n</template>').status).toBe(1);
    expect(check('<template><button>Permissions</button><input name="timeout"></template>').status).toBe(0);
  });
});
