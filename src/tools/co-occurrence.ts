import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cbioportalFetch } from "../lib/http";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import { stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import { coOccurrence } from "../lib/stats";

interface CoOccurrenceEnv {
    CBIOPORTAL_DATA_DO: DurableObjectNamespace;
}

const MAX_GENES = 10;
const MAX_MUTATIONS_PER_GENE = 50000;

async function fetchJson(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const response = await cbioportalFetch(path, params);
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`cBioPortal API HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`);
    }
    return response.json();
}

export function registerCoOccurrence(server: McpServer, env: CoOccurrenceEnv): void {
    const schema = {
        title: "Mutation Co-Occurrence Analysis",
        description:
            "Analyze pairwise mutation co-occurrence for a set of genes in a cBioPortal study. " +
            "Computes Fisher's exact test p-values and log-odds ratios for each gene pair. " +
            "Positive log-odds = co-occurring, negative = mutually exclusive. Max 10 genes.",
        inputSchema: {
            study_id: z.string().min(1).describe("cBioPortal study ID (e.g. 'msk_impact_2017', 'brca_tcga_pan_can_atlas_2018')"),
            genes: z.string().min(1).describe("Comma-separated Hugo gene symbols (e.g. 'TP53,KRAS,PIK3CA,PTEN'). Max 10 genes."),
        },
    };

    const handler = async (args: { study_id: string; genes: string }, extra: { sessionId?: string }) => {
        try {
            const studyId = args.study_id.trim();
            const geneList = args.genes
                .split(",")
                .map((g) => g.trim().toUpperCase())
                .filter(Boolean);

            if (geneList.length < 2) {
                return createCodeModeError("INVALID_ARGUMENT", "At least 2 genes are required for co-occurrence analysis");
            }
            if (geneList.length > MAX_GENES) {
                return createCodeModeError("INVALID_ARGUMENT", `Maximum ${MAX_GENES} genes allowed (got ${geneList.length})`);
            }

            // 1. Resolve all genes to entrezGeneIds
            const geneResults = await Promise.all(
                geneList.map(async (symbol) => {
                    try {
                        const info = (await fetchJson(`/genes/${encodeURIComponent(symbol)}`)) as Record<string, unknown>;
                        return { symbol, entrezGeneId: info.entrezGeneId as number, error: null };
                    } catch {
                        return { symbol, entrezGeneId: null, error: `Gene '${symbol}' not found` };
                    }
                }),
            );

            const failedGenes = geneResults.filter((g) => g.entrezGeneId === null);
            if (failedGenes.length === geneList.length) {
                return createCodeModeError("NOT_FOUND", `None of the genes were found: ${failedGenes.map((g) => g.symbol).join(", ")}`);
            }

            const validGenes = geneResults.filter((g): g is { symbol: string; entrezGeneId: number; error: null } => g.entrezGeneId !== null);

            // 2. Get total sample count
            const samples = (await fetchJson(`/studies/${encodeURIComponent(studyId)}/samples`, {
                projection: "ID",
            })) as Record<string, unknown>[];
            const totalSamples = samples.length;

            // 3. Fetch mutations for each gene (batched 3 at a time for rate limits)
            const allMutations: Record<string, unknown>[] = [];
            const batchSize = 3;
            for (let i = 0; i < validGenes.length; i += batchSize) {
                const batch = validGenes.slice(i, i + batchSize);
                const results = await Promise.all(
                    batch.map(async (g) => {
                        const mutations = (await fetchJson(
                            `/molecular-profiles/${encodeURIComponent(`${studyId}_mutations`)}/mutations`,
                            {
                                sampleListId: `${studyId}_all`,
                                entrezGeneId: g.entrezGeneId,
                                projection: "SUMMARY",
                                pageSize: MAX_MUTATIONS_PER_GENE,
                            },
                        )) as Record<string, unknown>[];
                        return mutations;
                    }),
                );
                for (const mutations of results) allMutations.push(...mutations);
            }

            // 4. Run co-occurrence analysis
            const result = coOccurrence(
                allMutations,
                validGenes.map((g) => g.symbol),
            );

            // 5. Build markdown summary
            const lines = [
                `## Mutation Co-Occurrence: ${validGenes.map((g) => g.symbol).join(", ")} in ${studyId}`,
                "",
                `Total samples: ${totalSamples}`,
                "",
                "| Gene A | Gene B | Both | A Only | B Only | Neither | Log Odds Ratio | p-value | Pattern |",
                "|--------|--------|------|--------|--------|---------|---------------|---------|---------|",
            ];

            for (const pair of result.pairs) {
                const lor = pair.log_odds_ratio !== null ? pair.log_odds_ratio.toFixed(3) : "N/A";
                const pval = pair.p_value !== null ? pair.p_value.toExponential(2) : "N/A";
                lines.push(
                    `| ${pair.geneA} | ${pair.geneB} | ${pair.both} | ${pair.aOnly} | ${pair.bOnly} | ${pair.neither} | ${lor} | ${pval} | ${pair.pattern} |`,
                );
            }

            if (failedGenes.length > 0) {
                lines.push("", `Note: ${failedGenes.length} gene(s) not found and excluded: ${failedGenes.map((g) => g.symbol).join(", ")}`);
            }

            const markdown = lines.join("\n");

            // 6. Stage the mutation data for follow-up SQL queries
            let stagingMeta = undefined;
            if (env.CBIOPORTAL_DATA_DO && allMutations.length > 0) {
                const staged = await stageToDoAndRespond(
                    allMutations,
                    env.CBIOPORTAL_DATA_DO,
                    "co_occurrence",
                    undefined,
                    undefined,
                    "cbioportal",
                    extra.sessionId,
                );
                stagingMeta = {
                    staged: true as const,
                    data_access_id: staged.dataAccessId,
                    tables_created: staged.tablesCreated,
                    total_rows: staged.totalRows,
                    _staging: staged._staging,
                };
            }

            return createCodeModeResponse(
                {
                    study_id: studyId,
                    genes: validGenes.map((g) => g.symbol),
                    total_samples: totalSamples,
                    co_occurrence: result,
                    ...(stagingMeta ?? {}),
                    message: markdown,
                },
                { meta: { study_id: studyId, gene_count: validGenes.length } },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return createCodeModeError("API_ERROR", `cbioportal_co_occurrence failed: ${msg}`);
        }
    };

    server.registerTool("cbioportal_co_occurrence", schema, handler);
    server.registerTool("mcp_cbioportal_co_occurrence", schema, handler);
}
