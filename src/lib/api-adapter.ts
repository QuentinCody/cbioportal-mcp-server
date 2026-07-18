import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { cbioportalFetch, cbioportalPost } from "./http";

/**
 * cBioPortal answers GET /studies?projection=ID with 200 + an empty array — the
 * ID projection is simply not wired up for this endpoint (it works on
 * /cancer-types, /genes, /gene-panels). projection=META likewise returns an
 * empty body and reports its count only in the total-count header, which this
 * adapter drops. Either one hands the caller [] for "list the studies", which
 * reads as "cBioPortal is empty" rather than as the param mistake it is.
 * Verified live 2026-07-16. Remove a value here if cBioPortal implements it.
 */
const STUDIES_EMPTY_PROJECTIONS = new Set(["ID", "META"]);

function assertStudiesProjectionReturnsRows(
    path: string,
    params?: Record<string, unknown>,
): void {
    if (!/^\/studies\/?$/.test(path)) return;
    const projection = params?.projection;
    if (typeof projection !== "string") return;
    const value = projection.toUpperCase();
    if (!STUDIES_EMPTY_PROJECTIONS.has(value)) return;
    const err = new Error(
        `cBioPortal returns an EMPTY array for GET /studies?projection=${value}, so this call would report zero studies whatever the index actually holds. Refusing rather than answering '[]'. Use projection:'SUMMARY' (or 'DETAILED') and read .studyId from each row.`,
    ) as Error & { status: number };
    err.status = 400;
    throw err;
}

export function createCbioportalApiFetch(): ApiFetchFn {
    return async (request) => {
        let response: Response;

        if (request.method !== "POST") {
            assertStudiesProjectionReturnsRows(request.path, request.params);
        }

        if (request.method === "POST") {
            response = await cbioportalPost(request.path, request.body as object);
        } else {
            response = await cbioportalFetch(request.path, request.params);
        }

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
                status: number;
                data: unknown;
            };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();
            return { status: response.status, data: text };
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}
