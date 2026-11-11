import { afterEach, expect, it, vi } from "vitest";
import { readCbioportal } from "./read";
import { readJson } from "./assay-http";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([
  new Response("<html>unavailable</html>"),
  new Response("{bad", { headers: { "content-type": "application/json" } }),
  new Response('{"hits":[]}', { status: 206, headers: { "content-type": "application/json", "content-range": "bytes 0-10/40" } }),
])("rejects non-JSON, malformed and partial success without inventing no-match results", async response => {
  await expect(readCbioportal(response)).rejects.toMatchObject({ status: 502, data: expect.any(String) });
});

it("bounds actual response bytes and rejects malformed UTF-8 while preserving native HTTP status", async () => {
  await expect(readCbioportal(new Response("x".repeat(4 * 1024 * 1024 + 1)))).rejects.toMatchObject({ status: 413, data: { body_unavailable: true } });
  await expect(readCbioportal(new Response(new Uint8Array([0xff]), { status: 429, headers: { "retry-after": "12" } }))).rejects.toMatchObject({ status: 429, data: { http_status: 429, retry_after: "12", body_unavailable: true } });
});

it("enforces the body deadline even when stream cancellation does not settle", async () => {
  vi.useFakeTimers();
  const stream = new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) });
  const pending = expect(readCbioportal(new Response(stream, { status: 503 }))).rejects.toMatchObject({ status: 503, data: { body_unavailable: true } });
  await vi.advanceTimersByTimeAsync(10001); await pending;
});

it.each([[new DOMException("timeout", "TimeoutError"), 504], [new TypeError("network unavailable"), 502]])("classifies missing upstream responses without inventing an HTTP response %#", async (error, status) => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  await expect(readJson("/generic-assay-meta/profile")).rejects.toMatchObject({status, data: {http_status: null, body_unavailable: true, source_url: "https://www.cbioportal.org/api/generic-assay-meta/profile"}});
});
