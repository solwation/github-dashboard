import { afterEach, expect, test, vi } from "vitest";
import { ContentCacheError, decodeContent, encodeContent, MAX_CONTENT_BYTES, MAX_EXPANDED_CONTENT_BYTES } from "../src/lib/content-codec";
const encoder = new TextEncoder();
afterEach(() => vi.unstubAllGlobals());

test("legacy JSON remains readable and small snapshots need no compression support", async () => {
  vi.stubGlobal("CompressionStream", undefined);
  const bytes = encoder.encode(JSON.stringify({ title: "Privat ärende" }));
  expect(await encodeContent(bytes)).toBe(bytes);
  expect(await decodeContent(bytes)).toEqual({ title: "Privat ärende" });
});

test("large snapshots round-trip completely inside the stored byte limit", async () => {
  const value = { body: "å".repeat(MAX_CONTENT_BYTES), title: "Large board" };
  const bytes = encoder.encode(JSON.stringify(value));
  const payload = await encodeContent(bytes);
  expect(bytes.byteLength).toBeGreaterThan(MAX_CONTENT_BYTES);
  expect(payload.byteLength).toBeLessThan(MAX_CONTENT_BYTES);
  expect(await decodeContent(payload)).toEqual(value);
});

test("expanded and incompressible payload bounds reject instead of silently truncating", async () => {
  await expect(encodeContent(new Uint8Array(MAX_EXPANDED_CONTENT_BYTES + 1))).rejects.toMatchObject({ code: "size" });
  const random = new Uint8Array(MAX_CONTENT_BYTES + 1024);
  for (let offset = 0; offset < random.length; offset += 65536) crypto.getRandomValues(random.subarray(offset, offset + 65536));
  await expect(encodeContent(random)).rejects.toMatchObject({ code: "size" });
  await expect(decodeContent(new Uint8Array(MAX_CONTENT_BYTES + 1))).rejects.toMatchObject({ code: "size" });
});

test("streamed decompression is bounded even for a small compressed bomb", async () => {
  const compressed = await new Response(new Blob([new Uint8Array(MAX_EXPANDED_CONTENT_BYTES + 1)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const payload = new Uint8Array(4 + compressed.byteLength);
  payload.set([0x49, 0x46, 0x43, 0x01]); payload.set(new Uint8Array(compressed), 4);
  await expect(decodeContent(payload)).rejects.toMatchObject({ code: "size" });
});

test("unsupported compression is explicit and corrupted or unknown formats cannot restore", async () => {
  const payload = await encodeContent(encoder.encode(JSON.stringify({ body: "x".repeat(MAX_CONTENT_BYTES) })));
  await expect(decodeContent(payload.subarray(0, payload.length - 5))).rejects.toThrow();
  await expect(decodeContent(new Uint8Array([0x49, 0x46, 0x43, 0x02]))).rejects.toThrow();
  vi.stubGlobal("CompressionStream", undefined);
  await expect(encodeContent(new Uint8Array(MAX_CONTENT_BYTES + 1))).rejects.toBeInstanceOf(ContentCacheError);
  await expect(encodeContent(new Uint8Array(MAX_CONTENT_BYTES + 1))).rejects.toMatchObject({ code: "compression" });
});
