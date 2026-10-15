import { t } from "./i18n";
const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined;
const authUrl = import.meta.env.VITE_AUTH_URL as string | undefined;
export const oauthReady = Boolean(clientId && authUrl);
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const redirectUri = () => window.location.origin + window.location.pathname;
export async function login() {
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(
    "issueflow-oauth",
    JSON.stringify({ state, verifier, time: Date.now() }),
  );
  const challenge = encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri(),
    scope: "repo read:user",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.assign("https://github.com/login/oauth/authorize?" + params);
}
export async function callback(): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return null;
  const saved = sessionStorage.getItem("issueflow-oauth");
  sessionStorage.removeItem("issueflow-oauth");
  history.replaceState({}, "", redirectUri());
  if (params.has("error")) throw new Error(t("GitHub-inloggningen avbröts."));
  const pending = saved ? JSON.parse(saved) : null;
  if (
    !pending ||
    pending.state !== params.get("state") ||
    Date.now() - pending.time > 600000
  )
    throw new Error(t("Inloggningen kunde inte verifieras. Försök igen."));
  const response = await fetch(authUrl!.replace(/\/$/, "") + "/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: params.get("code"),
      code_verifier: pending.verifier,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token)
    throw new Error(t("GitHub-inloggningen misslyckades. Försök igen."));
  return data.access_token;
}
