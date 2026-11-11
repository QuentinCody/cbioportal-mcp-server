import type { Completeness } from "@bio-mcp/shared";
export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const scoped = (returned: number, detail: string): Completeness => ({ complete: false, returned,
  truncation: { reason: "unknown", detail, remedy: "Keep request, profile, entity and study-qualified case identities. Missing measurements are not negative results; declared or dynamic cohorts do not establish profiling coverage." } });

function direct(value: unknown): Completeness | undefined {
  if (Array.isArray(value)) return scoped(value.length, "One native cBioPortal selection/page, not whole-study or cross-profile coverage.");
  if (!record(value)) return undefined;
  if (typeof value.molecularProfileId === "string" && typeof value.molecularAlterationType === "string") return scoped(1, "One native molecular-profile configuration, not measured-case coverage.");
  if (record(value._cohort)) return scoped(1, "One cohort definition; static membership is declared, dynamic filters remain unevaluated, and neither establishes patient count or assay coverage.");
  if (record(value._cbioportal)) {
    if (Array.isArray(value.records)) return scoped(value.records.length, "Bounded generic-assay selection; metadata paging and matrix sparsity do not prove an exhaustive cohort.");
    return scoped(1, "One observed public-instance capability document, not proof of dataset coverage or a pinned API version.");
  }
  return undefined;
}

export function cbioportalCompleteness(value: unknown): Completeness | undefined {
  const pending = [value]; const observations: Completeness[] = [];
  while (pending.length) {
    const item = pending.pop(); if (!item || typeof item !== "object") continue;
    if (record(item) && item.__staged === true) {
      if (record(item._staging) && record(item._staging.completeness) && item._staging.completeness.complete === false)
        observations.push({ ...item._staging.completeness, complete: false });
      continue;
    }
    const coverage = direct(item);
    if (coverage) observations.push(coverage); else pending.push(...Object.values(item));
  }
  if (observations.length < 2) return observations[0];
  return { complete: false, truncation: { reason: "unknown", detail: "Composed cBioPortal observations have independent profile, case and paging scopes.", remedy: "Retain each observation separately; do not add unrelated counts or infer cohort completeness." } };
}
