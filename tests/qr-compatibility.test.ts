import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { correctJsQr } from "../scripts/patch-jsqr.ts";
import { createHandoffUrl, handoffQrSegments, parseHandoffUrl } from "../src/lib/handoff";

function render(code: QRCode.QRCode) {
  const scale = 4, margin = 4, width = (code.modules.size + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < code.modules.size; y++) for (let x = 0; x < code.modules.size; x++) {
    if (!code.modules.get(y, x)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const offset = (((y + margin) * scale + dy) * width + (x + margin) * scale + dx) * 4;
      pixels[offset] = 16; pixels[offset + 1] = 24; pixels[offset + 2] = 39;
    }
  }
  return { pixels, width };
}

describe("QR profile reader compatibility", () => {
  it.each([22, 23, 24])("reads real QR pixels around the broken density boundary: version %i", version => {
    const payload = "fictional-profile:" + "preferences-for-two-repositories".repeat(8);
    const { pixels, width } = render(QRCode.create(payload, { version, errorCorrectionLevel: "L" }));
    expect(jsQR(pixels, width, width)?.data).toBe(payload);
  });

  it("scans a compact handoff code with an address segment and a numeric payload segment", () => {
    const now = 1_800_000_000_000, app = "https://example.test/app/";
    const repos = Array.from({ length: 8 }, (_, n) => "sample/repository-" + n);
    const settings = {
      token: "github_pat_11FICTIONAL0" + "x".repeat(70), selected: repos,
      rules: Object.fromEntries(repos.map(repo => [repo, { progress: "in-progress", high: "priority: high", medium: "priority: medium", low: "priority: low" }])),
      preferences: { projectOrder: repos, notificationRepos: repos.slice(0, 4), language: "sv" as const, splitByRepository: true },
    };
    const { url } = createHandoffUrl(app, settings, now);
    const code = QRCode.create(handoffQrSegments(url), { errorCorrectionLevel: "L" });
    expect(code.version).toBeLessThanOrEqual(16);
    const { pixels, width } = render(code);
    const scanned = jsQR(pixels, width, width)?.data;
    expect(scanned).toBe(url);
    expect(parseHandoffUrl(scanned!, app, now)).toEqual({ ...settings, version: 2, issuedAt: now });
  });

  it("keeps an already corrected dependency unchanged and rejects unrecognized dependency layouts", () => {
    const corrected = "versionNumber: 23,\n        alignmentPatternCenters: [6, 30, 54, 78, 102],";
    expect(correctJsQr(corrected)).toBe(corrected);
    expect(() => correctJsQr("a different dependency layout")).toThrow("Review jsQR");
  });
});
