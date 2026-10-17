import type { QRCodeByteSegment, QRCodeNumericSegment } from "qrcode";
import type { Rules } from "./model";
import { decodeCompactHandoff, encodeCompactHandoff } from "./handoff-codec";
import { handoffRecord, handoffRepository, handoffRepositoryList, parseHandoffPreferences, type HandoffPreferences } from "./handoff-preferences";
export { mergeHandoffPreferences, parseHandoffPreferences, type HandoffPreferences, type HandoffPreferenceState, type HandoffStatisticsPreferences } from "./handoff-preferences";

export const HANDOFF_LIFETIME_MS = 5 * 60 * 1000;
const PREFIX = "#issueflow-handoff=";
const MAX_ENCODED_LENGTH = 16_000;
// Numeric capacity of the largest QR code (7089 digits) minus room for the app URL.
const MAX_COMPACT_LENGTH = 6_800;
const RULE_KEYS = ["progress", "high", "medium", "low"];
export interface HandoffSettings {
  token: string;
  selected: string[];
  rules: Record<string, Rules>;
  preferences?: HandoffPreferences;
}
export interface HandoffPayload extends HandoffSettings {
  version: 1 | 2;
  issuedAt: number;
}
/** User-visible Swedish source texts; translate them with t() where they are shown. */
export const HANDOFF_EXPIRED_MESSAGE = "Överföringslänken har gått ut. Den gäller i fem minuter – skapa en ny QR-kod på den andra enheten.";
export const HANDOFF_INVALID_MESSAGE = "Överföringslänken är ogiltig eller ofullständig. Skapa en ny QR-kod på den andra enheten.";
/** A rejected transfer link or QR code; `reason` separates an expired code from a malformed one. */
export class HandoffError extends Error {
  constructor(readonly reason: "expired" | "invalid", options?: { cause?: unknown }) {
    super(reason === "expired" ? HANDOFF_EXPIRED_MESSAGE : HANDOFF_INVALID_MESSAGE, options);
    this.name = "HandoffError";
  }
}
const record = handoffRecord;
function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function validate(
  value: unknown,
  now: number,
): asserts value is HandoffPayload {
  if (
    !record(value) ||
    !exactKeys(value, value.version === 2 ? ["version", "issuedAt", "token", "selected", "rules", "preferences"] : ["version", "issuedAt", "token", "selected", "rules"]) ||
    (value.version !== 1 && value.version !== 2) ||
    !Number.isSafeInteger(value.issuedAt) ||
    (value.issuedAt as number) > now + 30_000 ||
    (value.issuedAt as number) < 0 ||
    typeof value.token !== "string" ||
    value.token.length < 1 ||
    value.token.length > 1024 ||
    /\s/.test(value.token) ||
    !handoffRepositoryList(value.selected) ||
    !record(value.rules) ||
    Object.keys(value.rules).length > 100
  )
    throw new HandoffError("invalid");
  if (value.version === 2) value.preferences = parseHandoffPreferences(value.preferences);
  for (const [repo, rules] of Object.entries(value.rules)) {
    if (
      !handoffRepository(repo) ||
      !record(rules) ||
      !exactKeys(rules, RULE_KEYS) ||
      !Object.values(rules).every(
        (label) => typeof label === "string" && label.length <= 100,
      )
    ) {
      throw new HandoffError("invalid");
    }
  }
  // Only a well-formed payload is reported as expired, so a corrupt code never suggests mere age.
  if (now >= (value.issuedAt as number) + HANDOFF_LIFETIME_MS) throw new HandoffError("expired");
}
export function encodeHandoff(
  settings: HandoffSettings,
  now = Date.now(),
): string {
  const payload: HandoffPayload = { ...settings, preferences: settings.preferences || {}, version: 2, issuedAt: now };
  validate(payload, now);
  const encoded = encodeCompactHandoff(payload);
  if (encoded.length > MAX_COMPACT_LENGTH)
    throw new Error("Handoff is too large");
  return encoded;
}
/** Decode a transfer; every rejection is a HandoffError with a translatable message. */
export function decodeHandoff(
  encoded: string,
  now = Date.now(),
): HandoffPayload {
  try {
    return decodeHandoffPayload(encoded, now);
  } catch (cause) {
    throw cause instanceof HandoffError ? cause : new HandoffError("invalid", { cause });
  }
}
function decodeHandoffPayload(encoded: string, now: number): HandoffPayload {
  if (!encoded || encoded.length > MAX_ENCODED_LENGTH)
    throw new Error("Invalid handoff encoding");
  // Digits are the compact format; base64 JSON (v1/v2) always contains letters.
  if (/^\d+$/.test(encoded)) {
    const payload = decodeCompactHandoff(encoded);
    validate(payload, now);
    return payload;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1)
    throw new Error("Invalid handoff encoding");
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const payload: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  validate(payload, now);
  return payload;
}
export function createHandoffUrl(
  baseUrl: string,
  settings: HandoffSettings,
  now = Date.now(),
) {
  const url = new URL(baseUrl);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid app URL");
  url.search = "";
  url.hash = PREFIX.slice(1) + encodeHandoff(settings, now);
  return { url: url.href, expiresAt: now + HANDOFF_LIFETIME_MS };
}
/** QR segments for a handoff URL: the app address as bytes, the payload digits in numeric mode. */
export function handoffQrSegments(url: string): [QRCodeByteSegment, QRCodeNumericSegment] {
  const start = url.indexOf(PREFIX) + PREFIX.length;
  if (start < PREFIX.length || !/^\d+$/.test(url.slice(start))) throw new Error("Invalid handoff URL");
  return [{ data: new TextEncoder().encode(url.slice(0, start)), mode: "byte" }, { data: url.slice(start), mode: "numeric" }];
}
/** Decode a scanned link in place; never navigate to credential-bearing input. */
export function parseHandoffUrl(
  value: string,
  appUrl: string,
  now = Date.now(),
): HandoffPayload {
  let url: URL;
  try { url = new URL(value); } catch (cause) { throw new HandoffError("invalid", { cause }); }
  const app = new URL(appUrl);
  if (
    url.origin !== app.origin ||
    url.pathname.replace(/\/$/, "") !== app.pathname.replace(/\/$/, "") ||
    url.username || url.password || url.search ||
    !url.hash.startsWith(PREFIX)
  ) throw new HandoffError("invalid");
  return decodeHandoff(url.hash.slice(PREFIX.length), now);
}
/** Scrub credentials before decoding, authentication, or any network operation. */
export function consumeHandoff(
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  history: Pick<History, "replaceState" | "state"> = window.history,
  now = Date.now(),
): HandoffPayload | null {
  if (!location.hash.startsWith(PREFIX)) return null;
  const encoded = location.hash.slice(PREFIX.length);
  history.replaceState(history.state, "", location.pathname + location.search);
  return decodeHandoff(encoded, now);
}
