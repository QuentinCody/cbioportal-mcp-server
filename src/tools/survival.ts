import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cbioportalFetch } from "../lib/http";
import {
    createCodeModeResponse,
    createCodeModeError,
    type CodeModeResponse,
} from "@bio-mcp/shared/codemode/response";
import { stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import {
    kaplanMeier,
    logRank,
    cohortSplit,
} from "../lib/stats";

interface SurvivalEnv {
    CBIOPORTAL_DATA_DO: DurableObjectNamespace;
}

const ENDPOINT_MAP: Record<string, { time: string; status: string; eventPatterns: string[] }> = {
    os: { time: "OS_MONTHS", status: "OS_STATUS", eventPatterns: ["DECEASED", "1:DECEASED", "Dead"] },
    pfs: { time: "PFS_MONTHS", status: "PFS_STATUS", eventPatterns: ["PROGRESSED", "1:PROGRESSED", "1:PROGRESSION"] },
    dfs: { time: "DFS_MONTHS", status: "DFS_STATUS", eventPatterns: ["Recurred", "1:Recurred", "1:Recurred/Progressed"] },
    dss: { time: "DSS_MONTHS", status: "DSS_STATUS", eventPatterns: ["DEAD WITH TUMOR", "1:DEAD WITH TUMOR"] },
};

const MAX_MUTATIONS = 50000;
const MAX_CLINICAL_ROWS = 200000;

function isEventStatus(value: string, patterns: string[]): boolean {
    const v = value.trim();
    for (const p of patterns) {
        if (v === p || v.includes(p)) return true;
    }
    return false;
}

interface PatientSurvival {
    patientId: string;
    time: number;
    status: string;
    isEvent: boolean;
    [key: string]: unknown;
}

function pivotClinicalToSurvival(
    clinicalRows: Record<string, unknown>[],
    timeName: string,
    statusName: string,
    eventPatterns: string[],
): PatientSurvival[] {
    const patients = new Map<string, { time?: number; status?: string }>();

    for (const row of clinicalRows) {
        const pid = String(row.patientId ?? "");
        const attr = String(row.clinicalAttributeId ?? "");
        const val = String(row.value ?? "");
        if (!pid) continue;

        if (!patients.has(pid)) patients.set(pid, {});
        const p = patients.get(pid)!;

        if (attr === timeName) {
            const t = parseFloat(val);
            if (!isNaN(t) && t >= 0) p.time = t;
        } else if (attr === statusName) {
            p.status = val;
        }
    }

    const result: PatientSurvival[] = [];
    for (const [pid, data] of patients) {
        if (data.time !== undefined && data.status !== undefined) {
            result.push({
                patientId: pid,
                time: data.time,
                status: data.status,
                isEvent: isEventStatus(data.status, eventPatterns),
            });
        }
    }
    return result;
}

function formatSurvival(val: number | null): string {
    if (val === null) return "N/A";
    return `${(val * 100).toFixed(1)}%`;
}

function formatMonths(val: number | null): string {
    if (val === null) return "not reached";
    return `${val.toFixed(1)} months`;
}

async function fetchJson(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const response = await cbioportalFetch(path, params);
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`cBioPortal API HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`);
    }
    return response.json();
}

export function registerSurvival(server: McpServer, env: SurvivalEnv): void {
    const schema = {
        title: "Kaplan-Meier Survival Analysis",
        description:
            "Run Kaplan-Meier survival analysis comparing mutant vs wildtype cohorts for a gene in a cBioPortal study. " +
            "Computes KM curves, median survival, landmark survivals (1yr/3yr/5yr), and log-rank p-value. " +
            "Also stages underlying survival data for follow-up SQL queries.",
        inputSchema: {
            study_id: z.string().min(1).describe("cBioPortal study ID (e.g. 'brca_tcga_pan_can_atlas_2018', 'msk_impact_2017')"),
            gene: z.string().min(1).describe("Hugo gene symbol (e.g. 'TP53', 'BRCA1', 'KRAS')"),
            endpoint: z
                .enum(["os", "pfs", "dfs", "dss"])
                .default("os")
                .optional()
                .describe("Survival endpoint: os (overall), pfs (progression-free), dfs (disease-free), dss (disease-specific)"),
        },
    };

    const handler = async (args: { study_id: string; gene: string; endpoint?: string }, extra: { sessionId?: string }) => {
        try {
            const studyId = args.study_id.trim();
            const geneSymbol = args.gene.trim().toUpperCase();
            const endpoint = (args.endpoint ?? "os").toLowerCase();
            const endpointConfig = ENDPOINT_MAP[endpoint];

            if (!endpointConfig) {
                return createCodeModeError("INVALID_ARGUMENT", `Unknown endpoint '${endpoint}'. Use: os, pfs, dfs, dss`);
            }

            // 1. Resolve gene to entrezGeneId
            const geneInfo = await fetchJson(`/genes/${encodeURIComponent(geneSymbol)}`) as Record<string, unknown>;
            const entrezGeneId = geneInfo.entrezGeneId;
            if (!entrezGeneId) {
                return createCodeModeError("NOT_FOUND", `Gene '${geneSymbol}' not found in cBioPortal`);
            }

            // 2. Fetch mutations, samples, and clinical data in parallel
            const [mutationData, sampleData, clinicalData] = await Promise.all([
                fetchJson(`/molecular-profiles/${encodeURIComponent(`${studyId}_mutations`)}/mutations`, {
                    sampleListId: `${studyId}_all`,
                    entrezGeneId,
                    projection: "SUMMARY",
                    pageSize: MAX_MUTATIONS,
                }) as Promise<Record<string, unknown>[]>,
                fetchJson(`/studies/${encodeURIComponent(studyId)}/samples`, {
                    projection: "SUMMARY",
                }) as Promise<Record<string, unknown>[]>,
                fetchJson(`/studies/${encodeURIComponent(studyId)}/clinical-data`, {
                    clinicalDataType: "PATIENT",
                    pageSize: MAX_CLINICAL_ROWS,
                }) as Promise<Record<string, unknown>[]>,
            ]);

            // 3. Build sample→patient mapping
            const sampleToPatient = new Map<string, string>();
            for (const s of sampleData) {
                const sid = String(s.sampleId ?? "");
                const pid = String(s.patientId ?? "");
                if (sid && pid) sampleToPatient.set(sid, pid);
            }

            // 4. Get all unique patient IDs from clinical data
            const allPatientIds = new Set<string>();
            for (const row of clinicalData) {
                const pid = String(row.patientId ?? "");
                if (pid) allPatientIds.add(pid);
            }

            // 5. Pivot clinical data to per-patient survival records
            const survivalRecords = pivotClinicalToSurvival(
                clinicalData,
                endpointConfig.time,
                endpointConfig.status,
                endpointConfig.eventPatterns,
            );

            if (survivalRecords.length === 0) {
                return createCodeModeError(
                    "DATA_UNAVAILABLE",
                    `No ${endpoint.toUpperCase()} survival data found for study '${studyId}'. ` +
                    `Check that ${endpointConfig.time} and ${endpointConfig.status} clinical attributes exist.`,
                );
            }

            // 6. Split into mutant/wildtype cohorts
            const cohort = cohortSplit(mutationData, sampleToPatient, geneSymbol, allPatientIds);

            const mutantPatientSet = new Set(cohort.mutant_patients);
            const mutantSurvival = survivalRecords.filter((r) => mutantPatientSet.has(r.patientId));
            const wildtypeSurvival = survivalRecords.filter((r) => !mutantPatientSet.has(r.patientId));

            // 7. Compute Kaplan-Meier for each group
            const mutantKM = kaplanMeier(mutantSurvival, "time", "isEvent", "true");
            const wildtypeKM = kaplanMeier(wildtypeSurvival, "time", "isEvent", "true");

            // 8. Log-rank test
            const logRankResult = logRank(mutantSurvival, wildtypeSurvival, "time", "isEvent", "true");

            // 9. Build markdown summary
            const endpointLabel = endpoint.toUpperCase();
            const markdown = [
                `## ${endpointLabel} Survival Analysis: ${geneSymbol} in ${studyId}`,
                "",
                `| Metric | ${geneSymbol}-Mutant (n=${mutantKM.n}) | Wildtype (n=${wildtypeKM.n}) |`,
                "|--------|---|---|",
                `| Events | ${mutantKM.events} | ${wildtypeKM.events} |`,
                `| Censored | ${mutantKM.censored} | ${wildtypeKM.censored} |`,
                `| Median ${endpointLabel} | ${formatMonths(mutantKM.median_survival)} | ${formatMonths(wildtypeKM.median_survival)} |`,
                `| 1-yr survival | ${formatSurvival(mutantKM.survival_1yr)} | ${formatSurvival(wildtypeKM.survival_1yr)} |`,
                `| 3-yr survival | ${formatSurvival(mutantKM.survival_3yr)} | ${formatSurvival(wildtypeKM.survival_3yr)} |`,
                `| 5-yr survival | ${formatSurvival(mutantKM.survival_5yr)} | ${formatSurvival(wildtypeKM.survival_5yr)} |`,
                "",
                `**Log-rank p-value**: ${logRankResult.p_value !== null ? logRankResult.p_value.toExponential(2) : "N/A"}`,
                `**Chi-squared**: ${logRankResult.chi_squared ?? "N/A"}`,
                "",
                `Total patients with ${endpointLabel} data: ${survivalRecords.length}`,
                `${geneSymbol}-mutant: ${cohort.mutant_count} patients (${mutantKM.n} with survival data)`,
                `Wildtype: ${cohort.wildtype_count} patients (${wildtypeKM.n} with survival data)`,
            ].join("\n");

            // 10. Stage the underlying survival data for follow-up SQL queries
            const stageData = survivalRecords.map((r) => ({
                ...r,
                cohort: mutantPatientSet.has(r.patientId) ? `${geneSymbol}-mutant` : "wildtype",
            }));

            let stagingMeta = undefined;
            if (env.CBIOPORTAL_DATA_DO) {
                const staged = await stageToDoAndRespond(
                    stageData,
                    env.CBIOPORTAL_DATA_DO,
                    "survival",
                    undefined,
                    undefined,
                    "cbioportal",
                    (extra as { sessionId?: string })?.sessionId,
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
                    gene: geneSymbol,
                    endpoint,
                    cohort: {
                        mutant_count: cohort.mutant_count,
                        wildtype_count: cohort.wildtype_count,
                        total: cohort.total,
                    },
                    mutant_km: mutantKM,
                    wildtype_km: wildtypeKM,
                    log_rank: logRankResult,
                    ...(stagingMeta ?? {}),
                    message: markdown,
                },
                { meta: { gene: geneSymbol, study_id: studyId, endpoint } },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return createCodeModeError("API_ERROR", `cbioportal_survival failed: ${msg}`);
        }
    };

    server.registerTool("cbioportal_survival", schema, handler);
    server.registerTool("mcp_cbioportal_survival", schema, handler);
}
