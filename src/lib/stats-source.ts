/**
 * Oncology computational helpers — JavaScript source string injected into
 * the V8 isolate as a preamble so user code can call stats.* functions.
 *
 * Functions: kaplanMeier, logRank, fisherExact2x2, coOccurrence,
 * mannWhitneyU, cohortSplit, mutationFrequency, expressionStats
 *
 * All p-value computations use approximations that work without external
 * libraries (Abramowitz-Stegun for normal CDF, log-gamma for Fisher's exact).
 */

export const ONCOLOGY_STATS_SOURCE = `
// --- stats: oncology computational helpers ---
const stats = (() => {
  function round(value, decimals) {
    if (value === null || value === undefined || !isFinite(value)) return null;
    const factor = 10 ** (decimals || 4);
    return Math.round(value * factor) / factor;
  }

  function sortNumeric(arr) {
    return arr.slice().sort((a, b) => a - b);
  }

  function median(sorted) {
    const n = sorted.length;
    if (n === 0) return null;
    const mid = Math.floor(n / 2);
    return n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function quantile(sorted, q) {
    if (sorted.length === 0) return null;
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
  }

  // --- Normal CDF approximation (Abramowitz & Stegun 26.2.17) ---
  function normalCDF(x) {
    if (x === 0) return 0.5;
    const sign = x < 0 ? -1 : 1;
    const z = Math.abs(x);
    const t = 1.0 / (1.0 + 0.2316419 * z);
    const d = 0.3989422804014327; // 1/sqrt(2*PI)
    const p = d * Math.exp(-z * z / 2.0) *
      (t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
        t * (-1.821255978 + t * 1.330274429)))));
    return sign > 0 ? 1 - p : p;
  }

  // Chi-squared CDF for df=1: P(X <= x) = 2 * normalCDF(sqrt(x)) - 1
  function chiSquaredPValue1df(x) {
    if (x <= 0) return 1.0;
    return 2 * (1 - normalCDF(Math.sqrt(x)));
  }

  // --- Log-gamma via Stirling (Lanczos approximation) ---
  function logGamma(z) {
    if (z <= 0) return Infinity;
    const g = 7;
    const c = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i - 1);
    const t = z + g - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z - 0.5) * Math.log(t) - t + Math.log(x);
  }

  function logChoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
  }

  // --- Fisher's exact test (2x2) ---
  function fisherExact2x2(a, b, c, d) {
    const n = a + b + c + d;
    if (n === 0) return { p_value: 1, odds_ratio: null, log_odds_ratio: null };

    const or = (b === 0 || c === 0) ? null : (a * d) / (b * c);
    const lor = or !== null && or > 0 ? Math.log(or) : null;

    // Hypergeometric probability for a given cell value
    const r1 = a + b, r2 = c + d, c1 = a + c;
    function logHyperProb(x) {
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

  // --- Kaplan-Meier survival estimator ---
  function kaplanMeier(patients, timeField, statusField, eventValue) {
    if (!patients || patients.length === 0) {
      return { n: 0, events: 0, censored: 0, median_survival: null,
               survival_1yr: null, survival_3yr: null, survival_5yr: null, curve: [] };
    }

    // Parse and validate patient data
    const parsed = [];
    for (const p of patients) {
      const t = parseFloat(p[timeField]);
      if (isNaN(t) || t < 0) continue;
      const s = String(p[statusField] || "");
      const isEvent = typeof eventValue === "string"
        ? s.includes(eventValue) || s === eventValue
        : s == eventValue;
      parsed.push({ time: t, event: isEvent ? 1 : 0 });
    }

    if (parsed.length === 0) {
      return { n: 0, events: 0, censored: 0, median_survival: null,
               survival_1yr: null, survival_3yr: null, survival_5yr: null, curve: [] };
    }

    parsed.sort((a, b) => a.time - b.time);

    const n = parsed.length;
    let totalEvents = 0;
    let atRisk = n;
    let survival = 1.0;
    const curve = [{ time: 0, survival: 1.0, at_risk: n, events: 0 }];
    let medianSurv = null;

    // Group by unique time points
    let i = 0;
    while (i < parsed.length) {
      const t = parsed[i].time;
      let d = 0; // events at this time
      let c = 0; // censored at this time
      while (i < parsed.length && parsed[i].time === t) {
        if (parsed[i].event === 1) d++;
        else c++;
        i++;
      }
      if (d > 0) {
        survival *= (1 - d / atRisk);
        totalEvents += d;
        curve.push({ time: t, survival: round(survival, 6), at_risk: atRisk, events: d });
        if (medianSurv === null && survival <= 0.5) {
          medianSurv = t;
        }
      }
      atRisk -= (d + c);
    }

    // Interpolate landmark survivals
    function survivalAt(months) {
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

  // --- Log-rank test (comparing two survival curves) ---
  function logRank(group1, group2, timeField, statusField, eventValue) {
    function parseGroup(patients) {
      const out = [];
      for (const p of patients) {
        const t = parseFloat(p[timeField]);
        if (isNaN(t) || t < 0) continue;
        const s = String(p[statusField] || "");
        const isEvent = typeof eventValue === "string"
          ? s.includes(eventValue) || s === eventValue
          : s == eventValue;
        out.push({ time: t, event: isEvent ? 1 : 0 });
      }
      return out;
    }

    const g1 = parseGroup(group1);
    const g2 = parseGroup(group2);

    if (g1.length === 0 || g2.length === 0) {
      return { chi_squared: null, p_value: null, df: 1 };
    }

    // Collect all distinct event times
    const allTimes = new Set();
    for (const p of g1) if (p.event === 1) allTimes.add(p.time);
    for (const p of g2) if (p.event === 1) allTimes.add(p.time);
    const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

    // Sort groups by time
    g1.sort((a, b) => a.time - b.time);
    g2.sort((a, b) => a.time - b.time);

    let n1 = g1.length, n2 = g2.length;
    let idx1 = 0, idx2 = 0;
    let sumOE = 0, sumV = 0;

    for (const t of sortedTimes) {
      // Remove subjects lost before time t (censored before t)
      while (idx1 < g1.length && g1[idx1].time < t && g1[idx1].event === 0) { n1--; idx1++; }
      while (idx2 < g2.length && g2[idx2].time < t && g2[idx2].event === 0) { n2--; idx2++; }

      // Count events and at-risk at time t
      let d1 = 0, d2 = 0;
      let lost1 = 0, lost2 = 0;
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
      const n = n1 + n2;
      if (n > 0 && d > 0) {
        const e1 = n1 * d / n;
        sumOE += (d1 - e1);
        if (n > 1) {
          sumV += (n1 * n2 * d * (n - d)) / (n * n * (n - 1));
        }
      }

      // Remove subjects at time t
      n1 -= (d1 + lost1);
      n2 -= (d2 + lost2);
      idx1 = j1;
      idx2 = j2;
    }

    if (sumV <= 0) return { chi_squared: 0, p_value: 1, df: 1 };
    const chi2 = (sumOE * sumOE) / sumV;
    const pVal = chiSquaredPValue1df(chi2);

    return {
      chi_squared: round(chi2, 4),
      p_value: round(pVal, 6),
      df: 1,
    };
  }

  // --- Mann-Whitney U test ---
  function mannWhitneyU(group1Values, group2Values) {
    if (!group1Values || !group2Values || group1Values.length === 0 || group2Values.length === 0) {
      return { u_statistic: null, z_score: null, p_value: null };
    }

    const n1 = group1Values.length, n2 = group2Values.length;
    const combined = [];
    for (let i = 0; i < n1; i++) combined.push({ value: group1Values[i], group: 1 });
    for (let i = 0; i < n2; i++) combined.push({ value: group2Values[i], group: 2 });
    combined.sort((a, b) => a.value - b.value);

    // Assign ranks with tie handling
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
    const u1 = r1 - n1 * (n1 + 1) / 2;
    const u2 = n1 * n2 - u1;
    const u = Math.min(u1, u2);
    const mu = n1 * n2 / 2;
    const sigma = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12);

    if (sigma === 0) return { u_statistic: u, z_score: 0, p_value: 1 };
    const z = (u - mu) / sigma;
    const pVal = 2 * (1 - normalCDF(Math.abs(z)));

    return {
      u_statistic: round(u, 2),
      z_score: round(z, 4),
      p_value: round(pVal, 6),
    };
  }

  // --- Mutation co-occurrence analysis ---
  function coOccurrence(mutations, genes, sampleIdField) {
    sampleIdField = sampleIdField || "sampleId";
    const geneField = "hugoGeneSymbol";

    // Build per-gene sample sets
    const geneSets = {};
    const allSamples = new Set();
    for (const g of genes) geneSets[g] = new Set();
    for (const m of mutations) {
      const gene = m[geneField] || m.hugoGeneSymbol || m.gene;
      const sample = m[sampleIdField];
      if (gene && sample && geneSets[gene]) {
        geneSets[gene].add(sample);
      }
      if (sample) allSamples.add(sample);
    }

    const totalSamples = allSamples.size;
    const pairs = [];

    for (let i = 0; i < genes.length; i++) {
      for (let j = i + 1; j < genes.length; j++) {
        const gA = genes[i], gB = genes[j];
        const sA = geneSets[gA], sB = geneSets[gB];
        let both = 0;
        for (const s of sA) if (sB.has(s)) both++;
        const aOnly = sA.size - both;
        const bOnly = sB.size - both;
        const neither = totalSamples - both - aOnly - bOnly;

        const fisher = fisherExact2x2(both, aOnly, bOnly, neither);
        pairs.push({
          geneA: gA,
          geneB: gB,
          both,
          aOnly,
          bOnly,
          neither,
          log_odds_ratio: fisher.log_odds_ratio,
          p_value: fisher.p_value,
          pattern: fisher.log_odds_ratio !== null
            ? (fisher.log_odds_ratio > 0 ? "co-occurring" : "mutually exclusive")
            : "indeterminate",
        });
      }
    }

    pairs.sort((a, b) => (a.p_value || 1) - (b.p_value || 1));
    return { pairs, total_samples: totalSamples };
  }

  // --- Cohort split by mutation status ---
  function cohortSplit(mutations, clinicalData, gene, sampleIdField, patientIdField) {
    sampleIdField = sampleIdField || "sampleId";
    patientIdField = patientIdField || "patientId";

    // Find mutated samples
    const mutatedSamples = new Set();
    for (const m of mutations) {
      const g = m.hugoGeneSymbol || m.gene;
      if (g && g.toUpperCase() === gene.toUpperCase()) {
        mutatedSamples.add(m[sampleIdField]);
      }
    }

    // Get all unique patients from clinical data
    const allPatients = new Set();
    const sampleToPatient = {};
    for (const row of clinicalData) {
      const pid = row[patientIdField];
      const sid = row[sampleIdField];
      if (pid) allPatients.add(pid);
      if (sid && pid) sampleToPatient[sid] = pid;
    }

    // Map mutated samples to patients
    const mutantPatients = new Set();
    for (const sid of mutatedSamples) {
      const pid = sampleToPatient[sid];
      if (pid) mutantPatients.add(pid);
    }

    const wildtype = [];
    const mutant = [];
    for (const pid of allPatients) {
      if (mutantPatients.has(pid)) mutant.push(pid);
      else wildtype.push(pid);
    }

    return {
      mutant_samples: mutant,
      wildtype_samples: wildtype,
      mutant_count: mutant.length,
      wildtype_count: wildtype.length,
      total: allPatients.size,
    };
  }

  // --- Mutation frequency ---
  function mutationFrequency(mutations, totalSamples, geneField, sampleIdField) {
    geneField = geneField || "hugoGeneSymbol";
    sampleIdField = sampleIdField || "sampleId";

    const mutatedSamples = new Set();
    const typeCounts = {};
    const proteinCounts = {};

    for (const m of mutations) {
      mutatedSamples.add(m[sampleIdField]);
      const mt = m.mutationType || m.mutation_type;
      if (mt) typeCounts[mt] = (typeCounts[mt] || 0) + 1;
      const pc = m.proteinChange || m.protein_change;
      if (pc) proteinCounts[pc] = (proteinCounts[pc] || 0) + 1;
    }

    const freq = totalSamples > 0 ? mutatedSamples.size / totalSamples : 0;

    function topN(obj, n) {
      return Object.entries(obj)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n || 10)
        .map(([name, count]) => ({ name, count }));
    }

    return {
      gene: mutations[0] ? (mutations[0][geneField] || "unknown") : "unknown",
      mutated_samples: mutatedSamples.size,
      total_samples: totalSamples,
      frequency: round(freq, 4),
      frequency_pct: round(freq * 100, 2) + "%",
      top_mutation_types: topN(typeCounts, 10),
      top_protein_changes: topN(proteinCounts, 10),
    };
  }

  // --- Expression summary statistics ---
  function expressionStats(values) {
    const nums = values.filter(v => v !== null && v !== undefined && !isNaN(v)).map(Number);
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

  return {
    kaplanMeier,
    logRank,
    fisherExact2x2,
    coOccurrence,
    mannWhitneyU,
    cohortSplit,
    mutationFrequency,
    expressionStats,
  };
})();
// --- End stats helpers ---
`;
