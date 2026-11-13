import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Orchestra worktrees live in ./workingtree (git-ignored). Exclude them so a
// targeted run such as `npx vitest run tests/x.test.ts` never also collects
// another checkout's copy of the same test.
export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      exclude: [...configDefaults.exclude, "workingtree/**"],
    },
  }),
);
