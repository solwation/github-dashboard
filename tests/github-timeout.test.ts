import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";
import { setLanguage, t } from "../src/lib/i18n";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setLanguage("auto");
});

describe("GitHub response body deadline (#414)", () => {
  it.each([200, 401, 403, 500])("aborts a stalled %i body without reporting an authentication error", async (status) => {
    vi.useFakeTimers();
    setLanguage("en");
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => {
      signal = init.signal!;
      const body = new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => {
            controller.error(new DOMException("The operation was aborted.", "AbortError"));
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status }));
    }));
    let settled = false;
    const result = new GitHub("test-token").request("/user").catch((error: unknown) => error)
      .finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(signal.reason);
    expect(signal.reason.message).toBe(t("Förfrågan tog för lång tid."));
    expect(signal.reason.status).toBeUndefined();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows a delayed JSON body and clears its deadline after parsing", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => {
      signal = init.signal!;
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) { stream = controller; },
      }), { headers: { etag: '"user"' } }));
    }));
    const client = new GitHub("test-token");
    const result = client.request("/user");
    await vi.advanceTimersByTimeAsync(29_000);
    stream.enqueue(new TextEncoder().encode('{"login":"example"}'));
    stream.close();
    expect(await result).toEqual({ data: { login: "example" }, next: null });
    expect(client.exportResponses()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal.aborted).toBe(false);
  });

  it("clears the deadline on a cached 304 without consuming a body", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const notModified = new Response(null, { status: 304 });
    const parse = vi.spyOn(notModified, "json");
    vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => {
      signals.push(init.signal!);
      return Promise.resolve(signals.length === 1
        ? new Response('{"login":"example"}', { headers: { etag: '"user"' } })
        : notModified);
    }));
    const client = new GitHub("test-token");
    const first = await client.request("/user");
    expect(await client.request("/user")).toEqual(first);
    expect(parse).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });

  it.each([200, 401])("clears the deadline after a malformed %i JSON body", async (status) => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => {
      signal = init.signal!;
      return Promise.resolve(new Response("invalid JSON", { status }));
    }));
    const error = await new GitHub("test-token").request("/user").catch((caught) => caught);
    if (status === 200) expect(error).toBeInstanceOf(SyntaxError);
    else expect(error).toMatchObject({ status: 401 });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal.aborted).toBe(false);
  });
});
