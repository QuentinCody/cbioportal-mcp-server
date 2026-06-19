/**
 * Parity guard: the V8-isolate copy of the oncology stats (stats-source.ts,
 * injected as a string into Code Mode) must produce identical math to the
 * committed TypeScript source (co-occurrence-stat.ts).
 *
 * The silent-wrong co-occurrence bug existed because the TS path was fixed
 * (key on entrezGeneId, full-cohort denominator) while this hand-maintained
 * isolate copy drifted. This test fails the moment the two diverge again.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coOccurrence as tsCoOccurrence } from "./co-occurrence-stat";
import type { CoOccurrenceGene, CoOccurrenceResult } from "./co-occurrence-stat";

interface IsolateStats {
	coOccurrence(
		mutations: Record<string, unknown>[],
		genes: CoOccurrenceGene[],
		totalSamples: number,
		sampleIdField?: string,
	): CoOccurrenceResult;
}

/** Eval the isolate copy from stats-source.ts (the same string injected into the isolate). */
function loadIsolateStats(): IsolateStats {
	const src = readFileSync(join(import.meta.dirname, "stats-source.ts"), "utf8");
	const marker = "ONCOLOGY_STATS_SOURCE = `";
	const body = src.slice(src.indexOf(marker) + marker.length, src.lastIndexOf("`"));
	const factory = new Function(`${body}\nreturn stats;`);
	return factory() as IsolateStats;
}

const GENES: CoOccurrenceGene[] = [
	{ symbol: "KRAS", entrezGeneId: 3845 },
	{ symbol: "KEAP1", entrezGeneId: 9817 },
	{ symbol: "EGFR", entrezGeneId: 1956 },
];

/** SUMMARY-projection rows: entrezGeneId present, hugoGeneSymbol absent (the bug condition). */
function summaryRows(): Record<string, unknown>[] {
	const rows: Record<string, unknown>[] = [];
	const add = (entrezGeneId: number, samples: number[]) => {
		for (const s of samples) rows.push({ sampleId: `S${s}`, entrezGeneId });
	};
	add(3845, [1, 2, 3, 4, 5, 6]); // KRAS
	add(9817, [4, 5, 6, 7]); // KEAP1 — overlaps KRAS on 4,5,6
	add(1956, [10, 11]); // EGFR — disjoint
	return rows;
}

const pairKey = (p: { geneA: string; geneB: string }): string => `${p.geneA}|${p.geneB}`;

describe("cBioPortal stats: isolate stats-source.ts ↔ TS co-occurrence-stat.ts parity", () => {
	const iso = loadIsolateStats();

	it("isolate exposes coOccurrence", () => {
		expect(typeof iso.coOccurrence).toBe("function");
	});

	it("coOccurrence math is identical under the SUMMARY projection", () => {
		const rows = summaryRows();
		const total = 20;
		const ts = tsCoOccurrence(rows, GENES, total);
		const isolate = iso.coOccurrence(rows, GENES, total);

		expect(isolate.total_samples).toBe(ts.total_samples);
		expect(isolate.pairs.length).toBe(ts.pairs.length);

		const tsByKey = new Map(ts.pairs.map((p) => [pairKey(p), p]));
		for (const ip of isolate.pairs) {
			const tp = tsByKey.get(pairKey(ip));
			expect(tp, `pair ${pairKey(ip)} present in TS output`).toBeDefined();
			if (!tp) continue;
			expect(ip.both).toBe(tp.both);
			expect(ip.aOnly).toBe(tp.aOnly);
			expect(ip.bOnly).toBe(tp.bOnly);
			expect(ip.neither).toBe(tp.neither);
			expect(ip.pattern).toBe(tp.pattern);
			expect(Math.abs((ip.p_value ?? 1) - (tp.p_value ?? 1))).toBeLessThan(1e-9);
		}
	});

	it("keys on entrezGeneId (not the SUMMARY-null hugoGeneSymbol)", () => {
		// Symbol-keyed membership would yield both=0 under SUMMARY — the bug.
		const res = iso.coOccurrence(summaryRows(), GENES, 20);
		const krasKeap1 = res.pairs.find(
			(p) =>
				(p.geneA === "KRAS" && p.geneB === "KEAP1") ||
				(p.geneA === "KEAP1" && p.geneB === "KRAS"),
		);
		expect(krasKeap1?.both).toBe(3); // overlap on samples 4,5,6
	});
});
