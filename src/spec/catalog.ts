import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const cbioportalCatalog: ApiCatalog = {
    name: "cBioPortal REST API",
    baseUrl: "https://www.cbioportal.org/api",
    version: "1.0",
    auth: "none",
    endpointCount: 24,
    notes:
        "- Public REST API with Swagger docs at /api-docs\n" +
        "- Study IDs follow pattern: cancer_source (e.g. brca_tcga, luad_tcga_pan_can_atlas_2018)\n" +
        "- Molecular profile IDs = studyId + '_mutations' or '_gistic' or '_rna_seq_v2_mrna'\n" +
        "- Most endpoints return JSON arrays; use pageSize/pageNumber for pagination\n" +
        "- No auth required\n" +
        "- STATS HELPERS available in execute: stats.kaplanMeier(patients, timeField, statusField, eventValue) → KM survival estimator\n" +
        "- stats.logRank(group1, group2, timeField, statusField, eventValue) → log-rank test comparing two survival curves\n" +
        "- stats.fisherExact2x2(a, b, c, d) → Fisher's exact test for 2x2 contingency table\n" +
        "- stats.coOccurrence(mutations, genes, totalSamples, sampleIdField) → pairwise mutation co-occurrence with Fisher's p-values. genes = [{symbol, entrezGeneId}]; membership keys on entrezGeneId (SUMMARY mutations omit hugoGeneSymbol). Pass totalSamples = the FULL cohort size (e.g. /studies/{id}/samples length), NOT just mutation-bearing samples.\n" +
        "- stats.mannWhitneyU(values1, values2) → Mann-Whitney U rank-sum test\n" +
        "- stats.cohortSplit(mutations, clinicalData, gene, sampleIdField, patientIdField) → split mutant/wildtype cohorts. Pass gene = entrezGeneId (number) so it works under the SUMMARY projection; a Hugo symbol string only matches richer projections.\n" +
        "- stats.mutationFrequency(mutations, totalSamples, geneField, sampleIdField) → per-gene mutation frequency\n" +
        "- stats.expressionStats(values) → summary statistics (n, mean, median, min, max, q1, q3, sd)",
    endpoints: [
        // === Studies ===
        {
            method: "GET",
            path: "/studies",
            summary: "List all studies, optionally filtered by keyword or cancer type",
            category: "studies",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Search keyword for study name/description (honored — a zero-row answer here is a real zero-hit)" },
                { name: "pageSize", type: "number", required: false, description: "Results per page (default 1000000)" },
                { name: "pageNumber", type: "number", required: false, description: "Page number (0-based)" },
                {
                    name: "projection",
                    type: "string",
                    required: false,
                    description:
                        "Response detail level. SUMMARY or DETAILED ONLY on this endpoint: cBioPortal answers 200 with an EMPTY ARRAY for projection=ID here (verified live 2026-07-16; ID works fine on /cancer-types, /genes and /gene-panels), and projection=META always returns an empty body with the count in the total-count header — which this adapter does not surface. Both read as 'cBioPortal has no studies', so the adapter rejects them.",
                    enum: ["SUMMARY", "DETAILED"],
                },
            ],
            usageHint: "To list study IDs cheaply use projection:'SUMMARY' with pageSize and read .studyId — NOT projection:'ID', which returns [].",
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
        // === Molecular Data (Expression, Protein, Methylation) ===
        {
            method: "GET",
            path: "/molecular-profiles/{molecularProfileId}/molecular-data",
            summary: "Get molecular data (mRNA expression, protein levels, methylation) for a molecular profile. Use with expression profiles like {studyId}_rna_seq_v2_mrna.",
            category: "molecular_data",
            pathParams: [
                { name: "molecularProfileId", type: "string", required: true, description: "Molecular profile ID (e.g. brca_tcga_rna_seq_v2_mrna, brca_tcga_rppa)" },
            ],
            queryParams: [
                { name: "sampleListId", type: "string", required: true, description: "Sample list ID (e.g. brca_tcga_all)" },
                { name: "entrezGeneId", type: "number", required: true, description: "Entrez Gene ID" },
                { name: "projection", type: "string", required: false, description: "Detail level", enum: ["SUMMARY", "DETAILED", "ID"] },
            ],
        },
        {
            method: "POST",
            path: "/molecular-profiles/{molecularProfileId}/molecular-data/fetch",
            summary: "Fetch molecular data by sample IDs (batch). Body: {sampleIds: string[], entrezGeneIds: number[]}",
            category: "molecular_data",
            pathParams: [
                { name: "molecularProfileId", type: "string", required: true, description: "Molecular profile ID" },
            ],
        },
        // === Structural Variants (Fusions) ===
        {
            method: "POST",
            path: "/structural-variant/fetch",
            summary: "Fetch structural variants (fusions, rearrangements). Body: {molecularProfileIds: string[], entrezGeneIds: number[]}. Essential for fusion-driven cancers (ALK-EML4, BCR-ABL).",
            category: "structural_variants",
        },
        // === Batch Mutations ===
        {
            method: "POST",
            path: "/molecular-profiles/{molecularProfileId}/mutations/fetch",
            summary: "Fetch mutations by specific sample IDs (batch). Body: {sampleIds: string[], entrezGeneIds: number[]}",
            category: "mutations",
            pathParams: [
                { name: "molecularProfileId", type: "string", required: true, description: "Molecular profile ID (e.g. brca_tcga_mutations)" },
            ],
        },
        // === Gene Panels ===
        {
            method: "GET",
            path: "/gene-panels",
            summary: "List all gene panels (e.g. MSK-IMPACT, FoundationOne) with their IDs",
            category: "gene_panels",
        },
        {
            method: "GET",
            path: "/gene-panels/{genePanelId}",
            summary: "Get a specific gene panel including its full gene list",
            category: "gene_panels",
            pathParams: [
                { name: "genePanelId", type: "string", required: true, description: "Gene panel ID (e.g. IMPACT468)" },
            ],
        },
        // === Pre-computed Analysis Results ===
        {
            method: "GET",
            path: "/studies/{studyId}/significantly-mutated-genes",
            summary: "Get significantly mutated genes (MutSig results) for a study, with p-values and q-values",
            category: "analysis",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
            ],
        },
        {
            method: "GET",
            path: "/studies/{studyId}/significant-copy-number-regions",
            summary: "Get significant copy number regions (GISTIC results) for a study, with cytobands and affected genes",
            category: "analysis",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
            ],
        },
        // === Clinical Events (Treatment Timeline) ===
        {
            method: "GET",
            path: "/studies/{studyId}/patients/{patientId}/clinical-events",
            summary: "Get clinical timeline events for a patient (diagnosis, treatment, imaging, status changes)",
            category: "clinical_events",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
                { name: "patientId", type: "string", required: true, description: "Patient ID" },
            ],
        },
        // === Mutation Spectrums (Mutational Signatures) ===
        {
            method: "POST",
            path: "/molecular-profiles/{molecularProfileId}/mutation-spectrums/fetch",
            summary: "Fetch mutation spectrums (C>A, C>G, C>T, T>A, T>C, T>G base substitution counts) per sample. Body: {sampleIds: string[]}",
            category: "analysis",
            pathParams: [
                { name: "molecularProfileId", type: "string", required: true, description: "Molecular profile ID (e.g. brca_tcga_mutations)" },
            ],
        },
        // === Per-Patient Clinical Data ===
        {
            method: "GET",
            path: "/studies/{studyId}/patients/{patientId}/clinical-data",
            summary: "Get all clinical data for a specific patient",
            category: "clinical_data",
            pathParams: [
                { name: "studyId", type: "string", required: true, description: "Study ID" },
                { name: "patientId", type: "string", required: true, description: "Patient ID" },
            ],
        },
    ],
};
