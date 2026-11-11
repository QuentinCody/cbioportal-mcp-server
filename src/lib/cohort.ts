import { CBIO_INSTANCE, fail, hash, identifier, object } from "./assay-http";
export async function inspectCohort(value: unknown, origin: "user_definition" | "public_session") {
  const definition = object(value);
  if (typeof definition.name !== "string" || !definition.name.trim()) fail("Virtual study name is required");
  if (definition.dynamic !== undefined && typeof definition.dynamic !== "boolean") fail("dynamic must be boolean");
  const dynamic = definition.dynamic === true;
  if (dynamic) object(definition.studyViewFilter);
  if (!Array.isArray(definition.studies) || !definition.studies.length || definition.studies.length > 100) fail("Virtual study requires 1–100 study entries");
  const pairs = new Map<string, {studyId: string; sampleId: string}>();
  let declared = 0;
  for (const entry of definition.studies) {
    const study = object(entry);
    const studyId = identifier(study.id);
    if (!dynamic || study.samples !== undefined) {
      if (!Array.isArray(study.samples) || study.samples.length > 100_000) fail("Static study entries require sample lists (at most 100000)");
      for (const id of study.samples) {
        const sampleId = identifier(id); declared++;
        if (declared > 100_000) fail("Cohort exceeds 100000 declared samples");
        pairs.set(JSON.stringify([studyId, sampleId]), {studyId, sampleId});
      }
    }
  }
  const canonical = JSON.stringify(definition);
  if (new TextEncoder().encode(canonical).length > 4 * 1024 * 1024) fail("Cohort definition exceeds 4 MiB");
  return {definition, _cohort: {
    instance: CBIO_INSTANCE, origin, definition_sha256: await hash(canonical), hash_scope: "UTF-8 JSON.stringify of preserved definition",
    membership_mode: dynamic ? "dynamic_unresolved" : "static_declared", declared_sample_entries: declared,
    distinct_declared_sample_pairs: pairs.size, members: dynamic ? null : [...pairs.values()],
    membership_verified: false, patient_count: null, evaluated_filters: false,
    interpretation: "Study-qualified sample identifiers are not patient identifiers. Static membership reflects the supplied definition, not validated existence or profiling coverage. Dynamic filters are retained verbatim and not evaluated; declared samples are not a current dynamic cohort. No virtual study is created, changed or published.",
  }};
}
