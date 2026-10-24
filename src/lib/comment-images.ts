import type { ComputedRef, InjectionKey, Ref } from "vue";

type Translate = (key: string, params?: Record<string, string | number>) => string;
export type ImageSource = { key: string; html: string };
export const imageGalleryKey: InjectionKey<{ description: ComputedRef<string>; comments: Ref<ImageSource[]> }> = Symbol("issue image gallery");

export function imageDocument(html: string, t: Translate) {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (link.querySelector("img")) continue;
    try {
      const url = new URL(link.href);
      const attachment = url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/assets/");
      if (!["https:", "http:"].includes(url.protocol) || (!attachment && !/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(url.pathname))) continue;
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
