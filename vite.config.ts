import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function commitHash(): string | null {
  const actionsHash = process.env.GITHUB_ACTIONS && process.env.GITHUB_SHA;
  if (actionsHash && /^[a-f0-9]{40,64}$/i.test(actionsHash)) return actionsHash;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function appShell(): Plugin {
  return {
    name: "issueflow-app-shell",
    enforce: "post",
    apply: "build",
    generateBundle(_, bundle) {
      const files = [
        "./",
        "./manifest.webmanifest",
        "./favicon.svg",
        "./icons/icon-192.png",
        "./icons/icon-512.png",
        "./icons/apple-touch-icon.png",
        ...Object.keys(bundle)
          .filter((name) => /\.(js|css)$/.test(name))
          .map((name) => "./" + name),
      ];
      const version = createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex")
        .slice(0, 16);
      const source = readFileSync(
        new URL("./scripts/service-worker.js", import.meta.url),
        "utf8",
      )
        .replace("__CACHE_VERSION__", version)
        .replace("__SHELL_FILES__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}
export default defineConfig(({ command }) => ({
  plugins: [vue(), appShell()],
  base: process.env.GITHUB_ACTIONS ? "/github-dashboard/" : "./",
  define: {
    __BUILD_INFO__: JSON.stringify({
      builtAt: command === "build" ? new Date().toISOString() : null,
      commit: commitHash(),
    }),
  },
}));
