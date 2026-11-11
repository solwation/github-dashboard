import type { ComputedRef, InjectionKey, Ref } from "vue";

type Translate = (key: string, params?: Record<string, string | number>) => string;
export type ImageSource = { key: string; html: string };
export const imageGalleryKey: InjectionKey<{ description: ComputedRef<string>; comments: Ref<ImageSource[]> }> = Symbol("issue image gallery");

export type FileLoader = (repository: string, path: string) => Promise<string | null>;
export const fileLoaderKey: InjectionKey<FileLoader> = Symbol("repo file loader");

export function issueRepository(issue?: { html_url?: string } | null): string | undefined {
  if (!issue?.html_url) return undefined;
  const match = issue.html_url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/\d+/);
  return match?.[1];
}

export interface DetectedImage {
  key: string;
  name: string;
  alt: string;
  src?: string;
  path?: string;
  assetUrl?: string;
  repository?: string;
  isInline?: boolean;
}

export interface ReleaseAssetRef {
  owner: string;
  repo: string;
  repository: string;
  tag: string;
  assetName: string;
  url: string;
}

export function parseReleaseAssetUrl(urlStr: string | null | undefined): ReleaseAssetRef | null {
  if (!urlStr) return null;
  const clean = urlStr.trim();
  try {
    const url = new URL(clean);
    if (url.hostname !== "github.com") return null;
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/(.+)\/([^/]+)$/);
    if (!match) return null;
    const owner = match[1]!;
    const repo = match[2]!;
    const tag = decodeURIComponent(match[3]!);
    const assetName = decodeURIComponent(match[4]!);
    if (!IMAGE_EXTENSIONS.test(assetName)) return null;
    return {
      owner,
      repo,
      repository: `${owner}/${repo}`,
      tag,
      assetName,
      url: `${url.origin}${url.pathname}`,
    };
  } catch {
    return null;
  }
}

export const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const TEXT_IMAGE_PATH = /(?:^|[\s(`"'])((?:\.{0,2}\/|[a-zA-Z0-9_.-]+\/)[a-zA-Z0-9_./-]*\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico))(?=[\s)`"'\]:;.]|$)/gi;

export function normalizeRepoPath(rawPath: string | null | undefined): string | null {
  if (!rawPath) return null;
  const clean = rawPath.replace(/[?#].*$/, "").trim();
  if (!clean || clean.includes("://") || clean.startsWith("data:")) return null;
  const parts = clean.split("/").filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (resolved.length > 0) resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  if (!resolved.length) return null;
  const normalized = resolved.join("/");
  return IMAGE_EXTENSIONS.test(normalized) ? normalized : null;
}

export function basename(pathOrUrl: string): string {
  const clean = pathOrUrl.replace(/[?#].*$/, "");
  const part = clean.split("/").filter(Boolean).pop() || "image";
  try { return decodeURIComponent(part); } catch { return part; }
}

function isDirectImageLink(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const attachment = url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/assets/");
    return ["https:", "http:"].includes(url.protocol) && (attachment || IMAGE_EXTENSIONS.test(url.pathname));
  } catch {
    return false;
  }
}

export function imageDocument(html: string, t: Translate): Document {
  if (typeof DOMParser === "undefined") {
    return {
      body: { innerHTML: html },
      querySelectorAll: () => [],
    } as unknown as Document;
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (link.querySelector("img")) continue;
    const rawHref = link.getAttribute("href") || "";
    if (!rawHref.includes("://")) continue;
    try {
      const url = new URL(link.href);
      const attachment = url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/assets/");
      if (!["https:", "http:"].includes(url.protocol) || (!attachment && !IMAGE_EXTENSIONS.test(url.pathname))) continue;
      if (url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) url.searchParams.set("raw", "true");
      link.dataset.imageSrc = url.href;
      link.setAttribute("aria-haspopup", "dialog");
      const img = document.createElement("img");
      img.src = url.href;
      img.classList.add("direct-image-preview");
      img.alt = link.textContent || t("Bild");
      link.after(img);
    } catch { /* Ordinary links remain ordinary links. */ }
  }
  for (const img of document.querySelectorAll("img")) {
    img.classList.add("comment-thumbnail");
    img.setAttribute("role", "button");
    img.setAttribute("tabindex", "0");
    img.setAttribute("aria-haspopup", "dialog");
    img.setAttribute("aria-label", t("Öppna bild: {name}", { name: img.alt || t("Bild") }));
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    const clean = normalizeRepoPath(img.getAttribute("src"));
    const assetRef = parseReleaseAssetUrl(img.getAttribute("src"));
    if (clean) {
      img.dataset.repoPath = clean;
      img.dataset.rawSrc = img.getAttribute("src") || "";
      img.removeAttribute("src");
    } else if (assetRef) {
      img.dataset.releaseAssetUrl = assetRef.url;
      img.dataset.rawSrc = img.getAttribute("src") || "";
      img.removeAttribute("src");
    }
  }
  return document;
}

export function extractCommentImages(html: string, t: Translate): { cleanHtml: string; images: DetectedImage[] } {
  const images: DetectedImage[] = [];
  const seen = new Set<string>();

  function addImage(item: DetectedImage) {
    const id = item.path ? `path:${item.path}` : item.assetUrl ? `asset:${item.assetUrl}` : `src:${item.src}`;
    if (seen.has(id)) return;
    seen.add(id);
    images.push(item);
  }

  // 1. Code tags mentioning relative image paths (e.g. `docs/dancers/olaf.gif`)
  for (const match of html.matchAll(/<code\b[^>]*>(.*?)<\/code>/gi)) {
    const text = match[1]!.replace(/<[^>]+>/g, "").trim();
    const cleanPath = normalizeRepoPath(text);
    if (cleanPath) {
      addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: basename(cleanPath), path: cleanPath });
    }
  }

  // 2. Relative image links (e.g. [cutout](assets/dancer.png)), release assets, and direct image links
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi)) {
    const href = match[1]!;
    const text = match[2]!.replace(/<[^>]+>/g, "").trim();
    const cleanPath = normalizeRepoPath(href);
    const assetRef = parseReleaseAssetUrl(href);
    if (cleanPath) {
      addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: text || basename(cleanPath), path: cleanPath });
    } else if (assetRef) {
      addImage({ key: `asset:${assetRef.url}`, name: assetRef.assetName, alt: text || assetRef.assetName, assetUrl: assetRef.url, repository: assetRef.repository, isInline: true });
    } else if (isDirectImageLink(href)) {
      addImage({ key: `src:${href}`, name: basename(href), alt: text || basename(href), src: href, isInline: true });
    }
  }

  // 3. Plain text mentions of relative image paths and release asset URLs (outside of code/links)
  const stripped = html.replace(/<code\b[^>]*>.*?<\/code>/gi, "").replace(/<a\b[^>]*>.*?<\/a>/gi, "").replace(/<[^>]+>/g, " ");
  for (const match of stripped.matchAll(TEXT_IMAGE_PATH)) {
    const found = match[1];
    if (found) {
      const cleanPath = normalizeRepoPath(found);
      if (cleanPath) {
        addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: basename(cleanPath), path: cleanPath });
      }
    }
  }
  const RELEASE_ASSET_PATH = /https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/releases\/download\/[^\s)"']+\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)/gi;
  for (const match of stripped.matchAll(RELEASE_ASSET_PATH)) {
    const found = match[0];
    const assetRef = parseReleaseAssetUrl(found);
    if (assetRef) {
      addImage({ key: `asset:${assetRef.url}`, name: assetRef.assetName, alt: assetRef.assetName, assetUrl: assetRef.url, repository: assetRef.repository });
    }
  }

  // 4. Markdown images (e.g. ![alt](src))
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1]!;
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    const src = srcMatch ? srcMatch[1]! : "";
    if (src && !src.startsWith("data:")) {
      const alt = altMatch ? altMatch[1]! : basename(src);
      const cleanPath = normalizeRepoPath(src);
      const assetRef = parseReleaseAssetUrl(src);
      if (cleanPath) {
        addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: alt || basename(cleanPath), path: cleanPath });
      } else if (assetRef) {
        addImage({ key: `asset:${assetRef.url}`, name: assetRef.assetName, alt: alt || assetRef.assetName, assetUrl: assetRef.url, repository: assetRef.repository });
      } else {
        addImage({ key: `src:${src}`, name: basename(src), alt: alt || basename(src), src, isInline: true });
      }
    }
  }

  let cleanHtml = "";
  if (typeof DOMParser !== "undefined") {
    cleanHtml = imageDocument(html, t).body.innerHTML;
  } else {
    cleanHtml = html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
      let updated = match;
      if (!/class=["'][^"']*comment-thumbnail/i.test(attrs)) {
        updated = updated.replace(/<img\b/i, '<img class="comment-thumbnail" role="button" tabindex="0" aria-haspopup="dialog" loading="lazy" referrerpolicy="no-referrer"');
      }
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
      const clean = srcMatch ? normalizeRepoPath(srcMatch[1]!) : null;
      const assetRef = srcMatch ? parseReleaseAssetUrl(srcMatch[1]!) : null;
      if (clean) {
        updated = updated.replace(srcMatch![0], `data-repo-path="${clean}" data-raw-src="${srcMatch![1]!}"`);
      } else if (assetRef) {
        updated = updated.replace(srcMatch![0], `data-release-asset-url="${assetRef.url}" data-raw-src="${srcMatch![1]!}"`);
      }
      return updated;
    });
  }

  return { cleanHtml, images };
}
