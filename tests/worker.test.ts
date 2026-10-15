import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../auth/worker";
const env = {
  GITHUB_CLIENT_ID: "public-id",
  GITHUB_CLIENT_SECRET: "test-secret",
  ALLOWED_ORIGIN: "https://example.github.io",
  REDIRECT_URI: "https://example.github.io/board/",
};
const request = (
  origin = env.ALLOWED_ORIGIN,
  body: unknown = { code: "code", code_verifier: "a".repeat(43) },
) =>
  new Request("https://auth.example.com/exchange", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllGlobals());
describe("OAuth exchange", () => {
  it("rejects unexpected origins and missing PKCE verifier before contacting GitHub", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (await worker.fetch(request("https://attacker.example"), env)).status,
    ).toBe(403);
    expect(
      (await worker.fetch(request(env.ALLOWED_ORIGIN, { code: "x" }), env))
        .status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses fixed callback and server credentials, returns only access token and never refresh token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "test-access",
            refresh_token: "test-refresh",
            client_secret: "test-secret",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ access_token: "test-access" });
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.redirect_uri).toBe(env.REDIRECT_URI);
    expect(body.code_verifier).toHaveLength(43);
  });
});
