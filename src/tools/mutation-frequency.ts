import type { McpServer } from "@bio-mcp/shared/mcp";
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

/**
 * Resolve a HUGO gene symbol to its Entrez Gene ID and pick a sample list.
 * The cBioPortal GET mutations endpoint requires BOTH entrezGeneId and sampleListId;
 * passing only sampleListId (or neither) returns HTTP 400 "missing entrezGeneId".
 */
async function resolveMutationQuery(
    profileId: string,
    hugoGeneSymbol: string,
    sampleListId?: string,
): Promise<{ entrezGeneId: number; sampleListId: string }> {
    const geneSym = hugoGeneSymbol.toUpperCase();
    const geneResp = await cbioportalFetch(`/genes/${encodeURIComponent(geneSym)}`);
    if (!geneResp.ok) {
        const body = await geneResp.text().catch(() => "");
        throw new Error(
            `gene lookup failed for '${geneSym}': HTTP ${geneResp.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
        );
    }
    const geneObj = (await geneResp.json()) as { entrezGeneId?: number };
    if (!geneObj.entrezGeneId) {
        throw new Error(`no Entrez Gene ID found for '${geneSym}'`);
    }
    // Default to the study's "_all" sample list (strip the "_mutations" profile suffix).
    const resolvedList = sampleListId ?? `${profileId.replace(/_mutations$/, "")}_all`;
    return { entrezGeneId: geneObj.entrezGeneId, sampleListId: resolvedList };
}

export function registerMutationFrequency(server: McpServer, env?: MutEnv): void {
    const schema = {
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
    };

    const handler = async (
        args: {
            molecular_profile_id: string;
            hugo_gene_symbol?: string;
            sample_list_id?: string;
            page_size?: number;
        },
        extra: unknown,
    ) => {
        const runtimeEnv = env || (extra as { env?: MutEnv })?.env;
        try {
            const profileId = String(args.molecular_profile_id);

            // The cBioPortal mutations endpoint requires a specific gene (entrezGeneId).
            if (!args.hugo_gene_symbol) {
                return createCodeModeError(
                    "MISSING_GENE",
                    "cbioportal_mutation_frequency requires hugo_gene_symbol — the cBioPortal mutations endpoint needs a specific gene. For multi-gene or whole-profile pulls, use cbioportal_execute (POST /mutations/fetch with entrezGeneIds[]).",
                );
            }

            const { entrezGeneId, sampleListId } = await resolveMutationQuery(
                profileId,
                String(args.hugo_gene_symbol),
                args.sample_list_id ? String(args.sample_list_id) : undefined,
            );

            const params: Record<string, unknown> = {
                sampleListId,
                entrezGeneId,
                projection: "DETAILED",
                pageSize: args.page_size || 1000,
                pageNumber: 0,
            };

            const path = `/molecular-profiles/${encodeURIComponent(profileId)}/mutations`;
            const response = await cbioportalFetch(path, params);

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                throw new Error(`cBioPortal API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`);
            }

            const data = await response.json() as Record<string, unknown>[];

            const responseSize = JSON.stringify(data).length;
            if (shouldStage(responseSize) && runtimeEnv?.CBIOPORTAL_DATA_DO) {
                const staged = await stageToDoAndRespond(
                    data,
                    runtimeEnv.CBIOPORTAL_DATA_DO as DurableObjectNamespace,
                    "mutations",
                    undefined,
                    undefined,
                    "cbioportal",
                    (extra as Record<string, unknown>),
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
    };

    server.registerTool("cbioportal_mutation_frequency", schema, handler);
    server.registerTool("mcp_cbioportal_mutation_frequency", schema, handler);
}
