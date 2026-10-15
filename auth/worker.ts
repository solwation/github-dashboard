interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_ORIGIN: string;
  REDIRECT_URI: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    };
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });
    if (request.headers.get("Origin") !== env.ALLOWED_ORIGIN)
      return new Response("Forbidden", { status: 403 });
    if (new URL(request.url).pathname !== "/exchange")
      return json({ error: "Not found" }, 404);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return json({ error: "JSON required" }, 415);
    try {
      const { code, code_verifier } = (await request.json()) as {
        code: unknown;
        code_verifier: unknown;
      };
      if (
        typeof code !== "string" ||
        !code ||
        code.length > 256 ||
        typeof code_verifier !== "string" ||
        !/^[a-zA-Z0-9._~-]{43,128}$/.test(code_verifier)
      )
        return json({ error: "Invalid request" }, 400);
      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            code_verifier,
            redirect_uri: env.REDIRECT_URI,
          }),
        },
      );
      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!response.ok || !data.access_token)
        return json({ error: "Authorization failed" }, 401);
      return json({
        access_token: data.access_token,
        expires_in: data.expires_in,
      });
    } catch {
      return json({ error: "Authorization failed" }, 400);
    }
  },
};
