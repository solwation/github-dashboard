import MarkdownIt from "markdown-it";
import { t } from "./i18n";

// Only Markdown produces HTML: source HTML is always escaped, including inside code fences.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
// Recognize comments without enabling source HTML. Code rules still own code spans/fences.
markdown.inline.ruler.before("html_inline", "hidden_comment", (state) => {
  if (!state.src.startsWith("<!--", state.pos)) return false;
  const end = state.src.indexOf("-->", state.pos + 4);
  if (end < 0) return false;
  state.pos = end + 3;
  return true;
});
markdown.block.ruler.before("html_block", "hidden_comment", (state, start, end, silent) => {
  const offset = state.bMarks[start]! + state.tShift[start]!;
  if (state.sCount[start]! - state.blkIndent >= 4 || !state.src.startsWith("<!--", offset)) return false;
  if (silent) return true;
  let line = start;
  let close = -1;
  for (; line < end; line++) {
    const begin = line === start ? offset + 4 : state.bMarks[line]!;
    const found = state.src.slice(begin, state.eMarks[line]!).indexOf("-->");
    if (found >= 0) { close = begin + found; break; }
  }
  if (line < end) {
    const tail = state.src.slice(close + 3, state.eMarks[line]!).trim();
    if (tail) {
      state.push("paragraph_open", "p", 1);
      const token = state.push("inline", "", 0);
      token.content = tail;
      token.children = [];
      state.push("paragraph_close", "p", -1);
    }
  }
  state.line = Math.min(line + 1, end);
  return true;
}, { alt: ["paragraph", "reference", "blockquote"] });
const defaultImage = markdown.renderer.rules.image!;
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]!;
  const source = token.attrGet("src");
  if (typeof source === "string" && source) {
    try {
      const url = new URL(source);
      if (url.protocol === "https:" && url.hostname === "github.com" &&
          !url.username && !url.password && !url.port &&
          /^\/[^/]+\/[^/]+\/blob\/.+\/.+/.test(url.pathname)) {
        // GitHub resolves the ref (including branch names with slashes) before redirecting.
        url.searchParams.set("raw", "true");
        token.attrSet("src", url.href);
      }
    } catch { /* Relative image URLs keep their existing Markdown behavior. */ }
  }
  return defaultImage(tokens, index, options, env, self);
};
const defaultLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]!.attrSet("target", "_blank");
  tokens[index]!.attrSet("rel", "noopener noreferrer");
  return defaultLink ? defaultLink(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
};
// Mark standalone image paragraphs without moving them or treating inline illustrations as a separate block.
markdown.core.ruler.after("inline", "image_paragraphs", (state) => {
  for (let index = 1; index < state.tokens.length; index++) {
    const token = state.tokens[index]!;
    const paragraph = state.tokens[index - 1]!;
    if (token.type !== "inline" || paragraph.type !== "paragraph_open") continue;
    const children = (token.children ?? []).filter(child => child.type !== "text" || child.content.trim());
    const image = children.length === 1 && children[0]!.type === "image";
    const linkedImage = children.length === 3 && children[0]!.type === "link_open" &&
      children[1]!.type === "image" && children[2]!.type === "link_close";
    if (image || linkedImage) paragraph.attrJoin("class", "markdown-image-block");
  }
});
markdown.core.ruler.after("inline", "readonly_task_lists", (state) => {
  for (let index = 2; index < state.tokens.length; index++) {
    const token = state.tokens[index]!;
    if (token.type !== "inline" || state.tokens[index - 1]?.type !== "paragraph_open" ||
        state.tokens[index - 2]?.type !== "list_item_open") continue;
    const first = token.children?.[0];
    if (!first || first.type !== "text") continue;
    const task = first.content.match(/^\[([ xX])\]\s+/);
    if (!task) continue;
    const checked = task[1]!.toLowerCase() === "x";
    first.content = first.content.slice(task[0].length);
    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = `<input type="checkbox" disabled${checked ? " checked" : ""} aria-label="${markdown.utils.escapeHtml(t(checked ? "Slutförd uppgift" : "Ej slutförd uppgift"))}"> `;
    token.children!.unshift(checkbox);
  }
});

export function renderMarkdown(source: string | null | undefined): string {
  return markdown.render(source ?? "");
}
