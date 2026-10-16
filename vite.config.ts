import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bundledReleaseNotes, RELEASE_NOTES_FILE } from "./src/lib/release-notes.ts";

type BuildInfo = { builtAt: string | null; commit: string | null };

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

/**
 * Publishes the bundled release notes with this build's identity, so an older
 * installed version can fetch what is new without a token. Deliberately not in
 * the service-worker shell list: it must always come from the network.
 */
function releaseNotes(build: BuildInfo): Plugin {
  const source = () =>
    JSON.stringify({ build, days: bundledReleaseNotes }, null, 2) + "\n";
  return {
    name: "issueflow-release-notes",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: RELEASE_NOTES_FILE, source: source() });
    },
    configureServer(server) {
      // Only the published path next to index.html; /src/release-notes.json is a module import.
      const base = server.config.base.startsWith("/") ? server.config.base : "/";
      const published = base.replace(/\/?$/, "/") + RELEASE_NOTES_FILE;
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] === published) {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(source());
        } else next();
      });
    },
  };
}

export default defineConfig(({ command }) => {
  // One identity for the bundle constant and the published release notes.
  const buildInfo: BuildInfo = {
    builtAt: command === "build" ? new Date().toISOString() : null,
    commit: commitHash(),
  };
  return {
    plugins: [vue(), appShell(), releaseNotes(buildInfo)],
    base: process.env.GITHUB_ACTIONS ? "/github-dashboard/" : "./",
    define: {
      __WORKFLOW_GUIDE__: JSON.stringify(readFileSync(new URL("./public/ISSUEFLOW.md", import.meta.url), "utf8")),
      __BUILD_INFO__: JSON.stringify(buildInfo),
    },
  };
});
