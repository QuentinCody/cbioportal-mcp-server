import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cbioportalFetch } from "../lib/http";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";

export function registerStudySummary(server: McpServer, _env?: unknown) {
    server.registerTool(
        "cbioportal_study_summary",
        {
            title: "Get Study Summary",
            description:
                "Get metadata for a cBioPortal study including name, description, cancer type, number of samples, and available molecular profiles.",
            inputSchema: {
                study_id: z
                    .string()
                    .min(1)
                    .describe("Study ID (e.g. 'brca_tcga', 'luad_tcga_pan_can_atlas_2018')"),
            },
        },
        async (args) => {
            try {
                const studyId = String(args.study_id).trim();

                const response = await cbioportalFetch(`/studies/${encodeURIComponent(studyId)}`);

                if (!response.ok) {
                    const body = await response.text().catch(() => "");
                    throw new Error(`cBioPortal API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`);
                }

                const study = await response.json();

                return createCodeModeResponse(study, {
                    meta: { fetched_at: new Date().toISOString() },
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return createCodeModeError("API_ERROR", `cbioportal_study_summary failed: ${msg}`);
            }
        },
    );
}
