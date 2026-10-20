import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown";
describe("safe issue Markdown", () => {
  it("loads GitHub blob images as raw files while preserving ordinary links", () => {
    const url = "https://github.com/sample/project/blob/main/docs/report.jpg";
    expect(renderMarkdown(`![Report](${url})`)).toContain(`src="${url}?raw=true"`);
    expect(renderMarkdown(`[Report](${url})`)).toContain(`href="${url}"`);
    expect(renderMarkdown("![Report](https://github.com/sample/project/blob/feature/report/docs/image%20one.jpg?raw=false&other=1#preview)"))
      .toContain('src="https://github.com/sample/project/blob/feature/report/docs/image%20one.jpg?raw=true&amp;other=1#preview"');
  });
  it("preserves other image URLs and escaped alt text", () => {
    for (const url of [
      "https://example.com/sample/project/blob/main/report.jpg",
      "https://github.com.example.com/sample/project/blob/main/report.jpg",
      "https://github.com/user-attachments/assets/example",
      "https://raw.githubusercontent.com/sample/project/main/report.jpg",
      "./report.jpg",
    ]) expect(renderMarkdown(`![Report](${url})`)).toContain(`src="${url}"`);
    expect(renderMarkdown('![<script>](https://github.com/sample/project/blob/main/report.jpg)'))
      .toContain('alt="&lt;script&gt;"');
  });
  it("marks standalone and linked image paragraphs while keeping inline images with their text", () => {
    const image = "![Diagram](https://example.com/diagram.png)";
    expect(renderMarkdown(image)).toContain('<p class="markdown-image-block"><img');
    const linked = renderMarkdown(`[${image}](https://example.com/full)`);
    expect(linked).toContain('<p class="markdown-image-block"><a href="https://example.com/full"');
    expect(linked).toContain('alt="Diagram"');
    for (const text of [`Before ${image}`, `${image} after`, `${image}\ncontext`, `\`${image}\``, `\`\`\`\n${image}\n\`\`\``]) {
      expect(renderMarkdown(text)).not.toContain('class="markdown-image-block"');
    }
    const ordered = renderMarkdown(`First paragraph\n\n${image}\n\nLast paragraph`);
    expect(ordered.indexOf("First paragraph")).toBeLessThan(ordered.indexOf('class="markdown-image-block"'));
    expect(ordered.indexOf('class="markdown-image-block"')).toBeLessThan(ordered.indexOf("Last paragraph"));
  });
  it("renders headings, emphasis, lists, fenced code and read-only task checkboxes", () => {
    const html = renderMarkdown("## Plan\n\n**Read me**\n\n- [x] Complete\n- [ ] Next\n\n```js\nconst text = '<script>';\n```\n");
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain("<strong>Read me</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain('type="checkbox" disabled checked');
    expect(html).toContain('type="checkbox" disabled aria-label=');
    expect(html).toContain('<code class="language-js">');
    expect(html).toContain("&lt;script&gt;");
  });
  it("escapes source HTML including event handlers and scripts", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });
  it("rejects executable link protocols and untrusted image SVG data", () => {
    for (const text of ["[click](javascript:alert(1))", "[click](vbscript:alert(1))", "[click](data:text/html,attack)", "![image](data:image/svg+xml;base64,PHN2Zz4=)"]) {
      const html = renderMarkdown(text);
      expect(html).not.toMatch(/(?:href|src)="(?:javascript|vbscript|data):/i);
    }
  });
  it("escapes link attributes and opens safe links with isolation", () => {
    const html = renderMarkdown('[GitHub](https://github.com "quoted & safe")');
    expect(html).toContain('href="https://github.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('title="quoted &amp; safe"');
    expect(renderMarkdown('[bad](https://example.com/"onclick="alert(1))')).not.toContain(' onclick=');
  });
  it("handles missing descriptions and never transforms task-like text outside lists", () => {
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
    expect(renderMarkdown("[x] Not a list")).not.toContain('<input');
    expect(renderMarkdown("- [x] <script>attack</script>")).not.toContain('<script>');
  });
});
