import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { correctJsQr } from "../scripts/patch-jsqr.ts";

describe("QR profile reader compatibility", () => {
  it.each([22, 23, 24])("reads real QR pixels around the broken density boundary: version %i", version => {
    const payload = "fictional-profile:" + "preferences-for-two-repositories".repeat(8);
    const code = QRCode.create(payload, { version, errorCorrectionLevel: "L" });
    const scale = 4, margin = 4, width = (code.modules.size + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    for (let y = 0; y < code.modules.size; y++) for (let x = 0; x < code.modules.size; x++) {
      if (!code.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const offset = (((y + margin) * scale + dy) * width + (x + margin) * scale + dx) * 4;
        pixels[offset] = 16; pixels[offset + 1] = 24; pixels[offset + 2] = 39;
      }
    }
    expect(jsQR(pixels, width, width)?.data).toBe(payload);
  });

  it("keeps an already corrected dependency unchanged and rejects unrecognized dependency layouts", () => {
    const corrected = "versionNumber: 23,\n        alignmentPatternCenters: [6, 30, 54, 78, 102],";
    expect(correctJsQr(corrected)).toBe(corrected);
    expect(() => correctJsQr("a different dependency layout")).toThrow("Review jsQR");
  });
});
