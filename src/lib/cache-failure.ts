import { ContentCacheError } from "./vault";
const COMPRESSION = "Webbläsaren kunde inte komprimera översikten. Uppdatera webbläsaren och försök igen.";

/**
 * Return a localizable explanation without exposing private content or raw errors, or null for an
 * expected interruption (#434): an aborted stream, or a compression/storage failure while the page
 * was hidden, frozen or offline. Such a write keeps no warning and the next save retries it.
 */
export function cacheFailureReason(error: unknown, interrupted = false): string | null {
  if (error instanceof ContentCacheError) {
    if (error.code === "interrupted") return null;
    // Without a cause, CompressionStream itself is missing: only a browser update helps.
    if (error.code === "compression" && error.cause === undefined) return COMPRESSION;
    if (error.code === "size") return "Översikten ryms inte i den krypterade cachen. Välj färre repositories och försök igen.";
  }
  let cause = error;
  for (let depth = 0; depth < 8 && cause instanceof Error; depth++, cause = cause.cause) {
    if (cause.name === "QuotaExceededError") return "Webbläsarens lagringsutrymme räcker inte till. Frigör utrymme och försök igen.";
  }
  if (interrupted) return null;
  if (error instanceof ContentCacheError && error.code === "compression") return COMPRESSION;
  return "Webbläsaren kunde inte skriva till den säkra lagringen. Kontrollera webbplatsens lagringsbehörigheter och försök igen.";
}
