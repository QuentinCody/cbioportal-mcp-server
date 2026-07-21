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
    /**
     * True when geneA or geneB is NOT profiled in the study's sequencing panel,
     * so its 0 mutation count means "not measured here", NOT "never co-mutated"
     * (#7). When set, `pattern` is "not_profiled" and the counts are unreliable.
     */
    notProfiled?: boolean;
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

/** A per-sample gene-panel-data row from cBioPortal
 *  (`POST /molecular-profiles/{id}/gene-panel-data/fetch`). */
export interface GenePanelDataRow {
    profiled?: boolean;
    genePanelId?: string | null;
}

/**
 * Reduce cBioPortal gene-panel-data to the distinct panel ids used, and whether
 * any sample was whole-exome/genome profiled (a profiled sample with NO panel id
 * = every gene covered). Pure — the caller fetches the rows (#7).
 */
export function panelCoverageFromGenePanelData(rows: GenePanelDataRow[]): {
    panelIds: string[];
    wholeGenome: boolean;
} {
    const panelIds = new Set<string>();
    let wholeGenome = false;
    for (const r of rows) {
        if (r.profiled === false) continue;
        if (r.genePanelId) panelIds.add(r.genePanelId);
        else wholeGenome = true;
    }
    return { panelIds: [...panelIds], wholeGenome };
}

/**
 * Of the query `genes`, which are NOT profiled in the study — entrezGeneId absent
 * from the panels' `profiledEntrez` set AND no mutations (a mutation proves the
 * gene WAS sequenced, so it cannot be off-panel). Returns symbols. Empty when
 * `profiledEntrez` is empty (coverage unknown -> flag nothing) (#7).
 */
export function selectOffPanelGenes(
    genes: CoOccurrenceGene[],
    profiledEntrez: Set<number>,
    mutatedEntrez: Set<number>,
): string[] {
    if (profiledEntrez.size === 0) return [];
    return genes
        .filter(
            (g) =>
                !profiledEntrez.has(g.entrezGeneId) &&
                !mutatedEntrez.has(g.entrezGeneId),
        )
        .map((g) => g.symbol);
}

/**
 * Flag pairs involving an off-panel gene. cBioPortal returns 0 mutations for a
 * gene absent from the study's panel, which looks identical to a gene that is
 * truly never co-mutated (both/aOnly=0, neither=totalSamples) — the "empty !=
 * absence" footgun (#7). Mutates and returns `result`.
 */
export function annotateOffPanelPairs(
    result: CoOccurrenceResult,
    offPanelSymbols: Iterable<string>,
): CoOccurrenceResult {
    const offPanel = new Set(offPanelSymbols);
    if (offPanel.size === 0) return result;
    for (const pair of result.pairs) {
        if (offPanel.has(pair.geneA) || offPanel.has(pair.geneB)) {
            pair.notProfiled = true;
            pair.pattern = "not_profiled";
        }
    }
    return result;
}
