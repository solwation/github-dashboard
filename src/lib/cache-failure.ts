import { ContentCacheError } from "./vault";

/** Return a localizable explanation without exposing private content or raw errors. */
export function cacheFailureReason(error: unknown): string {
  if (error instanceof ContentCacheError) {
    if (error.code === "size") return "Översikten ryms inte i den krypterade cachen. Välj färre repositories och försök igen.";
    if (error.code === "compression") return "Webbläsaren kunde inte komprimera översikten. Uppdatera webbläsaren och försök igen.";
  }
  let cause = error;
  for (let depth = 0; depth < 8 && cause instanceof Error; depth++, cause = cause.cause) {
    if (cause.name === "QuotaExceededError") return "Webbläsarens lagringsutrymme räcker inte till. Frigör utrymme och försök igen.";
  }
  return "Webbläsaren kunde inte skriva till den säkra lagringen. Kontrollera webbplatsens lagringsbehörigheter och försök igen.";
}
