import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { fixture, recover } from "./staging-fixture";
import native from "../lib/native-assays.fixture.json";
import { assayWorkflows } from "../spec/assays";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const padding = "β\"\\".repeat(6000);
async function invoke(f: ReturnType<typeof fixture>, name: string, args: unknown, failed = false) {
  const result = await f.tools[name].handler(args, {});
  expect(result.isError === true, JSON.stringify(result).slice(0, 1000)).toBe(failed);
  const sc = result.structuredContent; let original = sc; let materialized: unknown;
  if (sc.staged) { const full = await recover(f, sc.data_access_id, ""); materialized = full; original = full.structuredContent; }
  let data = original.data;
  if (data?.__staged) { data = await recover(f, data.data_access_id, ""); materialized ??= data; }
  const proof = await verifyCitationEnvelope({ citation: sc._meta.citation, structuredContent: sc, toolArguments: args, ...(materialized ? { materialized: { value: materialized } } : {}) });
  expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(30720);
  return { sc, data, id: original.data?.data_access_id ?? sc.data_access_id };
}

it.each(["", "mcp_"])("replays native patient-level values through %s generated Code Mode and real SQLite", async prefix => {
  const f = fixture();
  const rows = native.patient_values.map(row => ({ ...row, future: { text: padding } }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(rows)));
  try {
    const body = { sampleIds: [...new Set(rows.map(row => row.sampleId))], genericAssayStableIds: [...new Set(rows.map(row => row.genericAssayStableId))] };
    const r = await invoke(f, prefix + "cbioportal_execute", { code: `return await api.post('/generic_assay_data/${native.patient_profile.molecularProfileId}/fetch',${JSON.stringify(body)});` });
    expect(r.data.records).toEqual(rows);
    expect(r.sc._meta.completeness).toMatchObject({ complete: false, returned: rows.length });
    const sql = await invoke(f, prefix + "cbioportal_query_data", { data_access_id: r.id, sql: "SELECT sampleId,patientId,value,typeof(value) AS value_type,typeof(patientId) AS id_type FROM records ORDER BY _rowid" });
    expect(sql.data.rows).toEqual(rows.map(row => ({ sampleId: row.sampleId, patientId: row.patientId, value: row.value, value_type: "text", id_type: "text" })));
    await invoke(f, prefix + "cbioportal_get_schema", { data_access_id: r.id });
  } finally { f.close(); }
});

it("keeps native entity metadata and arbitrary value strings lossless in staged SQL", async () => {
  const f = fixture();
  const rows = ["0001", "0", "<0.01", ">8.00", "NA", "", "Loss", "true"].map(value => ({ ...native.patient_values[0], value, note: padding }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(rows)));
  try {
    const r = await invoke(f, "cbioportal_execute", { code: `return await api.post('/generic_assay_data/${native.patient_profile.molecularProfileId}/fetch',{sampleIds:['${rows[0].sampleId}'],genericAssayStableIds:['${rows[0].genericAssayStableId}']});` });
    const sql = await invoke(f, "cbioportal_query_data", { data_access_id: r.id, sql: "SELECT value FROM records ORDER BY _rowid" });
    expect(sql.data.rows.map((row: {value: string}) => row.value)).toEqual(rows.map(row => row.value));
    const meta = native.entity_metadata.map(row => ({ ...row, future: padding }));
    vi.mocked(fetch).mockImplementation(async () => Response.json(meta));
    const entities = await invoke(f, "cbioportal_execute", { code: "return await api.get('/generic-assay-meta/ccle_broad_2019_CCLE_drug_treatment_IC50');" });
    expect(entities.data.records).toEqual(meta);
    const first = await invoke(f, "cbioportal_query_data", { data_access_id: entities.id, sql: "SELECT native_json FROM records WHERE _rowid=1" });
    expect(JSON.parse(first.data.rows[0].native_json)).toEqual(meta[0]);
  } finally { f.close(); }
});

it.each([false, true])("preserves cohort definitions and never materializes dynamic=%s filters as membership", async dynamic => {
  const f = fixture();
  const definition = { name: "fixture", dynamic, studies: [{id: "a", samples: ["001", "001"]}, {id: "b", samples: ["001"]}], studyViewFilter: {future: ["001", null, padding]} };
  vi.stubGlobal("fetch", vi.fn());
  try {
    const r = await invoke(f, "mcp_cbioportal_execute", { code: `return await api.post('/cohorts/inspect',${JSON.stringify(definition)});` });
    expect(r.data.definition).toEqual(definition); expect(fetch).not.toHaveBeenCalled();
    expect(r.sc._meta.completeness).toMatchObject({ complete: false, returned: 1 });
    expect(r.data._cohort).toMatchObject({ membership_verified: false, patient_count: null, declared_sample_entries: 3, distinct_declared_sample_pairs: 2 });
    if (!dynamic) {
      const members = await invoke(f, "cbioportal_query_data", { data_access_id: r.id, sql: "SELECT studyId,sampleId FROM cohort_members ORDER BY studyId" });
      expect(members.data.rows).toEqual([{studyId: "a", sampleId: "001"}, {studyId: "b", sampleId: "001"}]);
    } else {
      expect(r.data._cohort.members).toBeNull();
      await invoke(f, "cbioportal_query_data", { data_access_id: r.id, sql: "SELECT * FROM cohort_members" }, true);
    }
  } finally { f.close(); }
});

it("retains invalid provider evidence, HTTP failures and empty selections with verifiable citations", async () => {
  const f = fixture();
  try {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({invalid: padding})));
    const shape = await invoke(f, "cbioportal_execute", {code: "return await api.get('/generic-assay-meta/profile');"}, true);
    const invalid = shape.data.data.__staged ? await recover(f, shape.data.data.data_access_id, "") : shape.data.data;
    expect(invalid.native).toEqual({invalid: padding});
    vi.mocked(fetch).mockImplementation(async () => new Response(padding, {status: 403}));
    const denied = await invoke(f, "mcp_cbioportal_execute", {code: "return await api.get('/session/virtual_study/known');"}, true);
    const body = denied.data.data.__staged ? await recover(f, denied.data.data.data_access_id, "") : denied.data.data;
    expect(body).toBe(padding);
    vi.mocked(fetch).mockImplementation(async () => Response.json([]));
    const empty = await invoke(f, "cbioportal_execute", {code: "return await api.get('/generic-assay-meta/profile');"});
    expect(empty.data.records).toEqual([]); expect(empty.sc._meta.completeness).toMatchObject({complete: false, returned: 0});
  } finally { f.close(); }
});

it("registers sixteen aliases and cites discovery and hand-built errors", async () => {
  const f = fixture();
  expect(Object.keys(f.tools).sort()).toEqual(["search", "execute", "query_data", "get_schema", "mutation_frequency", "study_summary", "survival", "co_occurrence"].flatMap(name => ["cbioportal_" + name, "mcp_cbioportal_" + name]).sort());
  vi.stubGlobal("fetch", vi.fn(async () => new Response("native not found", {status: 404})));
  try { for (const prefix of ["", "mcp_"]) {
    await invoke(f, prefix + "cbioportal_search", {query: "generic assay", max_results: 3});
    await invoke(f, prefix + "cbioportal_study_summary", {study_id: "missing"}, true);
    await invoke(f, prefix + "cbioportal_mutation_frequency", {molecular_profile_id: "missing"}, true);
    await invoke(f, prefix + "cbioportal_survival", {study_id: "missing", gene: "TP53", endpoint: "invalid"}, true);
    await invoke(f, prefix + "cbioportal_co_occurrence", {study_id: "missing", genes: "TP53"}, true);
  } } finally { f.close(); }
});

it.each([{__api_error: true}, {__stage_error: true}, {__staged: true, data_access_id: "entity"}])("the context recipe preserves entity error/staging handles %#", async handle => {
  const api = {get: vi.fn().mockResolvedValue(native.patient_profile), post: vi.fn().mockResolvedValue(handle)};
  const result = await new Function("api", `return (async () => {${assayWorkflows[2].code}})()`)(api);
  expect(result).toEqual({profile: native.patient_profile, entities: handle, complete: false});
  expect(api.post).toHaveBeenCalledTimes(1);
});

it("runs the context recipe through catalog validation with native profile/entity/value envelopes", async () => {
  const f = fixture();
  vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("/molecular-profiles/") ? Response.json(native.patient_profile)
    : String(url).includes("generic-assay-meta") ? Response.json([{stableId: "Neutrophils", genericEntityMetaProperties: {NAME: "Neutrophils"}}])
    : Response.json([native.patient_values[0]])));
  try {
    const result = await invoke(f, "cbioportal_execute", {code: assayWorkflows[2].code});
    expect(result.data.profile).toEqual(native.patient_profile);
    expect(result.data.measurements.records).toEqual([native.patient_values[0]]);
    expect(result.sc._meta.completeness.complete).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally { f.close(); }
});
