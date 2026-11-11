import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";
import { record } from "./lib/completeness";

const unwrap = (value: unknown): unknown => record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent ? value.structuredContent.data : value;
const nativeRow = (value: unknown) => record(value)
    ? { ...Object.fromEntries(Object.entries(value).filter(([, item]) => item === null || typeof item !== "object")), native_json: JSON.stringify(value) }
    : { native_json: JSON.stringify(value) };

export class CbioportalDataDO extends RestStagingDO {
    protected getTabularData(value: unknown): unknown {
        const data = unwrap(value);
        if (!record(data)) return data;
        if (typeof data.sql === "string" && Array.isArray(data.rows)) return { query_rows: data.rows.map(native => ({ native })) };
        if (Array.isArray(data.records)) return { records: data.records.map(nativeRow) };
        if (record(data._cohort) && record(data.definition) && Array.isArray(data.definition.studies)) return {
            cohort_studies: data.definition.studies.map(study => ({ ...nativeRow(study), declared_samples: record(study) && Array.isArray(study.samples) ? study.samples.length : null })),
            ...(Array.isArray(data._cohort.members) ? { cohort_members: data._cohort.members.map(nativeRow) } : {}),
        };
        if (record(data.paths) && record(data.schemas) && record(data._cbioportal)) return {
            api_paths: Object.entries(data.paths).map(([path, native]) => ({ path, native_json: JSON.stringify(native) })),
            api_schemas: Object.entries(data.schemas).map(([name, native]) => ({ name, native_json: JSON.stringify(native) })),
        };
        return data;
    }

    protected getSchemaHints(value: unknown): SchemaHints | undefined {
        const data = unwrap(value);
        // Numeric-looking case IDs and measurements remain provider strings in SQLite.
        if (record(data) && (Array.isArray(data.records) || record(data._cohort))) return {
            columnTypes: Object.fromEntries(["value", "sampleId", "patientId", "studyId", "stableId", "genericAssayStableId", "molecularProfileId", "uniqueSampleKey", "uniquePatientKey", "id", "native_json"].map(name => [name, "TEXT"])),
        };
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
                // Molecular data (expression, protein, methylation)
                if ("value" in sample && "entrezGeneId" in sample && "molecularProfileId" in sample) {
                    return {
                        tableName: "molecular_data",
                        indexes: ["entrezGeneId", "sampleId"],
                    };
                }
                // Survival analysis results
                if ("isEvent" in sample && "time" in sample && "cohort" in sample) {
                    return {
                        tableName: "survival_data",
                        indexes: ["patientId", "cohort"],
                    };
                }
            }
        }

        return undefined;
    }
}
