/**
 * Pairwise mutation co-occurrence analysis for cBioPortal studies.
 * Extracted from stats.ts to keep that module under the line cap.
 */
import { fisherExact2x2 } from "./stats";

export interface CoOccurrencePair {
    geneA: string;
    geneB: string;
    both: number;
    aOnly: number;
    bOnly: number;
    neither: number;
    log_odds_ratio: number | null;
    p_value: number | null;
    pattern: string;
}

export interface CoOccurrenceResult {
    pairs: CoOccurrencePair[];
    total_samples: number;
}

export interface CoOccurrenceGene {
    symbol: string;
    entrezGeneId: number;
}

export function coOccurrence(
    mutations: Record<string, unknown>[],
    genes: CoOccurrenceGene[],
    totalSamples: number,
    sampleIdField = "sampleId",
): CoOccurrenceResult {
    // Key membership on entrezGeneId: the cBioPortal mutations SUMMARY projection
    // returns hugoGeneSymbol=null, so symbol-based matching silently yields empty
    // sets (both/aOnly/bOnly all 0). entrezGeneId is always present. Fall back to
    // symbol when an id doesn't match (e.g. richer projections from Code Mode).
    const symbols = genes.map((g) => g.symbol);
    const geneSets = new Map<string, Set<string>>();
    const byEntrez = new Map<number, string>();
    for (const g of genes) {
        geneSets.set(g.symbol, new Set());
        byEntrez.set(g.entrezGeneId, g.symbol);
    }

    for (const m of mutations) {
        const sample = String(m[sampleIdField] ?? "");
        if (!sample) continue;
        const entrez = typeof m.entrezGeneId === "number" ? m.entrezGeneId : Number(m.entrezGeneId);
        let symbol = byEntrez.get(entrez);
        if (!symbol) {
            const hugo = String(m.hugoGeneSymbol ?? m.gene ?? "");
            if (geneSets.has(hugo)) symbol = hugo;
        }
        if (symbol) geneSets.get(symbol)!.add(sample);
    }

    const pairs: CoOccurrencePair[] = [];

    for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
            const sA = geneSets.get(symbols[i])!;
            const sB = geneSets.get(symbols[j])!;
            let both = 0;
            for (const s of sA) if (sB.has(s)) both++;
            const aOnly = sA.size - both;
            const bOnly = sB.size - both;
            const neither = totalSamples - both - aOnly - bOnly;

            const fisher = fisherExact2x2(both, aOnly, bOnly, neither);
            pairs.push({
                geneA: symbols[i],
                geneB: symbols[j],
                both,
                aOnly,
                bOnly,
                neither,
                log_odds_ratio: fisher.log_odds_ratio,
                p_value: fisher.p_value,
                pattern:
                    fisher.log_odds_ratio !== null
                        ? fisher.log_odds_ratio > 0
                            ? "co-occurring"
                            : "mutually exclusive"
                        : "indeterminate",
            });
        }
    }

    pairs.sort((a, b) => (a.p_value ?? 1) - (b.p_value ?? 1));
    return { pairs, total_samples: totalSamples };
}
