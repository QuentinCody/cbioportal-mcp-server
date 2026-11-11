import { readCbioportal } from "./read";
export const CBIO_INSTANCE = "https://www.cbioportal.org";
export function fail(message: string, status = 400): never { throw Object.assign(new Error(message), {status}); }
export function object(value: unknown, status = 400): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected a JSON object", status);
  return value as Record<string, unknown>;
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 300 || (/[ /\\?#]/.test(value) || Array.from(value).some(char => char.charCodeAt(0) < 32)) || value === "." || value === "..") fail("Invalid cBioPortal identifier");
  return value;
}
export function identifiers(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || !value.length || value.length > max) fail(`Supply 1–${max} explicit identifiers`);
  return value.map(identifier);
}
export function only(input: Record<string, unknown>, keys: string[]) {
  for (const key of Object.keys(input)) if (!keys.includes(key)) fail(`Unsupported parameter ${key}`);
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
export async function hash(text: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
}
export async function readJson(path: string, method = "GET", params: Record<string, unknown> = {}, body?: unknown) {
  const url = new URL(`/api${path}`, CBIO_INSTANCE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response: Response;
  try {
    response = await fetch(url, {method, headers: {Accept: "application/json", "Content-Type": "application/json"}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000), redirect: "manual"});
  } catch (error) {
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw Object.assign(new Error(timedOut ? "cBioPortal request timed out" : "cBioPortal request failed before a response was received"), {
      status: timedOut ? 504 : 502, data: {source_url: url.toString(), method, http_status: null, body_unavailable: true},
    });
  }
  const { data, raw } = await readCbioportal(response);
  return {data, meta: {instance: CBIO_INSTANCE, source_url: url.toString(), retrieved_at: new Date().toISOString(), response_sha256: await hash(raw), total_count: response.headers.get("total-count"), snapshot_version: null}};
}
