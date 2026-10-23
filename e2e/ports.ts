// Each checkout runs its own servers (orchestra v0.2.3, #289): set E2E_DEV_PORT and
// E2E_PREVIEW_PORT per worktree so tests never reach another checkout's server.
export const devOrigin = `http://127.0.0.1:${process.env.E2E_DEV_PORT || 5173}`;
export const previewOrigin = `http://127.0.0.1:${process.env.E2E_PREVIEW_PORT || 4173}`;
