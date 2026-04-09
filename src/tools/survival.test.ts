import { describe, it, expect } from "vitest";
import type { ChartSpec } from "@bio-mcp/shared/charting/chart-types";

/**
 * Unit tests for the survival chart construction logic.
 * The full registerSurvival handler requires cBioPortal API + Durable Objects,
 * so we test the chart-building logic in isolation.
 */

function buildKmChartData(
	mutantCurve: Array<{ time: number; survival: number; at_risk: number }>,
	wildtypeCurve: Array<{ time: number; survival: number; at_risk: number }>,
): Record<string, unknown>[] {
	const chartData: Record<string, unknown>[] = [];
	for (const pt of mutantCurve) {
		chartData.push({
			time: pt.time,
			mutant: pt.survival,
			at_risk_mutant: pt.at_risk,
		});
	}
	for (const pt of wildtypeCurve) {
		const existing = chartData.find((r) => r.time === pt.time);
		if (existing) {
			existing.wildtype = pt.survival;
			existing.at_risk_wildtype = pt.at_risk;
		} else {
			chartData.push({
				time: pt.time,
				wildtype: pt.survival,
				at_risk_wildtype: pt.at_risk,
			});
		}
	}
	chartData.sort((a, b) => (a.time as number) - (b.time as number));
	return chartData;
}

function buildKmChartSpec(
	gene: string,
	studyId: string,
	endpoint: string,
	mutantN: number,
	wildtypeN: number,
	pValue: number | null,
	chartData: Record<string, unknown>[],
): ChartSpec {
	return {
		type: "line",
		title: `${endpoint.toUpperCase()} Survival: ${gene} in ${studyId}`,
		subtitle: `Log-rank p=${pValue !== null ? pValue.toExponential(2) : "N/A"}`,
		xKey: "time",
		xLabel: "Time (months)",
		yLabel: "Survival probability",
		series: [
			{ name: `${gene}-Mutant (n=${mutantN})`, dataKey: "mutant", color: "#e74c3c" },
			{ name: `Wildtype (n=${wildtypeN})`, dataKey: "wildtype", color: "#3498db" },
		],
		data: chartData,
		numberFormat: "percent",
		source: "cBioPortal",
	};
}

describe("buildKmChartData", () => {
	it("interleaves mutant and wildtype curves at matching timepoints", () => {
		const mutant = [
			{ time: 0, survival: 1.0, at_risk: 50 },
			{ time: 12, survival: 0.8, at_risk: 40 },
		];
		const wildtype = [
			{ time: 0, survival: 1.0, at_risk: 100 },
			{ time: 12, survival: 0.9, at_risk: 90 },
		];
		const data = buildKmChartData(mutant, wildtype);
		expect(data).toHaveLength(2);
		expect(data[0]).toEqual({
			time: 0,
			mutant: 1.0,
			at_risk_mutant: 50,
			wildtype: 1.0,
			at_risk_wildtype: 100,
		});
	});

	it("creates separate rows for non-overlapping timepoints", () => {
		const mutant = [{ time: 6, survival: 0.9, at_risk: 45 }];
		const wildtype = [{ time: 12, survival: 0.85, at_risk: 80 }];
		const data = buildKmChartData(mutant, wildtype);
		expect(data).toHaveLength(2);
		expect(data[0].time).toBe(6);
		expect(data[1].time).toBe(12);
	});

	it("sorts by time ascending", () => {
		const mutant = [{ time: 24, survival: 0.6, at_risk: 20 }];
		const wildtype = [{ time: 6, survival: 0.95, at_risk: 95 }];
		const data = buildKmChartData(mutant, wildtype);
		expect((data[0].time as number)).toBeLessThan(data[1].time as number);
	});

	it("handles empty curves", () => {
		expect(buildKmChartData([], [])).toEqual([]);
	});
});

describe("buildKmChartSpec", () => {
	it("produces a valid ChartSpec", () => {
		const data = [{ time: 0, mutant: 1, wildtype: 1 }];
		const spec = buildKmChartSpec("TP53", "brca_tcga", "os", 50, 200, 0.001, data);
		expect(spec.type).toBe("line");
		expect(spec.title).toContain("TP53");
		expect(spec.title).toContain("brca_tcga");
		expect(spec.series).toHaveLength(2);
		expect(spec.series[0].dataKey).toBe("mutant");
		expect(spec.series[1].dataKey).toBe("wildtype");
		expect(spec.subtitle).toContain("1.00e-3");
		expect(spec.source).toBe("cBioPortal");
	});

	it("handles null p-value", () => {
		const spec = buildKmChartSpec("BRAF", "study", "pfs", 10, 90, null, []);
		expect(spec.subtitle).toContain("N/A");
	});
});
