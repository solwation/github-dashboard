import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
  const page = await browser.newPage();
  for (const [file, size] of [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["apple-touch-icon.png", 180],
  ]) {
    const data = await page.evaluate(async (size) => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#147d69"/><g fill="none" stroke="white" stroke-width="19" stroke-linejoin="round" stroke-linecap="round"><path d="m256 128 140 76-140 76-140-76z"/><path d="m116 258 140 76 140-76M116 312l140 76 140-76"/></g></svg>';
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(svg);
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(img, 0, 0, size, size);
      return canvas.toDataURL("image/png").split(",")[1];
    }, size);
    writeFileSync(
      new URL("../public/icons/" + file, import.meta.url),
      Buffer.from(data, "base64"),
    );
  }
} finally {
  await browser.close();
}
