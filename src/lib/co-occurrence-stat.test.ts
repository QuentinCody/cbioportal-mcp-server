import { describe, it, expect } from "vitest";
import { coOccurrence } from "./co-occurrence-stat";
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
