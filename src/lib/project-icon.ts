/** Optional project artwork, read only through GitHub Contents; never owner avatars or download URLs. */
export const PROJECT_ICON_MAX_BYTES = 64 * 1024;
export const PROJECT_ICON_LIFETIME = 24 * 60 * 60 * 1000;
export const PROJECT_ICON_REQUEST_LIMIT = 6;
export type ProjectIconMetadata = { data: string | null; checkedAt: number; emptyVersion?: 2 };
const encodedLimit = Math.ceil(PROJECT_ICON_MAX_BYTES / 3) * 4;
function bytes(base64: string): string | null {
  if (!base64 || base64.length > encodedLimit || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  try { const result = atob(base64); return result.length <= PROJECT_ICON_MAX_BYTES ? result : null; } catch { return null; }
}
function rasterMime(value: string): string | null {
  if (value.startsWith("\x89PNG\r\n\x1a\n") && !value.includes("acTL")) return "image/png";
  if (value.startsWith("\xff\xd8\xff")) return "image/jpeg";
  if (value.startsWith("\x00\x00\x01\x00")) return "image/x-icon";
  if (value.startsWith("RIFF") && value.slice(8, 12) === "WEBP" && !(value.slice(12, 16) === "VP8X" && (value.charCodeAt(20) & 2))) return "image/webp";
  return null;
}
export function projectIconData(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:png|jpeg|webp|x-icon));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  const decoded = match ? bytes(match[2]!) : null;
  return decoded && rasterMime(decoded) === match![1] ? value : null;
}
export function restoreProjectIcon(value: unknown): ProjectIconMetadata | undefined {
  if (!value || typeof value !== "object") return;
  const icon = value as ProjectIconMetadata;
  if (!Number.isFinite(icon.checkedAt) || icon.checkedAt <= 0 || icon.checkedAt > Date.now() + 60_000) return;
  // Retry older empty results once after expanding discovery; successful artwork stays reusable.
  if (icon.data === null) return icon.emptyVersion === 2 ? { data: null, checkedAt: icon.checkedAt, emptyVersion: 2 } : undefined;
  const data = projectIconData(icon.data);
  if (data) return { data, checkedAt: icon.checkedAt };
}
/** Conservative SVG subset. Image-context rendering is inert too, but external references,
 * scripts, CSS, entities and unknown elements are rejected before the image decoder sees it. */
export function safeProjectSvg(value: string): boolean {
  value = value.replace(/^\s*<\?xml\s[^?]*\?>/i, "").replace(/<!--[^]*?-->/g, "");
  if (value.length > PROJECT_ICON_MAX_BYTES || /[&\\]|<\?|<!|\bon\w+\s*=|\b(?:style|xml:base)\s*=|\b(?:href|src)\s*=\s*['"](?!#)|url\s*\(\s*(?!#)/i.test(value)) return false;
  if (!/^\s*<svg(?:\s|>)/i.test(value) || !/<\/svg>\s*$/i.test(value)) return false;
  const allowed = new Set(["svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "title", "desc", "symbol", "use", "text", "tspan"]);
  const tags = [...value.matchAll(/<\/?([\w:-]+)/g)];
  return tags.length > 0 && tags.every(tag => allowed.has(tag[1]!.toLowerCase()));
}
/** SVG never enters the document. Only a small PNG generated from an inert image is retained. */
export async function rasterizeProjectSvg(svg: string): Promise<string | null> {
  if (!safeProjectSvg(svg) || typeof document === "undefined") return null;
  return new Promise(resolve => {
    const image = new Image();
    const timeout = setTimeout(() => resolve(null), 5000);
    image.onerror = () => { clearTimeout(timeout); resolve(null); };
    image.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
        const context = canvas.getContext("2d");
        if (!context || !image.naturalWidth || !image.naturalHeight) return resolve(null);
        const scale = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        context.drawImage(image, (64 - width) / 2, (64 - height) / 2, width, height);
        resolve(projectIconData(canvas.toDataURL("image/png")));
      } catch { resolve(null); }
    };
    image.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  });
}
type Entry = { type?: string; name?: string; path?: string; size?: number };
type Contents = Entry & { encoding?: string; content?: string };
export class ProjectIconResolver {
  private readonly cache = new Map<string, { result: Promise<ProjectIconMetadata | null>; expiresAt: number }>();
  constructor(private readonly request: (path: string, store?: boolean) => Promise<unknown>, private readonly available: () => boolean = () => true, private readonly rasterize = rasterizeProjectSvg) {}
  restore(repositories: readonly { full_name: string; projectIcon?: ProjectIconMetadata }[]) {
    for (const repo of repositories) {
      const icon = restoreProjectIcon(repo.projectIcon);
      if (icon && Date.now() - icon.checkedAt < PROJECT_ICON_LIFETIME && !this.cache.has(repo.full_name)) this.cache.set(repo.full_name, { result: Promise.resolve(icon), expiresAt: icon.checkedAt + PROJECT_ICON_LIFETIME });
    }
  }
  async get(repository: string, retryMissing = false): Promise<ProjectIconMetadata | null> {
    const cached = this.cache.get(repository);
    if (cached && cached.expiresAt > Date.now()) {
      if (!retryMissing) return cached.result;
      const metadata = await cached.result;
      // Explicit refresh retries only a confirmed miss, never positive art or a transient backoff.
      if (metadata?.data !== null) return metadata;
      if (this.cache.get(repository) !== cached) return this.get(repository);
      this.cache.delete(repository);
    }
    const result = this.discover(repository).then(data => ({ data, checkedAt: Date.now(), ...(data === null ? { emptyVersion: 2 as const } : {}) })).catch(error => {
      const failure = error as { status?: number; permissionDenied?: boolean; rateLimited?: boolean } | null;
      // Missing optional access is stable for this credential; do not spend core quota retrying it.
      if (failure?.status === 404 || (failure?.status === 403 && failure.permissionDenied && !failure.rateLimited)) return { data: null, checkedAt: Date.now(), emptyVersion: 2 as const };
      // A transient failure is neither a negative discovery nor a reason to discard prior art.
      const entry = this.cache.get(repository);
      if (entry) entry.expiresAt = Date.now() + 5 * 60_000;
      return null;
    });
    this.cache.set(repository, { result, expiresAt: Date.now() + PROJECT_ICON_LIFETIME });
    return result;
  }
  private async discover(repository: string): Promise<string | null> {
    if (!/^[\w-]+\/[\w.-]+$/.test(repository) || [".", ".."].includes(repository.split("/")[1]!)) return null;
    const name = repository.split("/")[1]!.toLowerCase(), compact = name.replace(/[^a-z0-9]/g, "");
    const stems = ["favicon", "icon", "rooticon", "logo", "apple-touch-icon", "icon-192", "icon-512", name, compact, `${compact}ai`, `${name}-icon`, `${compact}icon`, `${name}-logo`];
    const preferred = [...new Set(stems.flatMap(stem => ["png", "svg", "webp", "ico", "jpg", "jpeg"].map(extension => `${stem}.${extension}`)))];
    const directories = [""];
    let requests = 0;
    for (const directory of directories) {
      if (requests >= PROJECT_ICON_REQUEST_LIMIT - 1) return null;
      if (!this.available()) throw new Error("Optional icon discovery deferred");
      const path = `/repos/${repository}/contents` + (directory ? `/${directory}` : "");
      const result = await this.request(path); requests++;
      if (!Array.isArray(result)) continue;
      const entries = result.slice(0, 1000) as Entry[];
      const candidates = entries.filter(entry => entry && entry.type === "file" && typeof entry.name === "string" && entry.path === (directory ? directory + "/" : "") + entry.name && Number.isFinite(entry.size) && entry.size! > 0 && entry.size! <= PROJECT_ICON_MAX_BYTES);
      const selected = preferred.flatMap(name => candidates.filter(entry => entry.name!.toLowerCase() === name))[0];
      if (selected) {
        if (!this.available()) throw new Error("Optional icon discovery deferred");
        const file = await this.request(`/repos/${repository}/contents/${selected.path}`, false) as Contents;
        if (!file || file.type !== "file" || file.path !== selected.path || file.encoding !== "base64" || typeof file.content !== "string" || file.content.length > encodedLimit + 2048 || !Number.isFinite(file.size) || file.size! > PROJECT_ICON_MAX_BYTES) return null;
        const base64 = file.content.replace(/\s/g, ""), decoded = bytes(base64);
        if (!decoded) return null;
        const mime = rasterMime(decoded);
        if (mime) return `data:${mime};base64,${base64}`;
        if (!selected.name!.toLowerCase().endsWith(".svg")) return null;
        const svg = new TextDecoder().decode(Uint8Array.from(decoded, character => character.charCodeAt(0)));
        return safeProjectSvg(svg) ? this.rasterize(svg) : null;
      }
      const children = directory === "" ? ["public", "assets", "icons", "img", "images"] : directory === "public" ? ["icons", "assets", "img", "images"] : directory === "assets" ? ["icons", "img", "images"] : [];
      for (const child of children) if (entries.some(entry => entry && entry.type === "dir" && entry.name === child && entry.path === (directory ? directory + "/" : "") + child)) directories.push(directory ? directory + "/" + child : child);
    }
    return null;
  }
}
