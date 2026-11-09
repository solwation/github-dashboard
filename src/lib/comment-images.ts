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
  isInline?: boolean;
}

export const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const RELATIVE_IMAGE_PATH = /^(?:(?:\.?\/)?[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const TEXT_IMAGE_PATH = /(?:^|[\s(`"'])((?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico))(?=[\s)`"',:;]|$)/gi;

function basename(pathOrUrl: string): string {
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
  }
  return document;
}

export function extractCommentImages(html: string, t: Translate): { cleanHtml: string; images: DetectedImage[] } {
  const images: DetectedImage[] = [];
  const seen = new Set<string>();

  function addImage(item: DetectedImage) {
    const id = item.path ? `path:${item.path}` : `src:${item.src}`;
    if (seen.has(id)) return;
    seen.add(id);
    images.push(item);
  }

  // 1. Code tags mentioning relative image paths (e.g. `docs/dancers/olaf.gif`)
  for (const match of html.matchAll(/<code\b[^>]*>(.*?)<\/code>/gi)) {
    const text = match[1]!.replace(/<[^>]+>/g, "").trim();
    if (RELATIVE_IMAGE_PATH.test(text) && !text.includes("://")) {
      const cleanPath = text.replace(/^\.?\/+/, "").replace(/[?#].*$/, "");
      addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: basename(cleanPath), path: cleanPath });
    }
  }

  // 2. Relative image links (e.g. [cutout](assets/dancer.png)) and direct image links
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi)) {
    const href = match[1]!;
    const text = match[2]!.replace(/<[^>]+>/g, "").trim();
    if (RELATIVE_IMAGE_PATH.test(href) && !href.includes("://")) {
      const cleanPath = href.replace(/^\.?\/+/, "").replace(/[?#].*$/, "");
      addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: text || basename(cleanPath), path: cleanPath });
    } else if (isDirectImageLink(href)) {
      addImage({ key: `src:${href}`, name: basename(href), alt: text || basename(href), src: href, isInline: true });
    }
  }

  // 3. Plain text mentions of relative image paths (outside of code/links)
  const stripped = html.replace(/<code\b[^>]*>.*?<\/code>/gi, "").replace(/<a\b[^>]*>.*?<\/a>/gi, "").replace(/<[^>]+>/g, " ");
  for (const match of stripped.matchAll(TEXT_IMAGE_PATH)) {
    const found = match[1];
    if (found && !found.includes("://")) {
      const cleanPath = found.replace(/^\.?\/+/, "").replace(/[?#].*$/, "");
      addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: basename(cleanPath), path: cleanPath });
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
      addImage({ key: `src:${src}`, name: basename(src), alt: alt || basename(src), src, isInline: true });
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
      return updated;
    });
  }

  return { cleanHtml, images };
}
