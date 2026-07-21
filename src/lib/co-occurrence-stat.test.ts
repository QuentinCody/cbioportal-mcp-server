import { describe, it, expect } from "vitest";
import {
    annotateOffPanelPairs,
    coOccurrence,
    panelCoverageFromGenePanelData,
    selectOffPanelGenes,
} from "./co-occurrence-stat";
import type { CoOccurrenceGene } from "./co-occurrence-stat";

const GENES: CoOccurrenceGene[] = [
    { symbol: "KRAS", entrezGeneId: 3845 },
    { symbol: "KEAP1", entrezGeneId: 9817 },
];

/**
 * Regression for the silent-wrong-answer bug: cBioPortal's mutations SUMMARY
 * projection returns hugoGeneSymbol=null. Membership must key on entrezGeneId,
 * and the full cohort size (not just mutation-bearing samples) must be the
 * denominator. Numbers mirror LUAD (luad_tcga_pan_can_atlas_2018, n=566):
 * KRAS=168, KEAP1=102, both=35.
 */
function makeSummaryMutations(): Record<string, unknown>[] {
    const muts: Record<string, unknown>[] = [];
    // 35 samples mutant in BOTH KRAS and KEAP1
    for (let i = 0; i < 35; i++) {
        muts.push({ entrezGeneId: 3845, hugoGeneSymbol: null, sampleId: `both_${i}` });
        muts.push({ entrezGeneId: 9817, hugoGeneSymbol: null, sampleId: `both_${i}` });
    }
    // 133 samples mutant in KRAS only (168 - 35)
    for (let i = 0; i < 133; i++) {
        muts.push({ entrezGeneId: 3845, hugoGeneSymbol: null, sampleId: `kras_${i}` });
    }
    // 67 samples mutant in KEAP1 only (102 - 35)
    for (let i = 0; i < 67; i++) {
        muts.push({ entrezGeneId: 9817, hugoGeneSymbol: null, sampleId: `keap1_${i}` });
    }
    return muts;
}

describe("coOccurrence", () => {
    it("keys on entrezGeneId when hugoGeneSymbol is null (SUMMARY projection)", () => {
        const result = coOccurrence(makeSummaryMutations(), GENES, 566);
        const pair = result.pairs[0];
        expect(pair.both).toBe(35);
        expect(pair.aOnly).toBe(133);
        expect(pair.bOnly).toBe(67);
        expect(pair.neither).toBe(566 - 35 - 133 - 67); // 331
        expect(pair.p_value).not.toBeNull();
        expect(pair.pattern).not.toBe("indeterminate");
    });

    it("uses the provided cohort size as the denominator, not mutation-bearing samples", () => {
        const result = coOccurrence(makeSummaryMutations(), GENES, 566);
        expect(result.total_samples).toBe(566);
        const pair = result.pairs[0];
        expect(pair.both + pair.aOnly + pair.bOnly + pair.neither).toBe(566);
    });

    it("falls back to hugoGeneSymbol when entrezGeneId does not match", () => {
        const muts: Record<string, unknown>[] = [
            { hugoGeneSymbol: "KRAS", sampleId: "s1" },
            { hugoGeneSymbol: "KEAP1", sampleId: "s1" },
            { hugoGeneSymbol: "KRAS", sampleId: "s2" },
        ];
        const result = coOccurrence(muts, GENES, 10);
        const pair = result.pairs[0];
        expect(pair.both).toBe(1);
        expect(pair.aOnly).toBe(1);
        expect(pair.bOnly).toBe(0);
        expect(pair.neither).toBe(8);
    });
});

describe("gene-panel coverage (#7: empty is not off-panel)", () => {
    it("collects distinct panel ids and detects no whole-exome samples", () => {
        expect(
            panelCoverageFromGenePanelData([
                { profiled: true, genePanelId: "IMPACT468" },
                { profiled: true, genePanelId: "IMPACT468" },
                { profiled: true, genePanelId: "IMPACT341" },
                { profiled: false, genePanelId: null },
            ]),
        ).toEqual({ panelIds: ["IMPACT468", "IMPACT341"], wholeGenome: false });
    });

    it("treats a profiled sample with no panel id as whole-genome coverage", () => {
        expect(
            panelCoverageFromGenePanelData([{ profiled: true, genePanelId: null }])
                .wholeGenome,
        ).toBe(true);
    });

    it("flags an unmutated gene absent from the panel as off-panel", () => {
        const genes: CoOccurrenceGene[] = [
            { symbol: "KRAS", entrezGeneId: 3845 },
            { symbol: "FOXA1", entrezGeneId: 3169 },
        ];
        expect(selectOffPanelGenes(genes, new Set([3845]), new Set([3845]))).toEqual([
            "FOXA1",
        ]);
    });

    it("never flags a gene that has mutations (proof it was sequenced)", () => {
        const genes: CoOccurrenceGene[] = [{ symbol: "TP53", entrezGeneId: 7157 }];
        expect(selectOffPanelGenes(genes, new Set([3845]), new Set([7157]))).toEqual(
            [],
        );
    });

    it("flags nothing when panel coverage is unknown (empty profiled set)", () => {
        const genes: CoOccurrenceGene[] = [{ symbol: "FOXA1", entrezGeneId: 3169 }];
        expect(selectOffPanelGenes(genes, new Set(), new Set())).toEqual([]);
    });

    it("marks pairs involving an off-panel gene as not_profiled", () => {
        const result = coOccurrence(makeSummaryMutations(), GENES, 566);
        annotateOffPanelPairs(result, ["KEAP1"]);
        expect(result.pairs[0].notProfiled).toBe(true);
        expect(result.pairs[0].pattern).toBe("not_profiled");
    });

    it("leaves pairs untouched when there are no off-panel genes", () => {
        const result = coOccurrence(makeSummaryMutations(), GENES, 566);
        annotateOffPanelPairs(result, []);
        expect(result.pairs[0].notProfiled).toBeUndefined();
        expect(result.pairs[0].pattern).not.toBe("not_profiled");
    });
});
