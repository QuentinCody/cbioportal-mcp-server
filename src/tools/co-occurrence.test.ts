import { describe, it, expect } from "vitest";
import type { ChartSpec } from "@bio-mcp/shared/charting/chart-types";

/**
 * Unit tests for the co-occurrence chart construction logic.
 * The full registerCoOccurrence handler requires cBioPortal API + Durable Objects,
 * so we test the chart-building logic in isolation.
 */

interface CoOccurrencePairInput {
	geneA: string;
	geneB: string;
	log_odds_ratio: number | null;
	pattern: string;
	p_value: number | null;
}

function buildCoOccurrenceChartData(
	pairs: CoOccurrencePairInput[],
): Record<string, unknown>[] {
	return pairs.map((pair) => ({
		pair: `${pair.geneA}\u2013${pair.geneB}`,
		log_odds_ratio: pair.log_odds_ratio ?? 0,
		pattern: pair.pattern,
		p_value: pair.p_value,
	}));
}

function buildCoOccurrenceChartSpec(
	genes: string[],
	studyId: string,
	totalSamples: number,
	chartData: Record<string, unknown>[],
): ChartSpec {
	return {
		type: "horizontal-bar",
		title: `Mutation Co-Occurrence: ${genes.join(", ")}`,
		subtitle: `Study: ${studyId} (n=${totalSamples})`,
		xKey: "pair",
		xLabel: "Gene Pair",
		yLabel: "Log Odds Ratio",
		series: [{ name: "Log Odds Ratio", dataKey: "log_odds_ratio" }],
		data: chartData,
		sort: "desc",
		source: "cBioPortal",
	};
}

describe("buildCoOccurrenceChartData", () => {
	it("maps pairs to chart rows with en-dash separator", () => {
		const pairs: CoOccurrencePairInput[] = [
			{ geneA: "TP53", geneB: "KRAS", log_odds_ratio: 1.5, pattern: "Co-occurrence", p_value: 0.01 },
		];
		const data = buildCoOccurrenceChartData(pairs);
		expect(data).toHaveLength(1);
		expect(data[0].pair).toBe("TP53\u2013KRAS");
		expect(data[0].log_odds_ratio).toBe(1.5);
	});

	it("defaults null log_odds_ratio to 0", () => {
		const pairs: CoOccurrencePairInput[] = [
			{ geneA: "A", geneB: "B", log_odds_ratio: null, pattern: "Tendency towards co-occurrence", p_value: null },
		];
		const data = buildCoOccurrenceChartData(pairs);
		expect(data[0].log_odds_ratio).toBe(0);
	});

	it("handles empty pairs", () => {
		expect(buildCoOccurrenceChartData([])).toEqual([]);
	});
});

describe("buildCoOccurrenceChartSpec", () => {
	it("produces a valid horizontal-bar ChartSpec", () => {
		const data = [{ pair: "TP53\u2013KRAS", log_odds_ratio: 1.5 }];
		const spec = buildCoOccurrenceChartSpec(["TP53", "KRAS"], "msk_impact_2017", 10000, data);
		expect(spec.type).toBe("horizontal-bar");
		expect(spec.title).toContain("TP53");
		expect(spec.title).toContain("KRAS");
		expect(spec.subtitle).toContain("msk_impact_2017");
		expect(spec.subtitle).toContain("10000");
		expect(spec.series).toHaveLength(1);
		expect(spec.series[0].dataKey).toBe("log_odds_ratio");
		expect(spec.source).toBe("cBioPortal");
	});
});
