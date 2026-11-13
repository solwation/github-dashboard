import type { ComputedRef, InjectionKey, Ref } from "vue";

type Translate = (key: string, params?: Record<string, string | number>) => string;
export type ImageSource = { key: string; html: string };
export const imageGalleryKey: InjectionKey<{ description: ComputedRef<string>; comments: Ref<ImageSource[]> }> = Symbol("issue image gallery");

export interface FileLoaderError {
  status?: number;
  permissionDenied?: boolean;
  repo?: string;
  isPrivate?: boolean;
}

export type FileLoaderResult = string | {
  url?: string | null;
  error?: FileLoaderError | null;
} | null;

export type FileLoader = (repository: string, path: string, ref?: string) => Promise<FileLoaderResult>;
export const fileLoaderKey: InjectionKey<FileLoader> = Symbol("repo file loader");

export function contentsPermissionErrorReason(error: FileLoaderError | undefined | null, t: Translate): string | undefined {
  if (!error?.repo) return undefined;
  if (error.status === 403 || (error.status === 404 && error.isPrivate)) {
    return t("tokenen saknar läsrätt till Contents i {repo}", { repo: error.repo });
  }
  return undefined;
}

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

type HtmlToken = { tag: boolean; value: string };

// markdown-it escapes `&`, `<`, `>` and `"` in text and attribute values, so a tag is exactly `<` up to
// the first `>` and text never contains a raw `<`.
function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let last = 0;
  for (const match of html.matchAll(/<[^>]*>/g)) {
    if (match.index! > last) tokens.push({ tag: false, value: html.slice(last, match.index) });
    tokens.push({ tag: true, value: match[0] });
    last = match.index! + match[0].length;
  }
  if (last < html.length) tokens.push({ tag: false, value: html.slice(last) });
  return tokens;
}

const ESCAPED_IMG_START = /&lt;img\b/i;
const ESCAPED_IMG_START_LENGTH = "&lt;img".length;

// Reads the escaped tag body from just after `&lt;img` up to its `&gt;`. Only text and the `<a>…</a>`
// that linkify wraps around a URL may occur in between; anything else leaves the text untouched.
function readEscapedImage(tokens: HtmlToken[], index: number, offset: number): { attrs: string; endIndex: number; endOffset: number } | null {
  let attrs = "";
  let inLink = false;
  for (let i = index; i < tokens.length; i++, offset = 0) {
    const token = tokens[i]!;
    if (token.tag) {
      if (!inLink && /^<a\s/i.test(token.value)) inLink = true;
      else if (inLink && /^<\/a\s*>$/i.test(token.value)) inLink = false;
      else return null;
      attrs += token.value;
      continue;
    }
    const end = token.value.indexOf("&gt;", offset);
    if (end < 0) {
      attrs += token.value.slice(offset);
      continue;
    }
    if (inLink) return null;
    return { attrs: attrs + token.value.slice(offset, end), endIndex: i, endOffset: end + "&gt;".length };
  }
  return null;
}

function attributeText(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapedImageReplacement(attrs: string): string | null {
  let src = "";
  const linkMatch = attrs.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (linkMatch) {
    src = linkMatch[1]!;
  } else {
    const srcAttr = attrs.match(/(?:src|data-src)=(?:&quot;|["'])(.*?)(?:&quot;|["'])/i);
    if (srcAttr) src = srcAttr[1]!;
  }
  src = src.trim();
  if (!src || !isDirectImageLink(src)) return null;

  let alt = "";
  const altAttr = attrs.match(/alt=(?:&quot;|["'])(.*?)(?:&quot;|["'])/i);
  if (altAttr) alt = altAttr[1]!;

  return `<img src="${attributeText(src)}" alt="${attributeText(alt)}">`;
}

/**
 * Turns escaped `<img>` source HTML in ordinary comment text into a real image. Only text outside
 * `code`/`pre` is considered and tags are never looked into, so attribute values (image alt, link
 * title) and code stay verbatim, and applying it again to its own output changes nothing.
 */
export function sanitizeEscapedHtmlImages(html: string): string {
  if (!html || !ESCAPED_IMG_START.test(html)) return html;
  const tokens = tokenizeHtml(html);
  const output: string[] = [];
  let codeDepth = 0;
  let index = 0;
  let offset = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.tag) {
      const codeTag = token.value.match(/^<(\/?)(?:code|pre)\b/i);
      if (codeTag) codeDepth = codeTag[1] ? Math.max(0, codeDepth - 1) : codeDepth + 1;
      output.push(token.value);
      index++;
      continue;
    }
    const rest = token.value.slice(offset);
    const start = codeDepth > 0 ? null : ESCAPED_IMG_START.exec(rest);
    if (!start) {
      output.push(rest);
      index++;
      offset = 0;
      continue;
    }
    output.push(rest.slice(0, start.index));
    const startOffset = offset + start.index;
    const candidate = readEscapedImage(tokens, index, startOffset + ESCAPED_IMG_START_LENGTH);
    const replacement = candidate && escapedImageReplacement(candidate.attrs);
    if (candidate && replacement) {
      output.push(replacement);
      index = candidate.endIndex;
      offset = candidate.endOffset;
    } else {
      output.push(token.value.slice(startOffset, startOffset + ESCAPED_IMG_START_LENGTH));
      offset = startOffset + ESCAPED_IMG_START_LENGTH;
    }
  }
  return output.join("");
}

/** An attribute as written in serialized HTML; `value` is the source text, entities not decoded. */
export interface HtmlAttribute { name: string; value: string }

const TAG_SPACE = /[\t\n\f\r ]/;

/**
 * Reads a start tag's attributes from `html` at `start` (just after the tag name) the way the HTML
 * tokenizer does: names end at whitespace, `/`, `>` or `=`, values are double-quoted, single-quoted or
 * unquoted, and a quoted value is read as a whole whatever `<`/`>` it contains. Returns the attributes
 * (names lower-cased) and the index just after the closing `>`, or `null` if the tag never closes.
 */
function readTagAttributes(html: string, start: number): { attributes: HtmlAttribute[]; end: number } | null {
  const attributes: HtmlAttribute[] = [];
  let i = start;
  while (i < html.length) {
    const char = html[i]!;
    if (TAG_SPACE.test(char) || char === "/") { i++; continue; }
    if (char === ">") return { attributes, end: i + 1 };
    const nameStart = i;
    i++; // A leading `=` belongs to the name.
    while (i < html.length && !TAG_SPACE.test(html[i]!) && !"/>=".includes(html[i]!)) i++;
    const name = html.slice(nameStart, i).toLowerCase();
    while (i < html.length && TAG_SPACE.test(html[i]!)) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < html.length && TAG_SPACE.test(html[i]!)) i++;
      const quote = html[i];
      if (quote === "\"" || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const valueStart = i;
        while (i < html.length && !TAG_SPACE.test(html[i]!) && html[i] !== ">") i++;
        value = html.slice(valueStart, i);
      }
    }
    attributes.push({ name, value });
  }
  return null;
}

/**
 * Calls `replace` for every real `<img>` start tag in serialized HTML and substitutes its result.
 * All markup is walked tag by tag with HTML tokenizer rules, so `<img` text inside any attribute value
 * (older browsers serialize raw `<`/`>` there) or inside a comment is never taken for a tag.
 */
export function replaceImageTags(html: string, replace: (attributes: HtmlAttribute[], tag: string) => string): string {
  let output = "";
  let last = 0;
  let i = html.indexOf("<");
  while (i >= 0 && i < html.length) {
    let end = i + 1;
    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i + 4);
      end = close < 0 ? html.length : close + 3;
    } else if (/^<\/?[a-z]/i.test(html.slice(i, i + 3))) {
      const nameStart = html[i + 1] === "/" ? i + 2 : i + 1;
      let nameEnd = nameStart;
      while (nameEnd < html.length && !TAG_SPACE.test(html[nameEnd]!) && !"/>".includes(html[nameEnd]!)) nameEnd++;
      const tag = readTagAttributes(html, nameEnd);
      if (!tag) break;
      end = tag.end;
      if (nameStart === i + 1 && html.slice(nameStart, nameEnd).toLowerCase() === "img") {
        output += html.slice(last, i) + replace(tag.attributes, html.slice(i, end));
        last = end;
      }
    } else if (/^<[!?]/.test(html.slice(i, i + 2)) || html.startsWith("</", i)) {
      const close = html.indexOf(">", i);
      end = close < 0 ? html.length : close + 1;
    }
    i = html.indexOf("<", end);
  }
  return output + html.slice(last);
}

/** Attribute values by lower-cased name; the first occurrence wins, as in the browser. */
export function htmlAttributeMap(attributes: HtmlAttribute[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { name, value } of attributes) if (!(name in map)) map[name] = value;
  return map;
}

/** Escapes plain text for a double-quoted attribute value. */
export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Rebuilds an `<img>` tag from parsed attributes with `changes` applied: a string is serialized
 * attribute text (as read from the source), a new attribute goes right after `src` (or first), `null` removes it.
 * Every value is written double-quoted, so no value can end early or turn into further attributes.
 */
export function serializeImageTag(attributes: HtmlAttribute[], changes: Record<string, string | null> = {}): string {
  const seen = new Set<string>();
  const added = Object.entries(changes)
    .filter(([name, value]) => value !== null && !attributes.some(attr => attr.name === name))
    .map(([name, value]) => ({ name, value: value! }));
  const srcIndex = attributes.findIndex(attr => attr.name === "src") + 1;
  const ordered = [...attributes.slice(0, srcIndex), ...added, ...attributes.slice(srcIndex)];
  const parts: string[] = [];
  for (const attr of ordered) {
    if (seen.has(attr.name)) continue;
    seen.add(attr.name);
    const value = attr.name in changes ? changes[attr.name] : attr.value;
    if (value === null || value === undefined) continue;
    parts.push(` ${attr.name}="${value.replace(/"/g, "&quot;")}"`);
  }
  return `<img${parts.join("")}>`;
}

export type ImagePlaceholder = (attributes: Record<string, string>, fallbackUrl?: string) => string;

/**
 * Applies loaded data URLs and failed loads to the comment's serialized HTML: loaded images get their
 * `src`, failed ones become `placeholder(...)`. Keys into `loaded`/`failed` are attribute source text.
 */
export function renderLoadedImages(html: string, loaded: Record<string, string>, failed: Record<string, boolean>, placeholder: ImagePlaceholder): string {
  return replaceImageTags(html, (attributes, tag) => {
    const attrs = htmlAttributeMap(attributes);
    const rawSrcKey = attrs["data-raw-src"] || undefined;
    const src = attrs.src || undefined;

    const cleanPath = attrs["data-repo-path"];
    if (cleanPath) {
      const key = (rawSrcKey && loaded[rawSrcKey]) ? rawSrcKey : cleanPath;
      if (loaded[key]) return serializeImageTag(attributes, { src: escapeHtmlAttribute(loaded[key]!) });
      if (failed[cleanPath] || (rawSrcKey && failed[rawSrcKey])) return placeholder(attrs, cleanPath);
      return tag;
    }

    if (!src) return tag;
    const isDirectPreview = (attrs.class || "").includes("direct-image-preview");
    if (loaded[src] || (rawSrcKey && loaded[rawSrcKey])) {
      const url = loaded[src] || loaded[rawSrcKey!]!;
      return serializeImageTag(attributes, { src: escapeHtmlAttribute(url), "data-raw-src": rawSrcKey || src });
    }
    if (!isDirectPreview && (failed[src] || (rawSrcKey && failed[rawSrcKey]))) {
      return placeholder(attrs, rawSrcKey || src);
    }
    if (src.startsWith("data:") || src.includes("://")) return tag;
    const relativePath = normalizeRepoPath(src);
    if (relativePath) {
      if (loaded[relativePath]) {
        return serializeImageTag(attributes, { src: escapeHtmlAttribute(loaded[relativePath]!), "data-repo-path": relativePath });
      }
      if (failed[relativePath]) return placeholder(attrs, relativePath);
    }
    return tag;
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
    const repoFileRef = parseGitHubRepoFileUrl(srcVal);
    if (clean) {
      img.dataset.repoPath = clean;
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
    const id = item.path ? `path:${item.path}` : `src:${item.src}`;
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

  // 2. Relative image links (e.g. [cutout](assets/dancer.png)) and direct image links, including release assets
  for (const match of preparedHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi)) {
    const href = match[1]!;
    const text = match[2]!.replace(/<[^>]+>/g, "").trim();
    const cleanPath = normalizeRepoPath(href);
    const repoFileRef = parseGitHubRepoFileUrl(href);
    if (cleanPath) {
      addImage({ key: `path:${cleanPath}`, name: basename(cleanPath), alt: text || basename(cleanPath), path: cleanPath });
    } else if (repoFileRef) {
      addImage({ key: `repo:${repoFileRef.url}`, name: basename(repoFileRef.path), alt: text || basename(repoFileRef.path), src: href, path: repoFileRef.path, repository: repoFileRef.repository, ref: repoFileRef.ref, isInline: true });
    } else if (isDirectImageLink(href)) {
      addImage({ key: `src:${href}`, name: basename(href), alt: text || basename(href), src: href, isInline: true });
    }
  }

  // 3. Plain text mentions of relative image paths and release asset URLs (outside of code/links).
  // Release assets load directly in the browser from their download URL (#458).
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
      addImage({ key: `src:${assetRef.url}`, name: assetRef.assetName, alt: assetRef.assetName, src: assetRef.url });
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
        // Shown in the carousel too; the browser loads it directly, without API or token (#458).
        addImage({ key: `src:${src}`, name: assetRef.assetName, alt: alt || assetRef.assetName, src });
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
      const repoFileRef = srcMatch ? parseGitHubRepoFileUrl(srcMatch[1]!) : null;
      if (clean) {
        updated = updated.replace(srcMatch![0], `data-repo-path="${clean}" data-raw-src="${srcMatch![1]!}"`);
      } else if (repoFileRef) {
        updated = updated.replace(srcMatch![0], `data-repo-path="${repoFileRef.path}" data-repository="${repoFileRef.repository}" data-ref="${repoFileRef.ref}" data-raw-src="${srcMatch![1]!}" src="${srcMatch![1]!}"`);
      }
      return updated;
    });
  }

  return { cleanHtml, images };
}
