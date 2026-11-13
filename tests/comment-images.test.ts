import { describe, expect, it } from "vitest";
import {
  contentsPermissionErrorReason,
  extractCommentImages,
  issueRepository,
  normalizeRepoPath,
  parseGitHubRepoFileUrl,
  parseReleaseAssetUrl,
  renderLoadedImages,
  replaceImageTags,
  sanitizeEscapedHtmlImages,
} from "../src/lib/comment-images";
import { setLanguage, t } from "../src/lib/i18n";
import { renderMarkdown } from "../src/lib/markdown";

// Attribute names per element, reading quoted values as markdown-it serializes them.
function attributeNames(html: string, tag: string): string[][] {
  return [...html.matchAll(new RegExp(`<${tag}((?:\\s+[\\w-]+="[^"]*")*)\\s*\\/?>`, "g"))]
    .map(match => [...match[1]!.matchAll(/([\w-]+)="/g)].map(attr => attr[1]!));
}

describe("comment image detection and carousel extraction (#442)", () => {
  it("extracts issue repository from issue html_url", () => {
    expect(issueRepository({ html_url: "https://github.com/example-org/sample-project/issues/7" }))
      .toBe("example-org/sample-project");
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

  it("normalizes relative repository image paths (#443)", () => {
    expect(normalizeRepoPath("assets/dancer.png")).toBe("assets/dancer.png");
    expect(normalizeRepoPath("./assets/dancer.png")).toBe("assets/dancer.png");
    expect(normalizeRepoPath("../assets/dancer.png")).toBe("assets/dancer.png");
    expect(normalizeRepoPath("../../assets/dancer.png")).toBe("assets/dancer.png");
    expect(normalizeRepoPath("/assets/dancer.png")).toBe("assets/dancer.png");
    expect(normalizeRepoPath("docs/sub/../dancer.png")).toBe("docs/dancer.png");
    expect(normalizeRepoPath("docs/./dancer.png")).toBe("docs/dancer.png");
    expect(normalizeRepoPath("dancer.png")).toBe("dancer.png");
    expect(normalizeRepoPath("./dancer.png")).toBe("dancer.png");
    expect(normalizeRepoPath("assets/dancer.png?raw=true#heading")).toBe("assets/dancer.png");
    expect(normalizeRepoPath("https://example.com/foo.png")).toBeNull();
    expect(normalizeRepoPath("data:image/png;base64,...")).toBeNull();
    expect(normalizeRepoPath("assets/dancer.js")).toBeNull();
    expect(normalizeRepoPath("")).toBeNull();
    expect(normalizeRepoPath(null)).toBeNull();
  });

  it("recognizes Markdown image syntax with relative paths and includes them in carousel (#443)", () => {
    const rawMarkdown = [
      "![Wardogs dancer](assets/wardogs-dancer.png)",
      "![Relative cutout](./assets/bf6-dancer.png)",
      "![Parent reference](../docs/dancers/olaf.gif)",
      "![Root reference](/docs/dancers/wardogs.gif)",
      "[Link to dancer](./assets/dancer-link.png)",
      "Text mentions ./assets/text-image.png and ../docs/text-image2.png as well.",
    ].join("\n\n");

    const html = renderMarkdown(rawMarkdown);
    const { images } = extractCommentImages(html, t);

    const paths = images.map(i => i.path);
    expect(paths).toContain("assets/wardogs-dancer.png");
    expect(paths).toContain("assets/bf6-dancer.png");
    expect(paths).toContain("docs/dancers/olaf.gif");
    expect(paths).toContain("docs/dancers/wardogs.gif");
    expect(paths).toContain("assets/dancer-link.png");
    expect(paths).toContain("assets/text-image.png");
    expect(paths).toContain("docs/text-image2.png");

    // Markdown relative images must not be flagged as inline (so they appear in the carousel)
    const wardogImg = images.find(i => i.path === "assets/wardogs-dancer.png");
    expect(wardogImg).toBeDefined();
    expect(wardogImg?.isInline).toBeFalsy();
    expect(wardogImg?.alt).toBe("Wardogs dancer");
    expect(wardogImg?.name).toBe("wardogs-dancer.png");
  });

  it("parses release asset download URLs correctly (#448)", () => {
    const parsed = parseReleaseAssetUrl("https://github.com/example-org/private-app/releases/download/untagged-0123456789abcdef0123/issue-42-before-1280-2026-11-11.png");
    expect(parsed).toEqual({
      owner: "example-org",
      repo: "private-app",
      repository: "example-org/private-app",
      tag: "untagged-0123456789abcdef0123",
      assetName: "issue-42-before-1280-2026-11-11.png",
      url: "https://github.com/example-org/private-app/releases/download/untagged-0123456789abcdef0123/issue-42-before-1280-2026-11-11.png",
    });

    const parsedWithQuery = parseReleaseAssetUrl("https://github.com/owner/repo/releases/download/v1.0.0/screenshot.jpg?raw=true#fragment");
    expect(parsedWithQuery).toEqual({
      owner: "owner",
      repo: "repo",
      repository: "owner/repo",
      tag: "v1.0.0",
      assetName: "screenshot.jpg",
      url: "https://github.com/owner/repo/releases/download/v1.0.0/screenshot.jpg",
    });

    expect(parseReleaseAssetUrl("https://github.com/owner/repo/releases/download/v1.0.0/archive.zip")).toBeNull();
    expect(parseReleaseAssetUrl("https://other.com/owner/repo/releases/download/v1/pic.png")).toBeNull();
    expect(parseReleaseAssetUrl("https://github.com/owner/repo/issues/123")).toBeNull();
    expect(parseReleaseAssetUrl("")).toBeNull();
    expect(parseReleaseAssetUrl(null)).toBeNull();
  });

  it("keeps the direct download URL for release asset images so the browser loads them (#448, #458)", () => {
    const before = "https://github.com/example-org/private-app/releases/download/untagged-0123456789abcdef0123/issue-42-before-1280-2026-11-11.png";
    const after = "https://github.com/example-org/private-app/releases/download/untagged-0123456789abcdef0123/issue-42-after-1280-2026-11-11.png";
    const link = "https://github.com/owner/repo/releases/download/v1/linked.png";
    const rawMarkdown = [
      "Before, 1280:",
      `![before](${before})`,
      "After, 1280:",
      `![after](${after})`,
      `Linked: [shot](${link})`,
    ].join("\n");

    const html = renderMarkdown(rawMarkdown);
    const { cleanHtml, images } = extractCommentImages(html, t);

    // Markdown images stay in the carousel, with their real download URL as source; links stay inline.
    expect(images).toHaveLength(3);
    expect(images.find(i => i.alt === "before")).toMatchObject({ key: `src:${before}`, name: "issue-42-before-1280-2026-11-11.png", src: before });
    expect(images.find(i => i.alt === "before")?.isInline).toBeFalsy();
    expect(images.find(i => i.alt === "after")).toMatchObject({ key: `src:${after}`, src: after });
    expect(images.find(i => i.src === link)).toMatchObject({ key: `src:${link}`, alt: "shot", isInline: true });

    // The rendered HTML keeps the src (no API loading path), so a public asset loads like any https image.
    expect(cleanHtml).toContain(`src="${before}"`);
    expect(cleanHtml).toContain(`src="${after}"`);
    expect(cleanHtml).not.toContain("data-release-asset-url");
  });

  it("detects plain-text release asset mentions as carousel images with their download URL (#458)", () => {
    const url = "https://github.com/owner/repo/releases/download/v1/plain.png";
    const { images } = extractCommentImages(`<p>See ${url} for details</p>`, t);
    expect(images).toEqual([{ key: `src:${url}`, name: "plain.png", alt: "plain.png", src: url }]);
  });

  it("parses GitHub repo file and raw URLs correctly (#450)", () => {
    const rawUrl = parseGitHubRepoFileUrl("https://raw.githubusercontent.com/solwation/lunden-3d-apartment/c6b23ea02a7b8e57929ce6bf3f090bb7090aa0b9/docs/verification/1898/car-glb-production.png");
    expect(rawUrl).toEqual({
      owner: "solwation",
      repo: "lunden-3d-apartment",
      repository: "solwation/lunden-3d-apartment",
      ref: "c6b23ea02a7b8e57929ce6bf3f090bb7090aa0b9",
      path: "docs/verification/1898/car-glb-production.png",
      url: "https://raw.githubusercontent.com/solwation/lunden-3d-apartment/c6b23ea02a7b8e57929ce6bf3f090bb7090aa0b9/docs/verification/1898/car-glb-production.png",
    });

    const blobUrl = parseGitHubRepoFileUrl("https://github.com/solwation/lunden-3d-apartment/blob/main/docs/verification/1898/car-glb-production.png?raw=true#fragment");
    expect(blobUrl).toEqual({
      owner: "solwation",
      repo: "lunden-3d-apartment",
      repository: "solwation/lunden-3d-apartment",
      ref: "main",
      path: "docs/verification/1898/car-glb-production.png",
      url: "https://github.com/solwation/lunden-3d-apartment/blob/main/docs/verification/1898/car-glb-production.png",
    });

    const rawGithubUrl = parseGitHubRepoFileUrl("https://github.com/owner/repo/raw/feature-branch/assets/image.webp");
    expect(rawGithubUrl).toEqual({
      owner: "owner",
      repo: "repo",
      repository: "owner/repo",
      ref: "feature-branch",
      path: "assets/image.webp",
      url: "https://github.com/owner/repo/raw/feature-branch/assets/image.webp",
    });

    expect(parseGitHubRepoFileUrl("https://raw.githubusercontent.com/owner/repo/main/archive.zip")).toBeNull();
    expect(parseGitHubRepoFileUrl("https://example.com/owner/repo/raw/main/pic.png")).toBeNull();
    expect(parseGitHubRepoFileUrl("")).toBeNull();
    expect(parseGitHubRepoFileUrl(null)).toBeNull();
  });

  it("sanitizes and renders escaped HTML img tags into safe comment thumbnails (#450)", () => {
    const rawMarkdown = '<img src="https://raw.githubusercontent.com/solwation/lunden-3d-apartment/68a1403fcf373abd150faf212e90585d8fa78a15/docs/verification/1900/cat-binder-images.png" width="600" alt="Kattbilder i kattpärmen">';
    const html = renderMarkdown(rawMarkdown);
    const { cleanHtml, images } = extractCommentImages(html, t);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      name: "cat-binder-images.png",
      alt: "Kattbilder i kattpärmen",
      path: "docs/verification/1900/cat-binder-images.png",
      repository: "solwation/lunden-3d-apartment",
    });

    // The ugly &lt;img code is transformed into a clean thumbnail
    expect(cleanHtml).not.toContain("&lt;img");
    expect(cleanHtml).toContain('class="comment-thumbnail"');
    expect(cleanHtml).toContain('alt="Kattbilder i kattpärmen"');

    // Malicious HTML with script or non-image is not transformed
    const attack = sanitizeEscapedHtmlImages('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(attack).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it("extracts images with raw.githubusercontent URLs and populates fallback metadata (#450)", () => {
    const rawMarkdown = "![Optimerade fordonsmodeller](https://raw.githubusercontent.com/solwation/lunden-3d-apartment/c6b23ea02a7b8e57929ce6bf3f090bb7090aa0b9/docs/verification/1898/car-glb-production.png)";
    const html = renderMarkdown(rawMarkdown);
    const { cleanHtml, images } = extractCommentImages(html, t);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      name: "car-glb-production.png",
      alt: "Optimerade fordonsmodeller",
      path: "docs/verification/1898/car-glb-production.png",
      repository: "solwation/lunden-3d-apartment",
      ref: "c6b23ea02a7b8e57929ce6bf3f090bb7090aa0b9",
    });

    expect(cleanHtml).toContain('data-repo-path="docs/verification/1898/car-glb-production.png"');
    expect(cleanHtml).toContain('data-repository="solwation/lunden-3d-apartment"');
    expect(cleanHtml).toContain('data-ref="c6b23ea02a7b8e57929ce6bf3f090bb7090aa0b9"');
    expect(cleanHtml).toContain('src="https://raw.githubusercontent.com/solwation/lunden-3d-apartment/c6b23ea02a7b8e57929ce6bf3f090bb7090aa0b9/docs/verification/1898/car-glb-production.png"');
  });

  it("never turns escaped img text inside attribute values or code into images (#457)", () => {
    const altAttack = "![<img src='https://e.example/x style=position:fixed;inset:0 onerror=alert(1) y=/a.png' alt='x'>](https://e.example/b.png)";
    const titleAttack = "[click](https://e.example/ \"<img src='https://e.example/x style=position:fixed;inset:0 onclick=alert(1) y=/a.png'>\")";
    const inlineCode = "`<img src=\"https://e.example/a.png\" width=\"200\">`";
    const fencedCode = ["```html", '<img src="docs/shot.png" alt="Shot">', "```"].join("\n");

    for (const source of [altAttack, titleAttack, inlineCode, fencedCode]) {
      const html = renderMarkdown(source);
      expect(sanitizeEscapedHtmlImages(html)).toBe(html);
    }

    const title = sanitizeEscapedHtmlImages(renderMarkdown(titleAttack));
    expect(title).toContain('target="_blank" rel="noopener noreferrer"');
    expect(attributeNames(title, "a")).toEqual([["href", "title", "target", "rel"]]);
    const alt = extractCommentImages(renderMarkdown(altAttack), t);
    expect(alt.images.map(image => image.src)).toEqual(["https://e.example/b.png"]);
    expect(attributeNames(sanitizeEscapedHtmlImages(renderMarkdown(altAttack)), "img")).toEqual([["src", "alt"]]);

    const code = extractCommentImages(renderMarkdown([inlineCode, fencedCode].join("\n\n")), t);
    expect(code.cleanHtml).not.toContain("<img");
    expect(code.cleanHtml).toContain("<code>&lt;img src=&quot;https://e.example/a.png&quot; width=&quot;200&quot;&gt;</code>");
    expect(code.cleanHtml).toContain("&lt;img src=&quot;docs/shot.png&quot; alt=&quot;Shot&quot;&gt;");
  });

  it("converts escaped img text once and leaves a second application unchanged (#457)", () => {
    const sources = [
      'Plain <img src="https://e.example/plain.png" alt="Plain">',
      '<img src="https://raw.githubusercontent.com/o/r/sha/docs/linked.png" width="600" alt="Linked">',
      '<img src="docs/relative.png" alt="Relative">',
      '<img src="https://github.com/o/r/releases/download/v1/asset.png" alt="Asset">',
      "Raw https://e.example/raw.png and <img src='https://e.example/quoted.png' alt='Quoted'>",
      // A converted alt carries escaped img text that a second pass must not convert again.
      '<img src="https://e.example/a.png" alt="x<img src=" y> https://e.example/c.png >',
    ];
    for (const source of sources) {
      const once = sanitizeEscapedHtmlImages(renderMarkdown(source));
      expect(once).toMatch(/<img src="[^"]+" alt="[^"]*">/);
      expect(sanitizeEscapedHtmlImages(once)).toBe(once);
    }

    const { images } = extractCommentImages(renderMarkdown(sources.slice(0, 5).join("\n\n")), t);
    expect(images.map(image => image.path ?? image.src).sort()).toEqual([
      "docs/linked.png",
      "docs/relative.png",
      "https://e.example/plain.png",
      "https://e.example/quoted.png",
      "https://e.example/raw.png",
      "https://github.com/o/r/releases/download/v1/asset.png",
    ]);
  });

  it("leaves escaped img text alone when other markup interrupts it (#457)", () => {
    const html = renderMarkdown('<img src="https://e.example/a.png" `code` alt="x">');
    expect(sanitizeEscapedHtmlImages(html)).toBe(html);
    expect(sanitizeEscapedHtmlImages("<p>&lt;img src=&quot;https://e.example/a.png&quot;</p><p>&gt;</p>"))
      .toBe("<p>&lt;img src=&quot;https://e.example/a.png&quot;</p><p>&gt;</p>");
  });

  it("formats explanation when private repo image fails due to missing Contents permission (#452)", () => {
    // 403 on Contents API always explains missing Contents permission
    setLanguage("sv");
    const reason403Sv = contentsPermissionErrorReason({
      status: 403,
      repo: "solwation/private-repo",
      isPrivate: true,
    }, t);
    expect(reason403Sv).toBe("tokenen saknar läsrätt till Contents i solwation/private-repo");

    setLanguage("en");
    const reason403En = contentsPermissionErrorReason({
      status: 403,
      repo: "solwation/private-repo",
      isPrivate: true,
    }, t);
    expect(reason403En).toBe("token lacks read access to Contents in solwation/private-repo");

    // 404 on private repo also indicates missing Contents access
    setLanguage("sv");
    const reason404Private = contentsPermissionErrorReason({
      status: 404,
      repo: "solwation/private-repo",
      isPrivate: true,
    }, t);
    expect(reason404Private).toBe("tokenen saknar läsrätt till Contents i solwation/private-repo");

    // 404 on public repo is just an ordinary missing file; no token permission reason
    const reason404Public = contentsPermissionErrorReason({
      status: 404,
      repo: "solwation/public-repo",
      isPrivate: false,
    }, t);
    expect(reason404Public).toBeUndefined();

    // No error or missing repo produces undefined
    expect(contentsPermissionErrorReason(null, t)).toBeUndefined();
    expect(contentsPermissionErrorReason({ status: 500, repo: "solwation/repo" }, t)).toBeUndefined();
  });

  describe("loaded/failed image rendering with legacy serialization (#460)", () => {
    // Browsers before the 2025 serialization change leave `<` and `>` raw in attribute values.
    const fake = "> <img data-repo-path='docs/existing.png' style='position:fixed' onclick='x'>";
    const legacyImage = (alt: string) => `<img alt="${alt}" class="comment-thumbnail" role="button" tabindex="0" `
      + `aria-haspopup="dialog" aria-label="Öppna bild: ${alt}" loading="lazy" referrerpolicy="no-referrer" `
      + `data-repo-path="docs/real.png" data-raw-src="docs/real.png">`;
    const placeholder = (attrs: Record<string, string>, fallbackUrl?: string) =>
      `<span class="image-placeholder" data-for="${fallbackUrl}" data-alt-length="${attrs.alt?.length}"></span>`;
    const ownNames = ["alt", "class", "role", "tabindex", "aria-haspopup", "aria-label", "loading", "referrerpolicy", "data-repo-path", "data-raw-src"];

    function imageTags(html: string) {
      const tags: { names: string[]; attrs: Record<string, string> }[] = [];
      replaceImageTags(html, (attributes, tag) => {
        tags.push({ names: attributes.map(attr => attr.name), attrs: Object.fromEntries(attributes.map(attr => [attr.name, attr.value])) });
        return tag;
      });
      return tags;
    }

    it.each([
      ["plain fake tag", `Diagram ${fake}`],
      ["fake src and data-raw-src", `Diagram ${fake.replace("<img ", "<img src='https://evil.example/x.png' data-raw-src='docs/existing.png' ")}`],
    ])("loads the real image only, keeping the %s inside alt", (_, alt) => {
      const html = `<p>${legacyImage(alt)}</p>`;
      const loaded = { "docs/real.png": "data:image/png;base64,UkVBTA==", "docs/existing.png": "data:image/png;base64,RkFLRQ==" };
      const output = renderLoadedImages(html, loaded, {}, placeholder);

      expect(output).toBe(`<p><img src="data:image/png;base64,UkVBTA==" ${legacyImage(alt).slice("<img ".length)}</p>`);
      const tags = imageTags(output);
      expect(tags).toHaveLength(1);
      expect(tags[0]!.names).toEqual(["src", ...ownNames]);
      expect(tags[0]!.attrs.alt).toBe(alt);
      expect(tags[0]!.attrs["aria-label"]).toBe(`Öppna bild: ${alt}`);
      expect(output).not.toContain("RkFLRQ==");
    });

    it.each([
      ["plain fake tag", `Diagram ${fake}`],
      ["fake src and data-raw-src", `Diagram ${fake.replace("<img ", "<img src='docs/existing.png' data-raw-src='docs/existing.png' ")}`],
    ])("turns only the real failed image into a placeholder, with the %s in alt", (_, alt) => {
      const html = `<p>${legacyImage(alt)}</p>`;
      const output = renderLoadedImages(html, {}, { "docs/real.png": true, "docs/existing.png": true }, placeholder);

      expect(output).toBe(`<p><span class="image-placeholder" data-for="docs/real.png" data-alt-length="${alt.length}"></span></p>`);
      expect(imageTags(output)).toHaveLength(0);
    });

    it("leaves a real image untouched when only the fake path in its alt is loaded or failed", () => {
      const html = `<p>${legacyImage(`Diagram ${fake}`)}</p>`;
      expect(renderLoadedImages(html, { "docs/existing.png": "data:image/png;base64,RkFLRQ==" }, {}, placeholder)).toBe(html);
      expect(renderLoadedImages(html, {}, { "docs/existing.png": true }, placeholder)).toBe(html);
    });

    it("never reads fake attributes inside an attribute value as the real attribute", () => {
      const html = `<img alt="x data-raw-src='docs/fake.png' src='docs/fake.png' data-repo-path='docs/fake.png' class='direct-image-preview'" `
        + `src="https://example.com/real.png" class="comment-thumbnail">`;
      const [tag] = imageTags(html);
      expect(tag!.names).toEqual(["alt", "src", "class"]);
      expect(tag!.attrs.src).toBe("https://example.com/real.png");
      expect(tag!.attrs.class).toBe("comment-thumbnail");
      expect(tag!.attrs["data-raw-src"]).toBeUndefined();
      expect(tag!.attrs["data-repo-path"]).toBeUndefined();

      expect(renderLoadedImages(html, { "docs/fake.png": "data:fake" }, { "docs/fake.png": true }, placeholder)).toBe(html);
      // The real src still drives the decision; direct previews are kept as images when failed.
      expect(renderLoadedImages(html, { "https://example.com/real.png": "data:real&\"x" }, {}, placeholder))
        .toBe(`<img alt="x data-raw-src='docs/fake.png' src='docs/fake.png' data-repo-path='docs/fake.png' class='direct-image-preview'" `
          + `src="data:real&amp;&quot;x" data-raw-src="https://example.com/real.png" class="comment-thumbnail">`);
      expect(renderLoadedImages(html, {}, { "https://example.com/real.png": true }, placeholder))
        .toBe(`<span class="image-placeholder" data-for="https://example.com/real.png" data-alt-length="${tag!.attrs.alt!.length}"></span>`);
    });

    it("keeps today's decisions for current serialization (relative, direct preview, data URLs)", () => {
      const relative = `<img src="docs/a.png" alt="a">`;
      expect(renderLoadedImages(relative, { "docs/a.png": "data:a" }, {}, placeholder))
        .toBe(`<img src="data:a" data-raw-src="docs/a.png" alt="a">`);
      const direct = `<a href="https://example.com/b.png">b</a><img src="https://example.com/b.png" class="direct-image-preview comment-thumbnail" alt="b">`;
      expect(renderLoadedImages(direct, {}, { "https://example.com/b.png": true }, placeholder)).toBe(direct);
      const dataUrl = `<img src="data:image/png;base64,AAAA" alt="c">`;
      expect(renderLoadedImages(dataUrl, {}, {}, placeholder)).toBe(dataUrl);
      const unloaded = `<p><img alt="d &gt; <img src='x'>" data-repo-path="docs/d.png"></p><!-- <img src="docs/d.png"> -->`;
      expect(renderLoadedImages(unloaded, {}, {}, placeholder)).toBe(unloaded);
      expect(renderLoadedImages(unloaded, { "docs/d.png": "data:d" }, {}, placeholder))
        .toBe(`<p><img src="data:d" alt="d &gt; <img src='x'>" data-repo-path="docs/d.png"></p><!-- <img src="docs/d.png"> -->`);
    });
  });
});
