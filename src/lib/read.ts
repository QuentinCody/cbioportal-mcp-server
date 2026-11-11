import { decodeResponseText, readResponseBytes } from "@bio-mcp/shared/http/response-reader";

/** Retain complete native error bodies; never parse partial or unbounded representations. */
export async function readCbioportal(response: Response) {
  let raw: string;
  try {
    raw = decodeResponseText(await readResponseBytes(response, { label: "cBioPortal", maxBytes: 4 * 1024 * 1024, timeoutMs: 10000 }), "cBioPortal");
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? error.status : 502;
    const message = status === 413 ? "cBioPortal response exceeds 4 MiB; narrow selection" : status === 504 ? "cBioPortal body read exceeded 10 seconds" : String(error);
    throw Object.assign(new Error(message), { status: response.ok ? status : response.status,
      data: { http_status: response.status, body_unavailable: true, retry_after: response.headers.get("retry-after"), body_error: message } });
  }
  const fail = (message: string, status: number): never => { throw Object.assign(new Error(message), { status, data: raw }); };
  if (!response.ok) fail(`cBioPortal HTTP ${response.status}`, response.status);
  if (response.status !== 200 || response.headers.has("content-range")) fail("cBioPortal returned a partial representation", 502);
  if (!response.headers.get("content-type")?.includes("json")) fail("Expected cBioPortal JSON", 502);
  let data: unknown;
  try { data = JSON.parse(raw.replace(/^\uFEFF/, "")); }
  catch { fail("cBioPortal returned invalid JSON", 502); }
  return { status: response.status, data, raw };
}
