# Cbioportal MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream Cbioportal API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The server is deployed and ready at:

```
https://cbioportal-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "cbioportal": {
      "command": "npx",
      "args": ["mcp-remote", "https://cbioportal-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8841/mcp` (start it with `./scripts/dev-servers.sh cbioportal`):

```json
{
  "mcpServers": {
    "cbioportal-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8841/mcp"]
    }
  }
}
```

## Tools

- `cbioportal_search` — discover available API operations (Code Mode catalog search, 24 endpoints)
- `cbioportal_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `cbioportal_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `cbioportal_get_schema` — inspect the inferred schema of a staged dataset
- `cbioportal_co_occurrence`
- `cbioportal_mutation_frequency`
- `cbioportal_study_summary`
- `cbioportal_survival`

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Development

```bash
./scripts/dev-servers.sh cbioportal            # run locally (port 8841)
pnpm --filter cbioportal-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*

## Generic assays and read-only virtual cohorts

Seven additional Code Mode operations use the fixed public `www.cbioportal.org` instance:

- `/molecular-profiles/{molecularProfileId}` reads one discovered profile, preserving datatype, patient/sample scope, thresholds and sort order.
- `/capabilities/generic-assays` reads live OpenAPI paths and their schema dependencies, including profile metadata. This proves advertised schema availability, not assay coverage.
- `/generic-assay-meta/{molecularProfileId}` reads entity metadata; `/generic-assay-meta/fetch` supports explicit profile IDs or stable entity IDs with bounded pagination.
- `/generic_assay_data/{molecularProfileId}/fetch` reads an explicit matrix subset: 1–100 case IDs in `sampleIds` and 1–25 `genericAssayStableIds`. Split larger selections into batches. Unbounded profile reads and sample-list expansion are not performed by this helper.
- `/session/virtual_study/{virtualStudyId}` reads an existing accessible session, retaining its full definition.
- `/cohorts/inspect` locally inspects a supplied virtual-study `data` object without sending it upstream or publishing anything.

Assay helpers return `{records, _cbioportal}`. Preserve profile/entity/study/sample/patient identifiers, `patientLevel`, and native value strings: `>8`, `<0.1`, categories, zeroes, blanks and `NA` have different meanings. No numeric coercion, aggregation or missing-to-negative conversion occurs. Discover molecular profile IDs from study metadata; retain datatype, generic assay type, patient/sample scope, thresholds, sort order and entity description/units before interpreting values. The catalog's discovery recipe retains the complete profile and entity envelopes, including staged/error handles.

Static cohort inspection returns deduplicated **study-qualified sample pairs**, with both declared and distinct counts. It does not verify that samples exist, measure profiling coverage or infer a patient count. Dynamic definitions preserve `studyViewFilter` verbatim and report unresolved membership; even a supplied sample list is not presented as current dynamic membership. Unknown filter fields remain intact. Structural validation is not full validation of every instance-specific filter. Cohorts are bounded to 100 study entries, 100000 declared samples and 4 MiB.

Assay/session HTTP requests have a 45-second request deadline and an independent 10-second, 4 MiB body bound. Timeout/network failures, malformed or partial JSON and HTTP errors remain explicit; complete native error bodies or unavailable-body context are retained. Source URL, retrieval time, response SHA-256, request options and provider total-count headers remain available; snapshot version remains unknown. Metadata pagination is explicit (up to 100 rows/page), and selections do not claim whole-cohort completeness, including after staging. All sixteen tool aliases now cite their handler results and errors and stage complete envelopes above 30 KiB. SQL limits default to 100 rows; request a larger explicit limit or paginate when needed. Legacy POST query parameters reach the provider, preserving projection and paging options.

Staged assay `records` retain measurement values and case identifiers as SQLite `TEXT`, with `native_json` preserving every native row field. Cohorts expose `cohort_studies` and, for static definitions only, `cohort_members`. Capability documents expose `api_paths` and `api_schemas`. The full original response remains recoverable through `payloads`, including chunked payloads. Native byte hashes and canonical MCP result hashes have different scopes; property order and session study/sample order can vary between independent upstream reads.

Contracts: [public instance OpenAPI](https://www.cbioportal.org/api/v3/api-docs), [generic-assay data semantics](https://docs.cbioportal.org/file-formats/#generic-assay), [virtual-study definitions and session reads](https://docs.cbioportal.org/virtual-study-data-schema/). An extracted schema fixture records the observed public contract, not a universal contract for private installations. Publisher APIs and private-instance credentials are not added. This extends coverage of documented capabilities without claiming a new 2026 API launch.

Native acceptance on October 4, 2026 passed against the bundled local Worker with SQLite and WorkerLoader: CCLE numeric assays and 266 entity metadata records; BRCA categorical measurements; patient-level immune-cell measurements, including string zeroes; and the public portal's default TCGA PanCancer Atlas virtual session (32 studies, 10,967 declared samples). All three catalog workflows and capability-table SQL recovery passed. The patient-level study uses identical sample/patient IDs, so this does not establish interchangeability when IDs differ. Censoring, binary values, missing markers and divergent patient/sample IDs also have adversarial fixture coverage; those are not claims of native examples. No public BINARY profile appeared in the observed roster. Dynamic cohorts remain unevaluated, and private instances/publisher operations are outside this validation. See the [dated acceptance record](../../docs/plans/2026-09-26-upstream-api-implementation.md). Changes have not been deployed.

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from cBioPortal and stays under the terms of that source: Datahub studies ODbL; AACR GENIE: no redistribution without permission.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
