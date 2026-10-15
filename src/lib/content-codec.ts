/** Limits apply before encryption; AES-GCM adds its fixed 16-byte tag. */
export const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
export const MAX_EXPANDED_CONTENT_BYTES = 64 * 1024 * 1024;
export type ContentCacheErrorCode = "size" | "compression" | "storage";
export class ContentCacheError extends Error {
  constructor(public readonly code: ContentCacheErrorCode, options?: ErrorOptions) {
    super(`Content cache ${code} failure`, options);
    this.name = "ContentCacheError";
  }
}
// This marker lives inside the authenticated ciphertext. Legacy records are raw JSON.
const GZIP_MARKER = new Uint8Array([0x49, 0x46, 0x43, 0x01]);

async function collectBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new ContentCacheError("size");
      chunks.push(value);
    }
  } catch (cause) {
    await reader.cancel().catch(() => {});
    throw cause;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function encodeContent(plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.byteLength > MAX_EXPANDED_CONTENT_BYTES) throw new ContentCacheError("size");
  if (plaintext.byteLength <= MAX_CONTENT_BYTES) return plaintext;
  if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") throw new ContentCacheError("compression");
  try {
    const compressed = await collectBounded(new Blob([plaintext]).stream().pipeThrough(new CompressionStream("gzip")), MAX_CONTENT_BYTES - GZIP_MARKER.length);
    const payload = new Uint8Array(GZIP_MARKER.length + compressed.length);
    payload.set(GZIP_MARKER); payload.set(compressed, GZIP_MARKER.length);
    return payload;
  } catch (cause) {
    throw cause instanceof ContentCacheError ? cause : new ContentCacheError("compression", { cause });
  }
}

export async function decodeContent(payload: Uint8Array<ArrayBuffer>): Promise<unknown> {
  if (payload.byteLength > MAX_CONTENT_BYTES) throw new ContentCacheError("size");
  const compressed = GZIP_MARKER.every((byte, i) => payload[i] === byte);
  const plaintext = compressed
    ? await collectBounded(new Blob([payload.subarray(GZIP_MARKER.length)]).stream().pipeThrough(new DecompressionStream("gzip")), MAX_EXPANDED_CONTENT_BYTES)
    : payload;
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
}
