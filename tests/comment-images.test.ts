import { describe, expect, it } from "vitest";
import { extractCommentImages, issueRepository } from "../src/lib/comment-images";
import { t } from "../src/lib/i18n";
import { renderMarkdown } from "../src/lib/markdown";

describe("comment image detection and carousel extraction (#442)", () => {
  it("extracts issue repository from issue html_url", () => {
    expect(issueRepository({ html_url: "https://github.com/solwation/solwation-on-twitch/issues/156" }))
      .toBe("solwation/solwation-on-twitch");
    expect(issueRepository({ html_url: "https://github.com/owner/my-repo/issues/1" }))
      .toBe("owner/my-repo");
    expect(issueRepository(null)).toBeUndefined();
    expect(issueRepository({})).toBeUndefined();
  });

  it("extracts relative image file paths mentioned in code spans and text without breaking text", () => {
    const rawMarkdown = [
      "Slutfört med realistiska danskaraktärer:",
      "- Konverterade till transparenta RGBA PNG-cutouts (`assets/wardogs-dancer.png`, `assets/bf6-dancer.png`).",
      "- Uppdaterade renderingsmotor i `assets/dancer.js`.",
      "- Genererade om alla GIF:ar:",
      "  - `docs/dancers/olaf.gif` (218 KB)",
      "  - `docs/dancers/wardogs.gif` (386 KB)",
      "Alla 311 tester i `scripts/test.cjs` passerar.",
    ].join("\n");

    const html = renderMarkdown(rawMarkdown);
    const { cleanHtml, images } = extractCommentImages(html, t);

    // List items and text flow are kept clean
    expect(cleanHtml).toContain("<code>assets/wardogs-dancer.png</code>");
    expect(cleanHtml).toContain("<code>docs/dancers/olaf.gif</code>");
    expect(cleanHtml).not.toContain("<img"); // No breaking inline images inserted inside lists

    // Only actual image files are extracted
    expect(images.map(img => img.path)).toEqual([
      "assets/wardogs-dancer.png",
      "assets/bf6-dancer.png",
      "docs/dancers/olaf.gif",
      "docs/dancers/wardogs.gif",
    ]);

    // Non-image files like dancer.js and test.cjs are not extracted as images
    expect(images.some(img => img.name.includes("dancer.js"))).toBe(false);
    expect(images.some(img => img.name.includes("test.cjs"))).toBe(false);

    // Names and alts are properly set
    expect(images[0]).toMatchObject({
      name: "wardogs-dancer.png",
      alt: "wardogs-dancer.png",
      path: "assets/wardogs-dancer.png",
      key: "path:assets/wardogs-dancer.png",
    });
  });

  it("extracts direct image links and user attachments into image items", () => {
    const rawMarkdown = [
      "[Screenshot](https://images.example/preview.png)",
      "https://github.com/user-attachments/assets/fictional-asset",
      "[Ordinary page](https://example.com/docs)",
    ].join("\n\n");

    const html = renderMarkdown(rawMarkdown);
    const { cleanHtml, images } = extractCommentImages(html, t);

    expect(images).toHaveLength(2);
    expect(images[0]!.src).toBe("https://images.example/preview.png");
    expect(images[0]!.name).toBe("preview.png");
    expect(images[1]!.src).toBe("https://github.com/user-attachments/assets/fictional-asset");

    // The links in cleanHtml remain clickable without breaking inline images
    expect(cleanHtml).toContain('href="https://images.example/preview.png"');
    expect(cleanHtml).toContain('href="https://example.com/docs"');
  });

  it("preserves explicit Markdown image tags and marks them as inline", () => {
    const rawMarkdown = "![Architectural diagram](https://example.com/arch.svg)";
    const html = renderMarkdown(rawMarkdown);
    const { cleanHtml, images } = extractCommentImages(html, t);

    expect(cleanHtml).toContain('class="comment-thumbnail"');
    expect(cleanHtml).toContain('role="button"');
    expect(cleanHtml).toContain('src="https://example.com/arch.svg"');
    expect(images).toHaveLength(1);
    expect(images[0]!.src).toBe("https://example.com/arch.svg");
    expect(images[0]!.alt).toBe("Architectural diagram");
    expect(images[0]!.isInline).toBe(true);
  });

  it("deduplicates repeated mentions of the same image path", () => {
    const rawMarkdown = "`assets/icon.png` is mentioned here, and `assets/icon.png` again.";
    const html = renderMarkdown(rawMarkdown);
    const { images } = extractCommentImages(html, t);

    expect(images).toHaveLength(1);
    expect(images[0]!.path).toBe("assets/icon.png");
  });
});
