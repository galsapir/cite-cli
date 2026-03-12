// ABOUTME: Tests for the fetch timeout wrapper.
// ABOUTME: Verifies timeout behavior and error wrapping.

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithTimeout } from "../src/lib/fetch-with-timeout.js";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through a successful fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("ok", { status: 200 })),
    );
    const resp = await fetchWithTimeout("https://example.com");
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("ok");
  });

  it("throws descriptive error on timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            // Simulate: when signal aborts, reject with AbortError
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }),
      ),
    );

    await expect(fetchWithTimeout("https://slow.example.com", {}, 50)).rejects.toThrow(
      /timed out after 50ms/i,
    );
  });

  it("forwards request init options", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await fetchWithTimeout("https://example.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});
