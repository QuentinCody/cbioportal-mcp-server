/**
 * Oncology statistical functions — TypeScript versions of the algorithms
 * in stats-source.ts, callable from hand-built tools in the Worker context.
 */

// ── Types ──

export interface KaplanMeierResult {
    n: number;
    events: number;
    censored: number;
    median_survival: number | null;
    survival_1yr: number | null;
    survival_3yr: number | null;
    survival_5yr: number | null;
    curve: Array<{ time: number; survival: number; at_risk: number; events: number }>;
}

export interface LogRankResult {
    chi_squared: number | null;
    p_value: number | null;
    df: number;
}

export interface FisherExactResult {
    p_value: number | null;
    odds_ratio: number | null;
    log_odds_ratio: number | null;
}

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

export interface MannWhitneyResult {
    u_statistic: number | null;
    z_score: number | null;
    p_value: number | null;
}

export interface CohortSplitResult {
    mutant_patients: string[];
    wildtype_patients: string[];
    mutant_count: number;
    wildtype_count: number;
    total: number;
}

export interface MutationFrequencyResult {
    gene: string;
    mutated_samples: number;
    total_samples: number;
    frequency: number;
    frequency_pct: string;
    top_mutation_types: Array<{ name: string; count: number }>;
    top_protein_changes: Array<{ name: string; count: number }>;
}

export interface ExpressionStatsResult {
    n: number;
    mean: number | null;
    median: number | null;
    min: number | null;
    max: number | null;
    q1: number | null;
    q3: number | null;
    sd: number | null;
}

// ── Helpers ──

function round(value: number | null | undefined, decimals = 4): number | null {
    if (value === null || value === undefined || !isFinite(value)) return null;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function sortNumeric(arr: number[]): number[] {
    return arr.slice().sort((a, b) => a - b);
}

function median(sorted: number[]): number | null {
    const n = sorted.length;
    if (n === 0) return null;
    const mid = Math.floor(n / 2);
    return n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(sorted: number[], q: number): number | null {
    if (sorted.length === 0) return null;
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

/** Normal CDF approximation (Abramowitz & Stegun 26.2.17) */
function normalCDF(x: number): number {
    if (x === 0) return 0.5;
    const sign = x < 0 ? -1 : 1;
    const z = Math.abs(x);
    const t = 1.0 / (1.0 + 0.2316419 * z);
    const d = 0.3989422804014327;
    const p =
        d *
        Math.exp((-z * z) / 2.0) *
        (t *
            (0.31938153 +
                t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
    return sign > 0 ? 1 - p : p;
}

/** Chi-squared p-value for df=1 */
function chiSquaredPValue1df(x: number): number {
    if (x <= 0) return 1.0;
    return 2 * (1 - normalCDF(Math.sqrt(x)));
}

/** Lanczos log-gamma approximation */
function logGamma(z: number): number {
    if (z <= 0) return Infinity;
	const c = [
		0.999_999_999_999_809_93, 676.520_368_121_885_1, -1259.139_216_722_402_8, 771.323_428_777_653_1,
		-176.615_029_162_140_6, 12.507_343_278_686_905, -0.138_571_095_265_720_12, 9.984_369_578_019_571_6e-6,
		1.505_632_735_149_311_6e-7,
	];
    let x = c[0];
    for (let i = 1; i < 9; i++) x += c[i] / (z + i - 1);
    const t = z + 6.5;
    return 0.5 * Math.log(2 * Math.PI) + (z - 0.5) * Math.log(t) - t + Math.log(x);
}

function logChoose(n: number, k: number): number {
    if (k < 0 || k > n) return -Infinity;
    return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

// ── Public Functions ──

export function fisherExact2x2(a: number, b: number, c: number, d: number): FisherExactResult {
    const n = a + b + c + d;
    if (n === 0) return { p_value: 1, odds_ratio: null, log_odds_ratio: null };

    const or = b === 0 || c === 0 ? null : (a * d) / (b * c);
    const lor = or !== null && or > 0 ? Math.log(or) : null;

    const r1 = a + b;
    const r2 = c + d;
    const c1 = a + c;

    function logHyperProb(x: number): number {
        return logChoose(r1, x) + logChoose(r2, c1 - x) - logChoose(n, c1);
    }

    const observedLogP = logHyperProb(a);
    let pValue = 0;
    const minA = Math.max(0, c1 - r2);
    const maxA = Math.min(r1, c1);
    for (let x = minA; x <= maxA; x++) {
        if (logHyperProb(x) <= observedLogP + 1e-10) {
            pValue += Math.exp(logHyperProb(x));
        }
    }

    return {
        p_value: round(Math.min(1, pValue), 6),
        odds_ratio: round(or, 4),
        log_odds_ratio: round(lor, 4),
    };
}

export function kaplanMeier(
    patients: Record<string, unknown>[],
    timeField: string,
    statusField: string,
    eventValue: string | number,
): KaplanMeierResult {
    const empty: KaplanMeierResult = {
        n: 0, events: 0, censored: 0, median_survival: null,
        survival_1yr: null, survival_3yr: null, survival_5yr: null, curve: [],
    };
    if (!patients || patients.length === 0) return empty;

    const parsed: Array<{ time: number; event: number }> = [];
    for (const p of patients) {
        const t = parseFloat(String(p[timeField]));
        if (isNaN(t) || t < 0) continue;
        const s = String(p[statusField] ?? "");
        const isEvent =
            typeof eventValue === "string"
                ? s.includes(eventValue) || s === eventValue
                : String(s) === String(eventValue);
        parsed.push({ time: t, event: isEvent ? 1 : 0 });
    }

    if (parsed.length === 0) return empty;
    parsed.sort((a, b) => a.time - b.time);

    const n = parsed.length;
    let totalEvents = 0;
    let atRisk = n;
    let survival = 1.0;
    const curve: KaplanMeierResult["curve"] = [{ time: 0, survival: 1.0, at_risk: n, events: 0 }];
    let medianSurv: number | null = null;

    let i = 0;
    while (i < parsed.length) {
        const t = parsed[i].time;
        let d = 0;
        let c = 0;
        while (i < parsed.length && parsed[i].time === t) {
            if (parsed[i].event === 1) d++;
            else c++;
            i++;
        }
        if (d > 0) {
            survival *= 1 - d / atRisk;
            totalEvents += d;
            curve.push({ time: t, survival: round(survival, 6) as number, at_risk: atRisk, events: d });
            if (medianSurv === null && survival <= 0.5) medianSurv = t;
        }
        atRisk -= d + c;
    }

    function survivalAt(months: number): number | null {
        let s = 1.0;
        for (let j = 1; j < curve.length; j++) {
            if (curve[j].time > months) break;
            s = curve[j].survival;
        }
        return round(s, 4);
    }

    return {
        n,
        events: totalEvents,
        censored: n - totalEvents,
        median_survival: round(medianSurv, 2),
        survival_1yr: survivalAt(12),
        survival_3yr: survivalAt(36),
        survival_5yr: survivalAt(60),
        curve,
    };
}

export function logRank(
    group1: Record<string, unknown>[],
    group2: Record<string, unknown>[],
    timeField: string,
    statusField: string,
    eventValue: string | number,
): LogRankResult {
    function parseGroup(patients: Record<string, unknown>[]): Array<{ time: number; event: number }> {
        const out: Array<{ time: number; event: number }> = [];
        for (const p of patients) {
            const t = parseFloat(String(p[timeField]));
            if (isNaN(t) || t < 0) continue;
            const s = String(p[statusField] ?? "");
            const isEvent =
                typeof eventValue === "string"
                    ? s.includes(eventValue) || s === eventValue
                    : String(s) === String(eventValue);
            out.push({ time: t, event: isEvent ? 1 : 0 });
        }
        return out;
    }

    const g1 = parseGroup(group1);
    const g2 = parseGroup(group2);
    if (g1.length === 0 || g2.length === 0) return { chi_squared: null, p_value: null, df: 1 };

    const allTimes = new Set<number>();
    for (const p of g1) if (p.event === 1) allTimes.add(p.time);
    for (const p of g2) if (p.event === 1) allTimes.add(p.time);
    const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

    g1.sort((a, b) => a.time - b.time);
    g2.sort((a, b) => a.time - b.time);

    let n1 = g1.length;
    let n2 = g2.length;
    let idx1 = 0;
    let idx2 = 0;
    let sumOE = 0;
    let sumV = 0;

    for (const t of sortedTimes) {
        while (idx1 < g1.length && g1[idx1].time < t && g1[idx1].event === 0) { n1--; idx1++; }
        while (idx2 < g2.length && g2[idx2].time < t && g2[idx2].event === 0) { n2--; idx2++; }

        let d1 = 0;
        let d2 = 0;
        let lost1 = 0;
        let lost2 = 0;
        let j1 = idx1;
        while (j1 < g1.length && g1[j1].time === t) {
            if (g1[j1].event === 1) d1++;
            else lost1++;
            j1++;
        }
        let j2 = idx2;
        while (j2 < g2.length && g2[j2].time === t) {
            if (g2[j2].event === 1) d2++;
            else lost2++;
            j2++;
        }

        const d = d1 + d2;
        const nTotal = n1 + n2;
        if (nTotal > 0 && d > 0) {
            const e1 = (n1 * d) / nTotal;
            sumOE += d1 - e1;
            if (nTotal > 1) sumV += (n1 * n2 * d * (nTotal - d)) / (nTotal * nTotal * (nTotal - 1));
        }

        n1 -= d1 + lost1;
        n2 -= d2 + lost2;
        idx1 = j1;
        idx2 = j2;
    }

    if (sumV <= 0) return { chi_squared: 0, p_value: 1, df: 1 };
    const chi2 = (sumOE * sumOE) / sumV;
    const pVal = chiSquaredPValue1df(chi2);

    return { chi_squared: round(chi2, 4), p_value: round(pVal, 6), df: 1 };
}

export function mannWhitneyU(group1Values: number[], group2Values: number[]): MannWhitneyResult {
    if (!group1Values?.length || !group2Values?.length) {
        return { u_statistic: null, z_score: null, p_value: null };
    }

    const n1 = group1Values.length;
    const n2 = group2Values.length;
    const combined: Array<{ value: number; group: number; rank: number }> = [];
    for (const v of group1Values) combined.push({ value: v, group: 1, rank: 0 });
    for (const v of group2Values) combined.push({ value: v, group: 2, rank: 0 });
    combined.sort((a, b) => a.value - b.value);

    let i = 0;
    while (i < combined.length) {
        let j = i;
        while (j < combined.length && combined[j].value === combined[i].value) j++;
        const avgRank = (i + 1 + j) / 2;
        for (let k = i; k < j; k++) combined[k].rank = avgRank;
        i = j;
    }

    let r1 = 0;
    for (const c of combined) if (c.group === 1) r1 += c.rank;
    const u1 = r1 - (n1 * (n1 + 1)) / 2;
    const u2 = n1 * n2 - u1;
    const u = Math.min(u1, u2);
    const mu = (n1 * n2) / 2;
    const sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);

    if (sigma === 0) return { u_statistic: u, z_score: 0, p_value: 1 };
    const z = (u - mu) / sigma;
    const pVal = 2 * (1 - normalCDF(Math.abs(z)));

    return { u_statistic: round(u, 2), z_score: round(z, 4), p_value: round(pVal, 6) };
}

export function coOccurrence(
    mutations: Record<string, unknown>[],
    genes: string[],
    sampleIdField = "sampleId",
): CoOccurrenceResult {
    const geneSets = new Map<string, Set<string>>();
    const allSamples = new Set<string>();
    for (const g of genes) geneSets.set(g, new Set());

    for (const m of mutations) {
        const gene = String(m.hugoGeneSymbol ?? m.gene ?? "");
        const sample = String(m[sampleIdField] ?? "");
        if (gene && sample && geneSets.has(gene)) geneSets.get(gene)!.add(sample);
        if (sample) allSamples.add(sample);
    }

    const totalSamples = allSamples.size;
    const pairs: CoOccurrencePair[] = [];

    for (let i = 0; i < genes.length; i++) {
        for (let j = i + 1; j < genes.length; j++) {
            const sA = geneSets.get(genes[i])!;
            const sB = geneSets.get(genes[j])!;
            let both = 0;
            for (const s of sA) if (sB.has(s)) both++;
            const aOnly = sA.size - both;
            const bOnly = sB.size - both;
            const neither = totalSamples - both - aOnly - bOnly;

            const fisher = fisherExact2x2(both, aOnly, bOnly, neither);
            pairs.push({
                geneA: genes[i],
                geneB: genes[j],
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

export function cohortSplit(
    mutations: Record<string, unknown>[],
    sampleToPatient: Map<string, string>,
    gene: string,
    allPatientIds: Set<string>,
    sampleIdField = "sampleId",
): CohortSplitResult {
    const mutatedSamples = new Set<string>();
    for (const m of mutations) {
        const g = String(m.hugoGeneSymbol ?? m.gene ?? "");
        if (g.toUpperCase() === gene.toUpperCase()) {
            mutatedSamples.add(String(m[sampleIdField] ?? ""));
        }
    }

    const mutantPatients = new Set<string>();
    for (const sid of mutatedSamples) {
        const pid = sampleToPatient.get(sid);
        if (pid) mutantPatients.add(pid);
    }

    const mutant: string[] = [];
    const wildtype: string[] = [];
    for (const pid of allPatientIds) {
        if (mutantPatients.has(pid)) mutant.push(pid);
        else wildtype.push(pid);
    }

    return {
        mutant_patients: mutant,
        wildtype_patients: wildtype,
        mutant_count: mutant.length,
        wildtype_count: wildtype.length,
        total: allPatientIds.size,
    };
}

export function mutationFrequency(
    mutations: Record<string, unknown>[],
    totalSamples: number,
    geneField = "hugoGeneSymbol",
    sampleIdField = "sampleId",
): MutationFrequencyResult {
    const mutatedSamples = new Set<string>();
    const typeCounts: Record<string, number> = {};
    const proteinCounts: Record<string, number> = {};

    for (const m of mutations) {
        mutatedSamples.add(String(m[sampleIdField] ?? ""));
        const mt = String(m.mutationType ?? m.mutation_type ?? "");
        if (mt) typeCounts[mt] = (typeCounts[mt] ?? 0) + 1;
        const pc = String(m.proteinChange ?? m.protein_change ?? "");
        if (pc) proteinCounts[pc] = (proteinCounts[pc] ?? 0) + 1;
    }

    const freq = totalSamples > 0 ? mutatedSamples.size / totalSamples : 0;

    function topN(obj: Record<string, number>, n: number): Array<{ name: string; count: number }> {
        return Object.entries(obj)
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([name, count]) => ({ name, count }));
    }

    return {
        gene: mutations[0] ? String(mutations[0][geneField] ?? "unknown") : "unknown",
        mutated_samples: mutatedSamples.size,
        total_samples: totalSamples,
        frequency: round(freq, 4) as number,
        frequency_pct: `${round(freq * 100, 2)}%`,
        top_mutation_types: topN(typeCounts, 10),
        top_protein_changes: topN(proteinCounts, 10),
    };
}

export function expressionStats(values: number[]): ExpressionStatsResult {
    const nums = values.filter((v) => v !== null && v !== undefined && !isNaN(v));
    if (nums.length === 0) {
        return { n: 0, mean: null, median: null, min: null, max: null, q1: null, q3: null, sd: null };
    }

    const sorted = sortNumeric(nums);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const sumSqDiff = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0);
    const sd = n > 1 ? Math.sqrt(sumSqDiff / (n - 1)) : 0;

    return {
        n,
        mean: round(mean, 4),
        median: round(median(sorted), 4),
        min: round(sorted[0], 4),
        max: round(sorted[n - 1], 4),
        q1: round(quantile(sorted, 0.25), 4),
        q3: round(quantile(sorted, 0.75), 4),
        sd: round(sd, 4),
    };
}
