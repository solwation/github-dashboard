/**
 * Compact optical transport for handoff payloads (format 3).
 *
 * The JSON payload is written as tagged binary values: strings are interned,
 * known keys and enum values come from a fixed dictionary, repository names
 * share their owner, palette colors take three bytes, dates are day numbers and
 * token-like strings are packed at six bits per character. The bytes are then
 * written as decimal digits so the QR code can use numeric mode. Decoding
 * reproduces the exact JSON value; callers validate it as before.
 */

const FORMAT = 3;
const MAX_DEPTH = 8;
const MAX_ITEMS = 2_000;
const MAX_EXPANDED = 200_000;

/** Append-only: existing indexes must never change or be removed. */
const DICTIONARY = [
  "", "version", "issuedAt", "token", "selected", "rules", "preferences",
  "progress", "high", "medium", "low",
  "repositoryColors", "projectOrder", "collapsedRepos", "columnLimit", "repositoryColumnLimits",
  "notificationRepos", "language", "query", "repositoryQueries", "repoQuery",
  "hideCoordination", "splitByRepository", "timeoutMinutes", "currentView", "statistics",
  "from", "to", "label", "contributor", "metric",
  "auto", "sv", "en", "overview",
  "closed", "created", "reopened", "netIssues", "commits", "additions", "deletions",
  "netLines", "files", "prsOpened", "prsMerged", "prsClosed",
  "timeoutEnabled", "timeoutOverrunPercent",
];
const DICTIONARY_INDEX = new Map(DICTIONARY.map((word, index) => [word, index]));
const PACKED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const DAY_MS = 86_400_000;

const enum Tag { Null, False, True, Uint, Float, Text, Packed, Reference, Word, Repository, Color, Date, List, Record, Same }
// Single-byte forms: dictionary words, then recent string references.
const WORD_TAG = 16;
const REFERENCE_TAG = 64;
const SHORT_WORDS = REFERENCE_TAG - WORD_TAG;
const SHORT_REFERENCES = 256 - REFERENCE_TAG;

const REPOSITORY = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})$/;
const COLOR = /^#[0-9a-f]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PACKABLE = /^[A-Za-z0-9_-]{8,}$/;

function dayNumber(value: string) {
  const time = Date.parse(value);
  if (!DATE.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return -1;
  return time / DAY_MS;
}

class Writer {
  bytes: number[] = [];
  private strings = new Map<string, number>();
  private composites = new Map<string, number>();
  byte(value: number) { this.bytes.push(value); }
  uint(value: number) {
    while (value >= 0x80) { this.bytes.push((value % 0x80) | 0x80); value = Math.floor(value / 0x80); }
    this.bytes.push(value);
  }
  value(value: unknown, depth = 0): void {
    if (depth > MAX_DEPTH) throw new Error("Handoff is too deeply nested");
    if (value === null) this.byte(Tag.Null);
    else if (value === false || value === true) this.byte(value ? Tag.True : Tag.False);
    else if (typeof value === "number") {
      if (Number.isSafeInteger(value) && value >= 0) { this.byte(Tag.Uint); this.uint(value); }
      else if (Number.isFinite(value)) {
        this.byte(Tag.Float);
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, value);
        for (let i = 0; i < 8; i++) this.byte(view.getUint8(i));
      } else throw new Error("Unsupported handoff number");
    } else if (typeof value === "string") this.string(value);
    else if (typeof value === "object") {
      // Identical lists and records, such as shared label rules, are sent once.
      const identity = JSON.stringify(value);
      const known = this.composites.get(identity);
      if (known !== undefined) { this.byte(Tag.Same); this.uint(known); return; }
      if (Array.isArray(value)) {
        this.byte(Tag.List); this.uint(value.length);
        for (const item of value) this.value(item, depth + 1);
      } else {
        const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
        this.byte(Tag.Record); this.uint(entries.length);
        for (const [key, item] of entries) { this.string(key); this.value(item, depth + 1); }
      }
      this.composites.set(identity, this.composites.size);
    } else throw new Error("Unsupported handoff value");
  }
  private string(value: string) {
    const word = DICTIONARY_INDEX.get(value);
    if (word !== undefined) {
      if (word < SHORT_WORDS) this.byte(WORD_TAG + word);
      else { this.byte(Tag.Word); this.uint(word); }
      return;
    }
    const known = this.strings.get(value);
    if (known !== undefined) {
      if (known < SHORT_REFERENCES) this.byte(REFERENCE_TAG + known);
      else { this.byte(Tag.Reference); this.uint(known); }
      return;
    }
    const repository = REPOSITORY.exec(value);
    const day = dayNumber(value);
    if (repository) { this.byte(Tag.Repository); this.string(repository[1]!); this.string(repository[2]!); }
    else if (COLOR.test(value)) {
      this.byte(Tag.Color);
      for (let i = 1; i < 7; i += 2) this.byte(parseInt(value.slice(i, i + 2), 16));
    } else if (day >= 0) { this.byte(Tag.Date); this.uint(day); }
    else if (PACKABLE.test(value)) {
      this.byte(Tag.Packed); this.uint(value.length);
      let buffer = 0, bits = 0;
      for (const character of value) {
        buffer = ((buffer << 6) | PACKED.indexOf(character)) & 0x3fff; bits += 6;
        if (bits >= 8) { bits -= 8; this.byte((buffer >> bits) & 0xff); }
      }
      if (bits) this.byte((buffer << (8 - bits)) & 0xff);
    } else {
      const bytes = new TextEncoder().encode(value);
      this.byte(Tag.Text); this.uint(bytes.length);
      for (const byte of bytes) this.byte(byte);
    }
    this.strings.set(value, this.strings.size);
  }
}

class Reader {
  private offset = 0;
  private items = 0;
  private strings: string[] = [];
  private composites: string[] = [];
  private expanded = 0;
  constructor(private bytes: Uint8Array) {}
  get done() { return this.offset === this.bytes.length; }
  byte() {
    if (this.offset >= this.bytes.length) throw new Error("Truncated handoff");
    return this.bytes[this.offset++]!;
  }
  uint() {
    let value = 0, scale = 1;
    for (;;) {
      const byte = this.byte();
      value += (byte & 0x7f) * scale;
      if (!Number.isSafeInteger(value)) throw new Error("Invalid handoff number");
      if (byte < 0x80) return value;
      scale *= 0x80;
    }
  }
  private take(length: number) {
    if (length > this.bytes.length - this.offset) throw new Error("Truncated handoff");
    return this.bytes.subarray(this.offset, (this.offset += length));
  }
  private count() {
    const count = this.uint();
    if ((this.items += count) > MAX_ITEMS) throw new Error("Handoff has too many items");
    return count;
  }
  value(depth = 0): unknown {
    if (depth > MAX_DEPTH) throw new Error("Handoff is too deeply nested");
    const tag = this.byte();
    switch (tag) {
      case Tag.Null: return null;
      case Tag.False: return false;
      case Tag.True: return true;
      case Tag.Uint: return this.uint();
      case Tag.Float: {
        const value = new DataView(this.take(8).slice().buffer).getFloat64(0);
        if (!Number.isFinite(value)) throw new Error("Invalid handoff number");
        return value;
      }
      case Tag.Same: {
        const known = this.composites[this.uint()];
        if (known === undefined) throw new Error("Unknown handoff reference");
        if ((this.expanded += known.length) > MAX_EXPANDED) throw new Error("Handoff is too large");
        return JSON.parse(known);
      }
      case Tag.List: return this.composite(Array.from({ length: this.count() }, () => this.value(depth + 1)));
      case Tag.Record: {
        const result: Record<string, unknown> = {};
        for (let i = this.count(); i > 0; i--) {
          const key = this.string(this.byte());
          if (Object.hasOwn(result, key)) throw new Error("Duplicate handoff key");
          Object.defineProperty(result, key, { value: this.value(depth + 1), enumerable: true, writable: true, configurable: true });
        }
        return this.composite(result);
      }
      default: return this.string(tag);
    }
  }
  private composite<T>(value: T) {
    this.composites.push(JSON.stringify(value));
    return value;
  }
  private string(tag: number): string {
    if (tag >= REFERENCE_TAG) return this.reference(tag - REFERENCE_TAG);
    if (tag >= WORD_TAG) return this.word(tag - WORD_TAG);
    let value: string;
    switch (tag) {
      case Tag.Word: return this.word(this.uint());
      case Tag.Reference: return this.reference(this.uint());
      case Tag.Repository: value = this.string(this.byte()) + "/" + this.string(this.byte()); break;
      case Tag.Color: value = "#" + Array.from(this.take(3), (byte) => byte.toString(16).padStart(2, "0")).join(""); break;
      case Tag.Date: value = new Date(this.uint() * DAY_MS).toISOString().slice(0, 10); break;
      case Tag.Packed: {
        const length = this.uint();
        const bytes = this.take(Math.ceil((length * 6) / 8));
        let buffer = 0, bits = 0, index = 0;
        value = "";
        while (value.length < length) {
          if (bits < 6) { buffer = ((buffer << 8) | bytes[index++]!) & 0xffff; bits += 8; }
          bits -= 6;
          value += PACKED[(buffer >> bits) & 0x3f];
        }
        break;
      }
      case Tag.Text: value = new TextDecoder("utf-8", { fatal: true }).decode(this.take(this.uint())); break;
      default: throw new Error("Invalid handoff string");
    }
    this.strings.push(value);
    return value;
  }
  private word(index: number) {
    const word = DICTIONARY[index];
    if (word === undefined) throw new Error("Unknown handoff word");
    return word;
  }
  private reference(index: number) {
    const known = this.strings[index];
    if (known === undefined) throw new Error("Unknown handoff reference");
    return known;
  }
}

// Six bytes fit exactly in a safe integer and fifteen digits; shorter final
// chunks have distinct digit counts, so the byte length is recoverable.
const CHUNK = 6;
const DIGITS = [0, 3, 5, 8, 10, 13, 15];

function toDigits(bytes: number[]) {
  let digits = "";
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const chunk = bytes.slice(start, start + CHUNK);
    digits += String(chunk.reduce((value, byte) => value * 256 + byte, 0)).padStart(DIGITS[chunk.length]!, "0");
  }
  return digits;
}

function fromDigits(digits: string) {
  const whole = Math.floor(digits.length / DIGITS[CHUNK]!);
  const rest = DIGITS.indexOf(digits.length - whole * DIGITS[CHUNK]!);
  if (rest < 0) throw new Error("Invalid handoff digits");
  const bytes = new Uint8Array(whole * CHUNK + rest);
  let offset = 0, position = 0;
  for (const size of [...Array<number>(whole).fill(CHUNK), ...(rest ? [rest] : [])]) {
    let value = Number(digits.slice(position, (position += DIGITS[size]!)));
    if (value >= 256 ** size) throw new Error("Invalid handoff digits");
    for (let i = size - 1; i >= 0; i--) { bytes[offset + i] = value % 256; value = Math.floor(value / 256); }
    offset += size;
  }
  return bytes;
}

export function encodeCompactHandoff(payload: unknown) {
  const writer = new Writer();
  writer.byte(FORMAT);
  writer.value(payload);
  return toDigits(writer.bytes);
}

export function decodeCompactHandoff(digits: string): unknown {
  if (!/^\d+$/.test(digits)) throw new Error("Invalid handoff digits");
  const reader = new Reader(fromDigits(digits));
  if (reader.byte() !== FORMAT) throw new Error("Unsupported handoff format");
  const value = reader.value();
  if (!reader.done) throw new Error("Trailing handoff data");
  return value;
}
