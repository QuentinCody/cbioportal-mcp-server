import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const cbioportalCatalog: ApiCatalog = {
    name: "cBioPortal REST API",
    baseUrl: "https://www.cbioportal.org/api",
    version: "1.0",
    auth: "none",
    endpointCount: 25,
    notes:
        "- Public REST API with Swagger docs at /api-docs\n" +
        "- Study IDs follow pattern: cancer_source (e.g. brca_tcga, luad_tcga_pan_can_atlas_2018)\n" +
        "- Molecular profile IDs = studyId + '_mutations' or '_gistic' or '_rna_seq_v2_mrna'\n" +
        "- Most endpoints return JSON arrays; use pageSize/pageNumber for pagination\n" +
        "- No auth required",
    endpoints: [
        // === Studies ===
        {
            method: "GET",
            path: "/studies",
            summary: "List all studies, optionally filtered by keyword or cancer type",
            category: "studies",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Search keyword for study name/description" },
                { name: "pageSize", type: "number", required: false, description: "Results per page (default 1000000)" },
                { name: "pageNumber", type: "number", required: false, description: "Page number (0-based)" },
                { name: "projection", type: "string", required: false, description: "Response detail level", enum: ["SUMMARY", "DETAILED", "ID"] },
            ],
        },
        {
            method: "GET",
            path: "/studies/{studyId}",
            summary: "Get a specific study by ID",
            category: "studies",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID (e.g. brca_tcga)" },
            ],
        },
        // === Cancer Types ===
        {
            method: "GET",
            path: "/cancer-types",
            summary: "List all cancer types in cBioPortal",
            category: "cancer_types",
            queryParams: [
                { name: "projection", type: "string", required: false, description: "Detail level", enum: ["SUMMARY", "DETAILED", "ID"] },
            ],
        },
        // === Molecular Profiles ===
        {
            method: "GET",
            path: "/studies/{studyId}/molecular-profiles",
            summary: "List molecular profiles for a study (mutations, CNA, expression, etc.)",
            category: "molecular_profiles",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
            ],
        },
        // === Mutations ===
        {
            method: "GET",
            path: "/molecular-profiles/{molecularProfileId}/mutations",
            summary: "Get mutations for a molecular profile. Requires sampleListId and entrezGeneId.",
            category: "mutations",
            pathParams: [
                { name: "molecularProfileId", type: "string", required: true, description: "Molecular profile ID (e.g. brca_tcga_mutations)" },
            ],
            queryParams: [
                { name: "sampleListId", type: "string", required: true, description: "Sample list ID (e.g. 'brca_tcga_all' — format: {studyId}_all)" },
                { name: "entrezGeneId", type: "number", required: true, description: "Entrez Gene ID (e.g. 7157 for TP53, 672 for BRCA1)" },
                { name: "projection", type: "string", required: false, description: "Detail level", enum: ["SUMMARY", "DETAILED", "ID"] },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
                { name: "pageNumber", type: "number", required: false, description: "Page number" },
            ],
        },
        // === Genes ===
        {
            method: "GET",
            path: "/genes/{geneId}",
            summary: "Get gene info by Entrez Gene ID or Hugo gene symbol",
            category: "genes",
            pathParams: [
                { name: "geneId", type: "string", required: true, description: "Entrez Gene ID or Hugo symbol" },
            ],
        },
        {
            method: "GET",
            path: "/genes",
            summary: "List all genes known to cBioPortal",
            category: "genes",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Search keyword" },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        // === Patients ===
        {
            method: "GET",
            path: "/studies/{studyId}/patients",
            summary: "List patients in a study",
            category: "patients",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
            ],
        },
        // === Samples ===
        {
            method: "GET",
            path: "/studies/{studyId}/samples",
            summary: "List samples in a study",
            category: "samples",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
            ],
            queryParams: [
                { name: "projection", type: "string", required: false, description: "Detail level" },
            ],
        },
        // === Clinical Data ===
        {
            method: "GET",
            path: "/studies/{studyId}/clinical-data",
            summary: "Get clinical data for all patients/samples in a study",
            category: "clinical_data",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
            ],
            queryParams: [
                { name: "clinicalDataType", type: "string", required: false, description: "SAMPLE or PATIENT", enum: ["SAMPLE", "PATIENT"] },
                { name: "projection", type: "string", required: false, description: "Detail level" },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        // === Sample Lists ===
        {
            method: "GET",
            path: "/studies/{studyId}/sample-lists",
            summary: "List sample lists for a study (e.g. all samples, sequenced samples)",
            category: "sample_lists",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
            ],
        },
        // === Copy Number ===
        {
            method: "GET",
            path: "/molecular-profiles/{molecularProfileId}/discrete-copy-number",
            summary: "Get discrete copy number alterations for a molecular profile",
            category: "copy_number",
            pathParams: [
                { name: "molecularProfileId", type: "string", required: true, description: "Molecular profile ID (e.g. brca_tcga_gistic)" },
            ],
            queryParams: [
                { name: "sampleListId", type: "string", required: false, description: "Sample list ID" },
                { name: "projection", type: "string", required: false, description: "Detail level" },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        // === Clinical Attributes ===
        {
            method: "GET",
            path: "/studies/{studyId}/clinical-attributes",
            summary: "List clinical attributes available for a study",
            category: "clinical_data",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
            ],
        },
    ],
};
