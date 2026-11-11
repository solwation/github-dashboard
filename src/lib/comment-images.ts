import type { ComputedRef, InjectionKey, Ref } from "vue";

type Translate = (key: string, params?: Record<string, string | number>) => string;
export type ImageSource = { key: string; html: string };
export const imageGalleryKey: InjectionKey<{ description: ComputedRef<string>; comments: Ref<ImageSource[]> }> = Symbol("issue image gallery");

export type FileLoader = (repository: string, path: string, ref?: string) => Promise<string | null>;
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
  ref?: string;
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

export interface GitHubRepoFileRef {
  owner: string;
  repo: string;
  repository: string;
  ref: string;
  path: string;
  url: string;
}

export function parseGitHubRepoFileUrl(urlStr: string | null | undefined): GitHubRepoFileRef | null {
  if (!urlStr) return null;
  const clean = urlStr.trim();
  try {
    const url = new URL(clean);
    let owner = "", repo = "", ref = "", path = "";
    if (url.hostname === "raw.githubusercontent.com") {
      const parts = url.pathname.replace(/^\/+/, "").split("/");
      if (parts.length < 4) return null;
      owner = parts[0]!;
      repo = parts[1]!;
      ref = parts[2]!;
      path = parts.slice(3).join("/");
    } else if (url.hostname === "github.com") {
      const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/);
      if (!match) return null;
      owner = match[1]!;
      repo = match[2]!;
      ref = decodeURIComponent(match[3]!);
      path = decodeURIComponent(match[4]!);
    } else {
      return null;
    }
    const cleanPath = normalizeRepoPath(path);
    if (!cleanPath || !IMAGE_EXTENSIONS.test(cleanPath)) return null;
    return {
      owner,
      repo,
      repository: `${owner}/${repo}`,
      ref,
      path: cleanPath,
      url: `${url.origin}${url.pathname}`,
    };
  } catch {
    return null;
  }
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

export function isDirectImageLink(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const attachment = url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/assets/");
    return ["https:", "http:"].includes(url.protocol) && (attachment || IMAGE_EXTENSIONS.test(url.pathname));
  } catch {
    return Boolean(normalizeRepoPath(urlStr));
  }
}

export function sanitizeEscapedHtmlImages(html: string): string {
  if (!html || !html.includes("&lt;img")) return html;
  return html.replace(/&lt;img\b((?:(?!&gt;)[\s\S])*?)&gt;/gi, (fullMatch, attrs) => {
    let src = "";
    const linkMatch = attrs.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    if (linkMatch) {
      src = linkMatch[1]!;
    } else {
      const srcAttr = attrs.match(/(?:src|data-src)=(?:&quot;|["'])(.*?)(?:&quot;|["'])/i);
      if (srcAttr) src = srcAttr[1]!;
    }
    src = src.trim();
    if (!src || !isDirectImageLink(src)) {
      return fullMatch;
    }

    let alt = "";
    const altAttr = attrs.match(/alt=(?:&quot;|["'])(.*?)(?:&quot;|["'])/i);
    if (altAttr) alt = altAttr[1]!;

    return `<img src="${src}" alt="${alt}">`;
  });
}

export function imageDocument(html: string, t: Translate): Document {
  const prepared = sanitizeEscapedHtmlImages(html);
  if (typeof DOMParser === "undefined") {
    return {
      body: { innerHTML: prepared },
      querySelectorAll: () => [],
    } as unknown as Document;
  }
  const document = new DOMParser().parseFromString(prepared, "text/html");
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
    const srcVal = img.getAttribute("src");
    const clean = normalizeRepoPath(srcVal);
    const assetRef = parseReleaseAssetUrl(srcVal);
    const repoFileRef = parseGitHubRepoFileUrl(srcVal);
    if (clean) {
      img.dataset.repoPath = clean;
      img.dataset.rawSrc = srcVal || "";
      img.removeAttribute("src");
    } else if (assetRef) {
      img.dataset.releaseAssetUrl = assetRef.url;
      img.dataset.rawSrc = srcVal || "";
      img.removeAttribute("src");
    } else if (repoFileRef) {
      img.dataset.repoPath = repoFileRef.path;
      img.dataset.repository = repoFileRef.repository;
      img.dataset.ref = repoFileRef.ref;
      img.dataset.rawSrc = srcVal || "";
    }
  }
  return document;
}

export function extractCommentImages(html: string, t: Translate): { cleanHtml: string; images: DetectedImage[] } {
  const preparedHtml = sanitizeEscapedHtmlImages(html);
  const images: DetectedImage[] = [];
  const seen = new Set<string>();

  function addImage(item: DetectedImage) {
    const id = item.path ? `path:${item.path}` : item.assetUrl ? `asset:${item.assetUrl}` : `src:${item.src}`;
    if (seen.has(id)) return;
    seen.add(id);
    images.push(item);
  }

  // 1. Code tags mentioning relative image paths (e.g. `docs/dancers/olaf.gif`)
  for (const match of preparedHtml.matchAll(/<code\b[^>]*>(.*?)<\/code>/gi)) {
    const text = match[1]!.replace(/<[^>]+>/g, "").trim();
    const cleanPath = normalizeRepoPath(text);
    if (cleanPath) {
      addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: basename(cleanPath), path: cleanPath });
    }
  }

  // 2. Relative image links (e.g. [cutout](assets/dancer.png)), release assets, and direct image links
  for (const match of preparedHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi)) {
    const href = match[1]!;
    const text = match[2]!.replace(/<[^>]+>/g, "").trim();
    const cleanPath = normalizeRepoPath(href);
    const assetRef = parseReleaseAssetUrl(href);
    const repoFileRef = parseGitHubRepoFileUrl(href);
    if (cleanPath) {
      addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: text || basename(cleanPath), path: cleanPath });
    } else if (assetRef) {
      addImage({ key: `asset:${assetRef.url}`, name: assetRef.assetName, alt: text || assetRef.assetName, assetUrl: assetRef.url, repository: assetRef.repository, isInline: true });
    } else if (repoFileRef) {
      addImage({ key: `repo:${repoFileRef.url}`, name: basename(repoFileRef.path), alt: text || basename(repoFileRef.path), src: href, path: repoFileRef.path, repository: repoFileRef.repository, ref: repoFileRef.ref, isInline: true });
    } else if (isDirectImageLink(href)) {
      addImage({ key: `src:${href}`, name: basename(href), alt: text || basename(href), src: href, isInline: true });
    }
  }

  // 3. Plain text mentions of relative image paths and release asset URLs (outside of code/links)
  const stripped = preparedHtml.replace(/<code\b[^>]*>.*?<\/code>/gi, "").replace(/<a\b[^>]*>.*?<\/a>/gi, "").replace(/<[^>]+>/g, " ");
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
  for (const match of preparedHtml.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1]!;
    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    const src = srcMatch ? srcMatch[1]! : "";
    if (src && !src.startsWith("data:")) {
      const alt = altMatch ? altMatch[1]! : basename(src);
      const cleanPath = normalizeRepoPath(src);
      const assetRef = parseReleaseAssetUrl(src);
      const repoFileRef = parseGitHubRepoFileUrl(src);
      if (cleanPath) {
        addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: alt || basename(cleanPath), path: cleanPath });
      } else if (assetRef) {
        addImage({ key: `asset:${assetRef.url}`, name: assetRef.assetName, alt: alt || assetRef.assetName, assetUrl: assetRef.url, repository: assetRef.repository });
      } else if (repoFileRef) {
        addImage({ key: `repo:${repoFileRef.url}`, name: basename(repoFileRef.path), alt: alt || basename(repoFileRef.path), src, path: repoFileRef.path, repository: repoFileRef.repository, ref: repoFileRef.ref });
      } else {
        addImage({ key: `src:${src}`, name: basename(src), alt: alt || basename(src), src, isInline: true });
      }
    }
  }

  let cleanHtml = "";
  if (typeof DOMParser !== "undefined") {
    cleanHtml = imageDocument(preparedHtml, t).body.innerHTML;
  } else {
    cleanHtml = preparedHtml.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
      let updated = match;
      if (!/class=["'][^"']*comment-thumbnail/i.test(attrs)) {
        updated = updated.replace(/<img\b/i, '<img class="comment-thumbnail" role="button" tabindex="0" aria-haspopup="dialog" loading="lazy" referrerpolicy="no-referrer"');
      }
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
      const clean = srcMatch ? normalizeRepoPath(srcMatch[1]!) : null;
      const assetRef = srcMatch ? parseReleaseAssetUrl(srcMatch[1]!) : null;
      const repoFileRef = srcMatch ? parseGitHubRepoFileUrl(srcMatch[1]!) : null;
      if (clean) {
        updated = updated.replace(srcMatch![0], `data-repo-path="${clean}" data-raw-src="${srcMatch![1]!}"`);
      } else if (assetRef) {
        updated = updated.replace(srcMatch![0], `data-release-asset-url="${assetRef.url}" data-raw-src="${srcMatch![1]!}"`);
      } else if (repoFileRef) {
        updated = updated.replace(srcMatch![0], `data-repo-path="${repoFileRef.path}" data-repository="${repoFileRef.repository}" data-ref="${repoFileRef.ref}" data-raw-src="${srcMatch![1]!}" src="${srcMatch![1]!}"`);
      }
      return updated;
    });
  }

  return { cleanHtml, images };
}
