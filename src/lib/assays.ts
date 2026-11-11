import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { fail, identifier, identifiers, integer, object, only, readJson } from "./assay-http";
import { assaySchema } from "./assay-schema";
import { inspectCohort } from "./cohort";
const META_PATH = "/generic-assay-meta/fetch";
export function handlesAssays(path: string) {
  return path.startsWith("/generic-assay-meta/") || path.startsWith("/generic_assay_data/") || path.startsWith("/session/virtual_study/") || path === "/cohorts/inspect" || path === "/capabilities/generic-assays";
}
function decoded(value: string): string {
  try { return identifier(decodeURIComponent(value)); } catch { fail("Invalid encoded cBioPortal identifier"); }
}
function selection(request: Parameters<ApiFetchFn>[0]) {
  const params = request.params ?? {};
  const dataMatch = request.path.match(/^\/generic_assay_data\/([^/]+)\/fetch$/);
  const metaMatch = request.path.match(/^\/generic-assay-meta\/([^/]+)$/);
  const post = request.path === META_PATH || !!dataMatch;
  if (!post && !metaMatch) fail("Unsupported generic-assay operation", 404);
  if (request.method.toUpperCase() !== (post ? "POST" : "GET") || (!post && request.body !== undefined)) fail("Unsupported generic-assay HTTP method/body", 405);
  only(params, request.path === META_PATH ? ["projection", "pageSize", "pageNumber", "searchTerm"] : ["projection"]);
  const projection = params.projection ?? "DETAILED";
  if (!["SUMMARY", "DETAILED"].includes(String(projection))) fail("Use SUMMARY or DETAILED to retain data; ID/META projections are not supported by these helpers");
  const query: Record<string, unknown> = {projection};
  let body: Record<string, unknown> | undefined;
  let profile: string | undefined;
  if (dataMatch) {
    profile = decoded(dataMatch[1]);
    body = object(request.body); only(body, ["sampleIds", "genericAssayStableIds"]);
    body = {sampleIds: identifiers(body.sampleIds, 100), genericAssayStableIds: identifiers(body.genericAssayStableIds, 25)};
  } else if (post) {
    body = object(request.body); only(body, ["molecularProfileIds", "genericAssayStableIds"]);
    if ((body.molecularProfileIds === undefined) === (body.genericAssayStableIds === undefined)) fail("Choose molecularProfileIds or genericAssayStableIds, not both");
    const field = body.molecularProfileIds === undefined ? "genericAssayStableIds" : "molecularProfileIds";
    body = {[field]: identifiers(body[field], 100)};
    query.pageSize = integer(params.pageSize ?? 25, "pageSize", 1, 100);
    query.pageNumber = integer(params.pageNumber ?? 0, "pageNumber", 0, 100_000);
    if (params.searchTerm !== undefined) {
      if (typeof params.searchTerm !== "string" || params.searchTerm.length > 200) fail("searchTerm must be a string of at most 200 characters");
      query.searchTerm = params.searchTerm;
    }
  } else profile = decoded(metaMatch![1]);
  const path = dataMatch ? `/generic_assay_data/${encodeURIComponent(profile!)}/fetch` : post ? META_PATH : `/generic-assay-meta/${encodeURIComponent(profile!)}`;
  return {path, method: post ? "POST" : "GET", query, body, profile, data: !!dataMatch};
}
async function performRead(request: Parameters<ApiFetchFn>[0], receipt: {value?: Awaited<ReturnType<typeof readJson>>}) {
  if (request.path === "/cohorts/inspect") {
    if (request.method.toUpperCase() !== "POST" || Object.keys(request.params ?? {}).length) fail("Local cohort inspection requires POST without query parameters", 405);
    return {status: 200, data: await inspectCohort(request.body, "user_definition")};
  }
  if (request.path.startsWith("/session/virtual_study/")) {
    return await readVirtualStudy(request, receipt);
  }
  if (request.path === "/capabilities/generic-assays") {
    if (request.method.toUpperCase() !== "GET" || request.body !== undefined || Object.keys(request.params ?? {}).length) fail("Capability discovery requires GET without parameters", 405);
    const result = await readJson("/v3/api-docs");
    receipt.value = result;
    return {status: 200, data: {...assaySchema(result.data), _cbioportal: result.meta}};
  }
  const chosen = selection(request);
  const result = await readAssayRecords(chosen, receipt);
  return {status: 200, data: {records: result.data, _cbioportal: {...result.meta, request: {path: chosen.path, query: chosen.query, body: chosen.body}, molecular_profile_id: chosen.profile,
    returned_rows: result.data.length, complete: false,
    next_page: chosen.path === META_PATH && result.data.length === chosen.query.pageSize && Number(chosen.query.pageNumber) < 100_000 ? Number(chosen.query.pageNumber) + 1 : null,
    interpretation: "Values retain strings, censoring (< or >), categories and missing-value markers; no numeric coercion or aggregation. Preserve entity/profile/study/sample/patient identities and patientLevel. Fetch profile and entity metadata before interpreting units, sort order or thresholds. Missing records are not negative measurements; this is a bounded selection, not a whole cohort.",
  }}};
}

async function readVirtualStudy(request: { method: string; path: string; params?: Record<string, unknown>; body?: unknown; }, receipt: { value?: Awaited<ReturnType<typeof readJson>>; }) {
  if (request.method.toUpperCase() !== "GET" || request.body !== undefined || Object.keys(request.params ?? {}).length) fail("Virtual studies are read-only GET operations", 405);
  const id = decoded(request.path.slice("/session/virtual_study/".length));
  const result = await readJson(`/session/virtual_study/${encodeURIComponent(id)}`);
  receipt.value = result;
  const envelope = object(result.data, 502);
  if (envelope.id !== undefined && envelope.id !== id) fail("Virtual-study response ID does not match request", 502);
  let cohort: Awaited<ReturnType<typeof inspectCohort>>;
  try { cohort = await inspectCohort(envelope.data, "public_session"); }
  catch { fail("Provider returned an invalid virtual-study definition", 502); }
  return { status: 200, data: { session: envelope, ...cohort, _cbioportal: { ...result.meta, requested_virtual_study_id: id } } };
}

async function readAssayRecords(chosen: { path: string; method: string; query: Record<string, unknown>; body: Record<string, unknown> | undefined; profile: string | undefined; data: boolean; }, receipt: { value?: Awaited<ReturnType<typeof readJson>>; }) {
  const result = await readJson(chosen.path, chosen.method, chosen.query, chosen.body);
  receipt.value = result;
  if (!Array.isArray(result.data)) fail("Expected cBioPortal assay records", 502);
  if (chosen.path === META_PATH && result.data.length > Number(chosen.query.pageSize)) fail("Assay metadata exceeded requested page size", 502);
  if (chosen.data && result.data.length > 2500) fail("Assay response exceeds the selected matrix bound", 502);
  for (const value of result.data) {
    const row = object(value, 502);
    if (chosen.data) {
      if (row.patientLevel !== undefined && typeof row.patientLevel !== "boolean") fail("Invalid patientLevel flag", 502);
      if (row.molecularProfileId !== chosen.profile || typeof row.genericAssayStableId !== "string" || !(chosen.body!.genericAssayStableIds as string[]).includes(row.genericAssayStableId) || typeof row.value !== "string" || typeof row.studyId !== "string" || typeof row.patientId !== "string") fail("Assay response has invalid identity or value fields", 502);
      const selectedCases = chosen.body!.sampleIds as string[];
      const matches = (typeof row.sampleId === "string" && selectedCases.includes(row.sampleId)) || (row.patientLevel === true && selectedCases.includes(String(row.patientId)));
      if (!matches) fail("Assay returned an unrequested sample/patient identifier", 502);
    } else {
      if (typeof row.stableId !== "string") fail("Assay metadata omitted stableId", 502);
      if (chosen.body?.genericAssayStableIds && !(chosen.body.genericAssayStableIds as string[]).includes(row.stableId)) fail("Unrequested assay metadata identifier", 502);
    }
  }
  return { ...result, data: result.data };
}

/** Invalid provider shapes retain the native representation and its receipt for diagnosis. */
export async function assayRead(request: Parameters<ApiFetchFn>[0]) {
  const receipt: {value?: Awaited<ReturnType<typeof readJson>>} = {};
  try { return await performRead(request, receipt); }
  catch (error) {
    if (receipt.value && error instanceof Error && !("data" in error))
      Object.assign(error, {data: {native: receipt.value.data, _cbioportal: receipt.value.meta}});
    throw error;
  }
}
