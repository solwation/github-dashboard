import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub release assets (#448)", () => {
  it("resolves private release assets via API and fetches with application/octet-stream", async () => {
    const releases = [
      {
        id: 101,
        tag_name: "issue-screenshots",
        draft: true,
        assets: [
          {
            id: 202,
            name: "issue-3488-before-1280.png",
            url: "https://api.github.com/repos/solwation/untappdbolaget/releases/assets/202",
            browser_download_url: "https://github.com/solwation/untappdbolaget/releases/download/untagged-abc123/issue-3488-before-1280.png",
          },
        ],
      },
    ];

    const binaryData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
    const fetchMock = vi.fn()
      // 1. Fetch releases list
      .mockResolvedValueOnce(new Response(JSON.stringify(releases), { status: 200, headers: { "Content-Type": "application/json" } }))
      // 2. Fetch binary asset stream
      .mockResolvedValueOnce(new Response(binaryData, { status: 200, headers: { "Content-Type": "application/octet-stream" } }));

    vi.stubGlobal("fetch", fetchMock);
    const api = new GitHub("test-token");

    const result = await api.releaseAsset(
      "solwation/untappdbolaget",
      "issue-3488-before-1280.png",
      "https://github.com/solwation/untappdbolaget/releases/download/untagged-abc123/issue-3488-before-1280.png",
    );

    expect(result).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call: list releases
    expect(fetchMock.mock.calls[0]![0].href).toBe("https://api.github.com/repos/solwation/untappdbolaget/releases?per_page=100");
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer test-token");

    // Second call: download asset binary
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.github.com/repos/solwation/untappdbolaget/releases/assets/202");
    expect(fetchMock.mock.calls[1]![1].headers.Accept).toBe("application/octet-stream");
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe("Bearer test-token");

    // Repeated call should use cache and not invoke fetch again
    const cached = await api.releaseAsset("solwation/untappdbolaget", "issue-3488-before-1280.png");
    expect(cached).toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when release asset is missing or request fails", async () => {
    const releases = [
      {
        id: 101,
        tag_name: "v1.0.0",
        draft: false,
        assets: [
          {
            id: 205,
            name: "other-file.zip",
            url: "https://api.github.com/repos/owner/repo/releases/assets/205",
            browser_download_url: "https://github.com/owner/repo/releases/download/v1.0.0/other-file.zip",
          },
        ],
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(releases), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new GitHub("test-token");

    const missing = await api.releaseAsset("owner/repo", "non-existent.png");
    expect(missing).toBeNull();
  });
});
