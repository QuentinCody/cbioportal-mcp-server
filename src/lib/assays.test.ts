import { afterEach, describe, expect, it, vi } from "vitest";
import contract from "./assay-contract.fixture.json";
import { createCbioportalApiFetch } from "./api-adapter";
import { inspectCohort } from "./cohort";
const api = createCbioportalApiFetch();
const path = "/generic_assay_data/study_assay/fetch";
const row = {molecularProfileId: "study_assay", genericAssayStableId: "drug1", sampleId: "S1", patientId: "P1", studyId: "study", value: ">8.00", patientLevel: false, uniqueSampleKey: "study:S1", uniquePatientKey: "study:P1"};
function mock(data: unknown, headers = {}) { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {headers: {"content-type": "application/json", ...headers}}))); }
const read = (body: unknown = {sampleIds: ["S1"], genericAssayStableIds: ["drug1"]}, params = {}) => api({method: "POST", path, body, params});
afterEach(() => vi.unstubAllGlobals());
describe("generic-assay reads", () => {
  it("retains the observed provider fields and source-qualified identity", async () => {
    for (const field of contract.schemas.GenericAssayData.required) expect(row).toHaveProperty(field);
    mock([row]);
    expect((await read()).data).toMatchObject({records: [row], _cbioportal: {instance: "https://www.cbioportal.org", complete: false, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}});
    const call = vi.mocked(fetch).mock.calls[0];
    expect(String(call[0])).toBe("https://www.cbioportal.org/api/generic_assay_data/study_assay/fetch?projection=DETAILED");
    expect(JSON.parse(String(call[1]?.body))).toEqual({sampleIds: ["S1"], genericAssayStableIds: ["drug1"]});
  });
  it.each(["<0.01", "0", "NA", "", "Loss", "true"])("preserves native value %j", async value => {
    mock([{...row, value}]); expect((await read()).data).toMatchObject({records: [{value}]});
  });
  it("preserves patient-level results without relabeling patients as samples", async () => {
    mock([{...row, patientLevel: true, sampleId: "", patientId: "P1"}]);
    expect((await read({sampleIds: ["P1"], genericAssayStableIds: ["drug1"]})).data).toMatchObject({records: [{patientLevel: true, patientId: "P1", sampleId: ""}]});
  });
  it.each([{...row, molecularProfileId: "other"}, {...row, sampleId: "S9"}, {...row, genericAssayStableId: "drug9"}, {...row, value: 8}])("rejects inconsistent assay identity/value %#", async record => {
    mock([record]); await expect(read()).rejects.toMatchObject({status: 502});
  });
  it.each([{sampleIds: [], genericAssayStableIds: ["drug1"]}, {sampleIds: ["S1"], genericAssayStableIds: []}, {sampleListId: "study_all", genericAssayStableIds: ["drug1"]}, {sampleIds: Array(101).fill("S1"), genericAssayStableIds: ["drug1"]}, {sampleIds: ["S1"], genericAssayStableIds: Array(26).fill("drug1")}])("rejects unbounded/invalid selection before fetch %#", async body => {
    mock([]); await expect(read(body)).rejects.toMatchObject({status: 400}); expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves paged metadata, units and censored-value context", async () => {
    const data = [{stableId: "drug1", entityType: "GENERIC_ASSAY", genericEntityMetaProperties: {NAME: "Drug", DESCRIPTION: "IC50 in micromolar", URL: "https://example.org/assay"}}];
    mock(data, {"total-count": "17"});
    const result = await api({method: "POST", path: "/generic-assay-meta/fetch", params: {pageSize: 1, pageNumber: 2, searchTerm: "Drug + IC50", projection: "DETAILED"}, body: {molecularProfileIds: ["study_assay"]}});
    expect(result.data).toMatchObject({records: data, _cbioportal: {next_page: 3, total_count: "17"}});
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get("searchTerm")).toBe("Drug + IC50");
  });
  it("rejects ambiguous metadata filters", async () => {
    mock([]);
    await expect(api({method: "POST", path: "/generic-assay-meta/fetch", body: {molecularProfileIds: ["a"], genericAssayStableIds: ["b"]}})).rejects.toThrow("Choose");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains metadata from a single-profile GET", async () => {
    mock([{stableId: "drug1", genericEntityMetaProperties: {NAME: "Drug"}}]);
    expect((await api({method: "GET", path: "/generic-assay-meta/study_assay"})).data).toMatchObject({records: [{stableId: "drug1"}], _cbioportal: {molecular_profile_id: "study_assay"}});
  });
  it("rejects empty metadata projections", async () => {
    mock([]); await expect(read(undefined, {projection: "META"})).rejects.toThrow("SUMMARY"); expect(fetch).not.toHaveBeenCalled();
  });
  it("discovers capabilities from the actual fixed instance schema", async () => {
    const native = {post: {description: "observed", requestBody: {$ref: "#/components/schemas/GenericAssayFilter"}, responses: {200: {$ref: "#/components/schemas/GenericAssayData"}}}};
    mock({openapi: "3.1.0", info: {version: "beta"}, paths: {"/api/generic_assay_data/{molecularProfileId}/fetch": native, "/api/unrelated": {}}, components: {schemas: contract.schemas}});
    expect((await api({method: "GET", path: "/capabilities/generic-assays"})).data).toMatchObject({paths: {"/api/generic_assay_data/{molecularProfileId}/fetch": native}, schemas: {GenericAssayFilter: contract.schemas.GenericAssayFilter, GenericAssayData: contract.schemas.GenericAssayData}});
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("https://www.cbioportal.org/api/v3/api-docs");
  });
  it("does not pretend an unsupported instance exposes assays", async () => {
    mock({paths: {}, components: {schemas: {}}});
    await expect(api({method: "GET", path: "/capabilities/generic-assays"})).rejects.toThrow("does not advertise");
  });
  it("preserves query options on existing POST routes", async () => {
    mock([]);
    await api({method: "POST", path: "/genes/fetch", body: ["TP53"], params: {geneIdType: "HUGO_GENE_SYMBOL", projection: "DETAILED"}});
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get("geneIdType")).toBe("HUGO_GENE_SYMBOL"); expect(url.searchParams.get("projection")).toBe("DETAILED");
  });
  it("retains the existing studies projection guard", async () => {
    mock([]); await expect(api({method: "GET", path: "/studies", params: {projection: "ID"}})).rejects.toThrow("EMPTY array"); expect(fetch).not.toHaveBeenCalled();
  });
});
describe("read-only virtual cohorts", () => {
  it("qualifies sample identities by study and never counts patients", async () => {
    const definition = {name: "cohort", studies: [{id: "a", samples: ["S1", "S1"]}, {id: "b", samples: ["S1"]}], studyViewFilter: {futureFilter: {retain: true}}};
    mock({});
    const result = await api({method: "POST", path: "/cohorts/inspect", body: definition});
    expect(result.data).toMatchObject({definition, _cohort: {membership_mode: "static_declared", declared_sample_entries: 3, distinct_declared_sample_pairs: 2, members: [{studyId: "a", sampleId: "S1"}, {studyId: "b", sampleId: "S1"}], membership_verified: false, patient_count: null, evaluated_filters: false}});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not confuse declared samples with resolved dynamic membership", async () => {
    const definition = {name: "dynamic", dynamic: true, studies: [{id: "a", samples: ["old"]}], studyViewFilter: {clinicalDataFilters: [{attributeId: "MSI", values: [{value: "high"}]}]}};
    expect(await inspectCohort(definition, "user_definition")).toMatchObject({definition, _cohort: {membership_mode: "dynamic_unresolved", members: null, declared_sample_entries: 1, evaluated_filters: false}});
  });
  it.each([{name: "bad", studies: [{id: "a"}]}, {name: "bad", dynamic: true, studies: [{id: "a"}]}, {name: "bad", dynamic: "false", studies: []}, {name: "bad", studies: []}])("rejects invalid static/dynamic shape %#", async definition => {
    await expect(inspectCohort(definition, "user_definition")).rejects.toThrow();
  });
  it("reads existing sessions without modifying or flattening their definition", async () => {
    const session = {id: "abc", data: {name: "cohort", studies: [{id: "a", samples: ["S1"]}], futureProperty: "retained"}};
    mock(session);
    expect((await api({method: "GET", path: "/session/virtual_study/abc"})).data).toMatchObject({session, definition: session.data, _cohort: {origin: "public_session"}});
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("GET");
  });
  it("refuses session writes", async () => {
    mock({}); await expect(api({method: "POST", path: "/session/virtual_study/abc", body: {}})).rejects.toMatchObject({status: 405}); expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses encoded path traversal or extra path segments", async () => {
    mock({}); await expect(api({method: "GET", path: "/session/virtual_study/%2e%2e%2fother"})).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
});
it("rejects oversized responses and HTTP failures without returning false empty cohorts", async () => {
  mock({padding: "x".repeat(4 * 1024 * 1024)}); await expect(read()).rejects.toThrow("exceeds 4 MiB");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private", {status: 403})));
  await expect(api({method: "GET", path: "/session/virtual_study/abc"})).rejects.toMatchObject({status: 403});
});
