import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { cbioportalCatalog } from "../spec/catalog";
import { assayWorkflows } from "../spec/assays";
import { createCbioportalApiFetch } from "../lib/api-adapter";
const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {"content-type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());
it("registers both aliases with discoverable assay workflows and both-field errors", async () => {
  const server = new McpServer({name: "fixture", version: "1"});
  registerCodeMode(server, {CODE_MODE_LOADER: {get: () => ({})}} as unknown as Parameters<typeof registerCodeMode>[1]);
  registerQueryData(server, {}); registerGetSchema(server, {});
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  for (const suffix of ["search", "execute", "query_data", "get_schema"]) {
    expect(tools[`cbioportal_${suffix}`]).toBeDefined(); expect(tools[`mcp_cbioportal_${suffix}`]).toBeDefined();
  }
  expect(await tools.cbioportal_search.handler({query: assayWorkflows[0].title, category: "workflows", max_results: 5}, {})).toMatchObject({content: expect.any(Array), structuredContent: {success: true}});
  expect(await tools.mcp_cbioportal_query_data.handler({data_access_id: "cbioportal_fixture", sql: "SELECT 1"}, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: expect.any(Object)});
});
it("stages full entity metadata and request context beyond 30 KiB", async () => {
  const raw = [{stableId: "entity", entityType: "GENERIC_ASSAY", genericEntityMetaProperties: {NAME: "Assay", DESCRIPTION: "α".repeat(17000)}}];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(raw)));
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      stored.push((await request.json() as {data: unknown}).data);
      return json({success: true, tables_created: ["records"], total_rows: 1, input_rows: 1, table_row_counts: {records: 1}});
    }
    return json({success: true, schema: {tables: {records: {columns: [{name: "stableId"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({apiFetch: createCbioportalApiFetch(), catalog: cbioportalCatalog, doNamespace: namespace, stagingPrefix: "cbioportal", maxInlineBytes: 30 * 1024});
  expect(await proxy.handler({method: "POST", path: "/generic-assay-meta/fetch", body: {genericAssayStableIds: ["entity"]}}, {sql: () => []})).toMatchObject({__staged: true, data_access_id: expect.any(String)});
  expect(JSON.parse(stored[0] as string)).toMatchObject({records: raw, _cbioportal: {complete: false, request: {body: {genericAssayStableIds: ["entity"]}}}});
  expect(stored[1]).toMatchObject({records: raw});
});
it.each([{__api_error: true}, {__stage_error: true}, {__staged: true, data_access_id: "profiles"}])("preserves profile discovery handles %#", async handle => {
  const api = {get: vi.fn().mockResolvedValue(handle), post: vi.fn()};
  expect(await new Function("api", `return (async () => {${assayWorkflows[0].code}})()`)(api)).toEqual(handle);
  expect(api.post).not.toHaveBeenCalled();
});
it("retains native profile interpretation metadata and a staged entity page", async () => {
  const profiles = [{molecularProfileId: "study_custom", molecularAlterationType: "GENERIC_ASSAY", datatype: "LIMIT-VALUE", patientLevel: true, pivotThreshold: 0.1, valueSortOrder: "ASC", genericAssayType: "TREATMENT_RESPONSE"}];
  const entities = {__staged: true, data_access_id: "entities"};
  const api = {get: vi.fn().mockResolvedValue(profiles), post: vi.fn().mockResolvedValue(entities)};
  expect(await new Function("api", `return (async () => {${assayWorkflows[0].code}})()`)(api)).toMatchObject({profiles, selectedProfile: profiles[0], entities, complete: false});
  expect(api.post).toHaveBeenCalledWith("/generic-assay-meta/fetch", {molecularProfileIds: ["study_custom"]}, {projection: "DETAILED", pageSize: 25, pageNumber: 0});
});
