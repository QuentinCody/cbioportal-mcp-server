import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
import { StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { registerMutationFrequency } from "./tools/mutation-frequency";
import { registerStudySummary } from "./tools/study-summary";
import { registerSurvival } from "./tools/survival";
import { registerCoOccurrence } from "./tools/co-occurrence";
import { CbioportalDataDO } from "./do";

export { CbioportalDataDO };

interface CbioportalEnv {
    CBIOPORTAL_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export class MyMCP extends StatelessMcpWorker {
    server = new McpServer({
        name: "cbioportal",
        version: "0.2.0",
    });

    async init() {

    	configureCitationSigning(this.env);
        const env = this.env as unknown as CbioportalEnv;
        registerQueryData(this.server, env);
        registerGetSchema(this.server, env);
        registerCodeMode(this.server, env);
        registerMutationFrequency(this.server, env);
        registerStudySummary(this.server);
        registerSurvival(this.server, env);
        registerCoOccurrence(this.server, env);
    }
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return buildHealthResponse("cbioportal");
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
};
