import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// jsQR 1.4.0 has an incorrect version-23 alignment center. This makes every
// 109-module code unreadable, including otherwise valid full-profile QR sync.
// https://github.com/cozmo/jsQR/issues/251
const incorrect = "versionNumber: 23,\n        alignmentPatternCenters: [6, 30, 54, 74, 102],";
const corrected = "versionNumber: 23,\n        alignmentPatternCenters: [6, 30, 54, 78, 102],";

export function correctJsQr(source: string): string {
  if (source.includes(corrected) && !source.includes(incorrect)) return source;
  if (source.split(incorrect).length !== 2) throw new Error("Review jsQR version-23 compatibility patch before building");
  return source.replace(incorrect, corrected);
}

async function main() {
  const path = new URL("../node_modules/jsqr/dist/jsQR.js", import.meta.url);
  const source = await readFile(path, "utf8");
  const patched = correctJsQr(source);
  if (patched !== source) await writeFile(path, patched);
  console.log("jsQR version-23 compatibility fix verified");
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
