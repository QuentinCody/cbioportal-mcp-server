import { cbioportalResponse, type DataEnv } from "../lib/tool-result";
import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { cbioportalFetch } from "../lib/http";
import { readCbioportal } from "../lib/read";
import {
    createCodeModeResponse,
} from "@bio-mcp/shared/codemode/response";

export function registerStudySummary(server: McpServer, env?: unknown): void {
    const schema = {
        title: "Get Study Summary",
        description:
            "Get metadata for a cBioPortal study including name, description, cancer type, number of samples and native source fields. Discover available molecular profiles separately with Code Mode.",
        inputSchema: {
            study_id: z
                .string()
                .min(1)
                .describe("Study ID (e.g. 'brca_tcga', 'luad_tcga_pan_can_atlas_2018')"),
        },
    };

    const handler = async (args: { study_id: string }) => {
        const studyId = String(args.study_id).trim();
        const response = await cbioportalFetch(`/studies/${encodeURIComponent(studyId)}`);
        const { data: study } = await readCbioportal(response);
        return createCodeModeResponse(study, { meta: { fetched_at: new Date().toISOString() } });
    };

    server.registerTool("cbioportal_study_summary", schema, (args, extra) => cbioportalResponse(() => handler(args), (env ?? {}) as DataEnv, "cbioportal_study_summary", extra, args));
    server.registerTool("mcp_cbioportal_study_summary", schema, (args, extra) => cbioportalResponse(() => handler(args), (env ?? {}) as DataEnv, "cbioportal_study_summary", extra, args));
}
