import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class CbioportalDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                // Mutation data
                if ("mutationType" in sample || "proteinChange" in sample || "mutationStatus" in sample) {
                    return {
                        tableName: "mutations",
                        indexes: ["entrezGeneId", "hugoGeneSymbol", "mutationType", "proteinChange"],
                    };
                }
                // Clinical data
                if ("clinicalAttributeId" in sample && "value" in sample) {
                    return {
                        tableName: "clinical_data",
                        indexes: ["clinicalAttributeId", "patientId", "sampleId"],
                    };
                }
                // Study list
                if ("studyId" in sample && "cancerTypeId" in sample) {
                    return {
                        tableName: "studies",
                        indexes: ["studyId", "cancerTypeId"],
                    };
                }
                // Molecular profiles
                if ("molecularProfileId" in sample && "molecularAlterationType" in sample) {
                    return {
                        tableName: "molecular_profiles",
                        indexes: ["molecularProfileId", "molecularAlterationType", "studyId"],
                    };
                }
            }
        }

        return undefined;
    }
}
