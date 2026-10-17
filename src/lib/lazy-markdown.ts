import { shallowRef } from "vue";

type Render = (source: string | null | undefined) => string;

// The Markdown stack is only needed once a description or comment is opened,
// so it lives in its own chunk instead of the startup bundle.
const renderer = shallowRef<Render>();
const failed = shallowRef(false);
let pending: Promise<Render> | undefined;

export function loadMarkdown(): Promise<Render> {
  failed.value = false;
  pending ??= import("./markdown").then(
    (module) => (renderer.value = module.renderMarkdown),
    (error: unknown) => {
      pending = undefined;
      failed.value = true;
      throw error;
    },
  );
  return pending;
}

/** Reactive access to the lazily loaded renderer for components. */
export function useMarkdown() {
  return {
    renderer,
    failed,
    load: () => loadMarkdown().catch(() => undefined),
  };
}
