import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const CBIOPORTAL_BASE = "https://www.cbioportal.org/api";

export interface CbioportalFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the cBioPortal REST API.
 */
export async function cbioportalFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: CbioportalFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? CBIOPORTAL_BASE;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "cbioportal-mcp-server/1.0 (bio-mcp)",
    });
}

/**
 * POST to cBioPortal API (for fetch endpoints that require body).
 */
export async function cbioportalPost(
    path: string,
    body: object,
    opts?: CbioportalFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? CBIOPORTAL_BASE;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, undefined, {
        ...opts,
        method: "POST",
        headers,
        body,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "cbioportal-mcp-server/1.0 (bio-mcp)",
    });
}
