/** Development-only User Timing around cache startup (#121); production builds drop it. */
export async function measured<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  if (!import.meta.env.DEV) return run();
  const start = performance.now();
  try { return await run(); } finally { performance.measure(`issueflow:${name}`, { start }); }
}
/** Measures from now until the frame after the next DOM update has been painted. */
export function measureRender(name: string, afterUpdate: (callback: () => void) => unknown) {
  if (!import.meta.env.DEV) return;
  const start = performance.now();
  afterUpdate(() => requestAnimationFrame(() => setTimeout(() => performance.measure(`issueflow:${name}`, { start }))));
}
