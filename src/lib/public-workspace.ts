import type { Repo } from "./model";
/** Separate from every valid GitHub login; contents still use the encrypted settings store. */
export const PUBLIC_SETTINGS_ACCOUNT = ':public-workspace:';
const MODE_KEY = 'issueflow:public-mode';
export function publicWorkspaceRemembered(): boolean {
  try { return localStorage.getItem(MODE_KEY) === 'true'; } catch { return false; }
}
export function rememberPublicWorkspace(active: boolean) {
  try { if (active) localStorage.setItem(MODE_KEY, 'true'); else localStorage.removeItem(MODE_KEY); } catch { /* Session remains usable. */ }
}
/** Accept repository names and canonical HTTPS GitHub URLs, never arbitrary API addresses. */
export function publicRepositoryName(value: string): string | null {
  let name = value.trim();
  if (/^https:\/\//i.test(name)) {
    try {
      const url = new URL(name);
      if (url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) return null;
      name = url.pathname.slice(1);
    } catch { return null; }
  }
  name = name.replace(/\/$/, '').replace(/\.git$/, '');
  return /^[\w-]+\/[\w.-]+$/.test(name) && !['.', '..'].includes(name.split('/')[1]!) ? name : null;
}

/** Restore only verified public metadata, with canonical links and no account-specific fields. */
export function publicRepositoryRecord(value: unknown): Repo | null {
  if (!value || typeof value !== "object") return null;
  const repo = value as Partial<Repo>;
  const name = typeof repo.full_name === "string" ? publicRepositoryName(repo.full_name) : null;
  if (!name || repo.private !== false || !Number.isSafeInteger(repo.id) || repo.id! <= 0) return null;
  const [owner, short] = name.split("/");
  return { id: repo.id!, name: short!, full_name: name, private: false, owner: { login: owner! },
    html_url: `https://github.com/${name}`, description: typeof repo.description === "string" ? repo.description : null,
    ...(repo.has_pages === true ? { has_pages: true } : {}),
    ...(typeof repo.language === "string" ? { language: repo.language } : {}) };
}
