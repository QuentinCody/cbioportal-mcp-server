import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { cbioportalCatalog } from "../spec/catalog";
import { createCbioportalApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    CBIOPORTAL_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createCbioportalApiFetch();

    const searchTool = createSearchTool({
        prefix: "cbioportal",
        catalog: cbioportalCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "cbioportal",
        catalog: cbioportalCatalog,
        apiFetch,
        doNamespace: env.CBIOPORTAL_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
