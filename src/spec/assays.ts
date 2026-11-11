import type { ApiCatalog, WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";
const profile = [{name: "molecularProfileId", type: "string" as const, required: true, description: "Exact ID discovered from the study's molecular profiles; do not construct suffixes"}];
const projection = [{name: "projection", type: "string" as const, required: false, enum: ["SUMMARY", "DETAILED"], description: "Default DETAILED; ID/META are excluded because these helpers retain full identity/value context"}];
export const assayEndpoints: ApiCatalog["endpoints"] = [
  {method: "GET", path: "/molecular-profiles/{molecularProfileId}", category: "generic_assay", summary: "Read one discovered molecular profile, including native datatype, genericAssayType, patientLevel, pivotThreshold and sortOrder. Profile configuration does not establish measurement coverage or clinical cutoffs.", pathParams: profile},
  {method: "GET", path: "/capabilities/generic-assays", category: "generic_assay", summary: "Local discovery helper: fetch this public instance's live OpenAPI and retain generic-assay paths/schemas and schema hash. Advertised capabilities do not prove dataset coverage."},
  {method: "GET", path: "/generic-assay-meta/{molecularProfileId}", category: "generic_assay", summary: "Entity metadata for one molecular profile, preserving entityType and genericEntityMetaProperties. Unpaged provider route, bounded by response size/time; use POST fetch for paged discovery.", pathParams: profile, queryParams: projection},
  {method: "POST", path: "/generic-assay-meta/fetch", category: "generic_assay", summary: "Paged generic-assay entity metadata by explicit profile IDs OR entity stable IDs. Returns records plus _cbioportal provenance/paging.",
    queryParams: [...projection, {name: "pageSize", type: "number", required: false, description: "1–100, default 25"}, {name: "pageNumber", type: "number", required: false, description: "0–100000, default 0"}, {name: "searchTerm", type: "string", required: false, description: "Optional keyword, at most 200 characters"}],
    body: {contentType: "application/json", description: "Exactly one of {molecularProfileIds: string[]} or {genericAssayStableIds: string[]}; 1–100 IDs"}},
  {method: "POST", path: "/generic_assay_data/{molecularProfileId}/fetch", category: "generic_assay", summary: "Bounded generic-assay matrix subset. Returns native value strings (including censoring, categories and NA), source identity and patientLevel. Obtain profile/entity metadata separately before interpreting values.", pathParams: profile, queryParams: projection,
    body: {contentType: "application/json", description: "{sampleIds: string[] (1–100), genericAssayStableIds: string[] (1–25)}. Explicit cases required; sampleListId and unbounded whole-profile selection are excluded. Split larger selections into explicit batches. Preserve patient-level case semantics."}},
  {method: "GET", path: "/session/virtual_study/{virtualStudyId}", category: "cohorts", summary: "Read an existing accessible virtual-study session from the public instance. Preserve complete definition and classify static declared membership versus unresolved dynamic filters. No membership recomputation or writes.",
    pathParams: [{name: "virtualStudyId", type: "string", required: true, description: "Known virtual-study session ID; access depends on instance permissions"}]},
  {method: "POST", path: "/cohorts/inspect", category: "cohorts", summary: "Local read-only inspection of a supplied virtual-study definition; no request leaves the Worker. Preserves filters and study-qualified sample pairs. This does not validate cohort existence, profiling coverage or every instance-specific filter.",
    body: {contentType: "application/json", description: "Virtual-study data object: {name, studies:[{id, samples:[...]}], dynamic?:boolean, studyViewFilter?:object, ...}. Static entries require samples; dynamic requires studyViewFilter. At most 100 studies/100000 sample entries/4 MiB."}},
];
export const assayWorkflows: WorkflowRecipe[] = [
  {title: "Discover cBioPortal generic-assay profiles and entity metadata", keywords: ["generic assay", "metadata", "profile", "treatment", "signature"],
    description: "Discover profiles from a chosen study. Inspect datatype, patientLevel, genericAssayType, pivotThreshold and sortOrder before choosing entities/cases. The first generic profile is an exploration example, not automatic assay equivalence.",
    code: `const studyId = "brca_tcga"; // replace with the selected study
const profiles = await api.get("/studies/" + encodeURIComponent(studyId) + "/molecular-profiles");
if (profiles.__api_error || profiles.__stage_error || profiles.__staged) return profiles;
if (!Array.isArray(profiles)) throw new Error("Expected molecular profile array");
const candidates = profiles.filter(p => p.molecularAlterationType === "GENERIC_ASSAY");
if (!candidates.length) return {studyId, profiles, genericProfiles: [], complete: false};
const selectedProfile = candidates[0];
const entities = await api.post("/generic-assay-meta/fetch", {molecularProfileIds: [selectedProfile.molecularProfileId]}, {projection: "DETAILED", pageSize: 25, pageNumber: 0});
return {studyId, profiles, selectedProfile, entities, complete: false};`},
  {title: "Inspect a cBioPortal cohort definition without publishing", keywords: ["virtual study", "cohort", "static", "dynamic", "sample", "patient"],
    description: "Use a UI-exported data object in place of the example. Local structural inspection preserves filters and separates study-qualified samples from patients. Dynamic membership remains unresolved.",
    code: `const definition = {name: "Example declared cohort", studies: [{id: "brca_tcga", samples: ["TCGA-AR-A1AI-01"]}]}; // replace with the exported definition
return await api.post("/cohorts/inspect", definition);`},
  {title: "Read a selected cBioPortal assay with profile and entity context", keywords: ["generic assay", "patientLevel", "measurement", "units", "context"],
    description: "Native patient-level example; replace explicit IDs with discovered selections. Preserves profile thresholds/sort order, entity metadata and native value strings. This study uses identical sample/patient IDs; it does not establish interchangeability in other studies. Empty rows are not negative measurements.",
    code: `const profileId = "pog570_bcgsc_2020_immune_cell_signature";
const sampleIds = ["14891"], genericAssayStableIds = ["Neutrophils"];
const profile = await api.get("/molecular-profiles/" + encodeURIComponent(profileId));
if (profile.__api_error || profile.__stage_error || profile.__staged) return profile;
const entities = await api.post("/generic-assay-meta/fetch", {genericAssayStableIds}, {projection: "DETAILED", pageSize: 25, pageNumber: 0});
if (entities.__api_error || entities.__stage_error || entities.__staged) return {profile, entities, complete: false};
const measurements = await api.post("/generic_assay_data/" + encodeURIComponent(profileId) + "/fetch", {sampleIds, genericAssayStableIds}, {projection: "DETAILED"});
return {profile, entities, measurements, complete: false};`},
];
