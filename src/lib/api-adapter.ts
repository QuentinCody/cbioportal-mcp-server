import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { assayRead, handlesAssays } from "./assays";
import { cbioportalFetch, cbioportalPost } from "./http";
import { readCbioportal } from "./read";
import { cbioportalCompleteness } from "./completeness";

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
        if (handlesAssays(request.path)) {
            const result = await assayRead(request);
            return { ...result, completeness: cbioportalCompleteness(result.data) };
        }
        let response: Response;

        if (request.method !== "POST") {
            assertStudiesProjectionReturnsRows(request.path, request.params);
        }

        if (request.method === "POST") {
            response = await cbioportalPost(request.path, request.body as object, undefined, request.params);
        } else {
            response = await cbioportalFetch(request.path, request.params);
        }

        const result = await readCbioportal(response);
        return { status: result.status, data: result.data, completeness: cbioportalCompleteness(result.data) };
    };
}
