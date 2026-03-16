import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cbioportalFetch } from "../lib/http";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

interface MutEnv {
    CBIOPORTAL_DATA_DO?: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(req: Request): Promise<Response> };
    };
}

export function registerMutationFrequency(server: McpServer, env?: MutEnv) {
    server.registerTool(
        "cbioportal_mutation_frequency",
        {
            title: "Get Somatic Mutations for a Study",
            description:
                "Retrieve somatic mutation data from a cBioPortal study's mutation molecular profile. Returns per-sample mutations with gene, protein change, mutation type, and allele frequencies.",
            inputSchema: {
                molecular_profile_id: z
                    .string()
                    .min(1)
                    .describe("Molecular profile ID (e.g. 'brca_tcga_mutations' — append '_mutations' to study ID)"),
                hugo_gene_symbol: z
                    .string()
                    .optional()
                    .describe("Filter by gene symbol (e.g. 'TP53', 'BRAF')"),
                sample_list_id: z
                    .string()
                    .optional()
                    .describe("Sample list ID (default: all samples in the study)"),
                page_size: z
                    .number()
                    .int()
                    .min(1)
                    .max(10000)
                    .default(1000)
                    .optional()
                    .describe("Number of mutations to return (default: 1000)"),
            },
        },
        async (args, extra) => {
            const runtimeEnv = env || (extra as { env?: MutEnv })?.env;
            try {
                const profileId = String(args.molecular_profile_id);
                const params: Record<string, unknown> = {
                    projection: "DETAILED",
                    pageSize: args.page_size || 1000,
                    pageNumber: 0,
                };

                const path = `/molecular-profiles/${encodeURIComponent(profileId)}/mutations`;

                if (args.sample_list_id) {
                    params.sampleListId = String(args.sample_list_id);
                }

                const response = await cbioportalFetch(path, params);

                if (!response.ok) {
                    const body = await response.text().catch(() => "");
                    throw new Error(`cBioPortal API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`);
                }

                let data = await response.json() as Record<string, unknown>[];

                // Filter by gene if specified
                if (args.hugo_gene_symbol) {
                    const gene = String(args.hugo_gene_symbol).toUpperCase();
                    data = data.filter((m) => String(m.hugoGeneSymbol).toUpperCase() === gene);
                }

                const responseSize = JSON.stringify(data).length;
                if (shouldStage(responseSize) && runtimeEnv?.CBIOPORTAL_DATA_DO) {
                    const staged = await stageToDoAndRespond(
                        data,
                        runtimeEnv.CBIOPORTAL_DATA_DO as any,
                        "mutations",
                        undefined,
                        undefined,
                        "cbioportal",
                        (extra as { sessionId?: string })?.sessionId,
                    );
                    return createCodeModeResponse(
                        {
                            staged: true,
                            data_access_id: staged.dataAccessId,
                            total_rows: staged.totalRows,
                            _staging: staged._staging,
                            message: `Mutation data staged (${data.length} mutations). Use cbioportal_query_data with data_access_id '${staged.dataAccessId}' to query.`,
                        },
                        { meta: { staged: true, data_access_id: staged.dataAccessId } },
                    );
                }

                return createCodeModeResponse(
                    {
                        mutations: data,
                        total: data.length,
                        molecular_profile_id: profileId,
                    },
                    { meta: { fetched_at: new Date().toISOString(), total: data.length } },
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return createCodeModeError("API_ERROR", `cbioportal_mutation_frequency failed: ${msg}`);
            }
        },
    );
}
