import { fail, object } from "./assay-http";
/** Retain every local schema referenced by the discovered assay operations. */
export function assaySchema(value: unknown) {
  const spec = object(value, 502);
  const paths = object(spec.paths, 502);
  const sourceSchemas = object(object(spec.components, 502).schemas, 502);
  const selectedPaths = Object.fromEntries(Object.entries(paths).filter(([path]) => path.startsWith("/api/generic_assay_data/") || path.startsWith("/api/generic-assay-meta/")));
  if (!Object.keys(selectedPaths).length) fail("Instance schema does not advertise generic-assay operations", 502);
  const schemas: Record<string, unknown> = {};
  const queue: unknown[] = [selectedPaths];
  if (sourceSchemas.MolecularProfile) queue.push({$ref: "#/components/schemas/MolecularProfile"});
  while (queue.length) {
    const current = queue.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) { queue.push(...current); continue; }
    for (const [key, child] of Object.entries(current)) {
      if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")) {
        const name = child.slice("#/components/schemas/".length).replace(/~1/g, "/").replace(/~0/g, "~");
        if (Object.prototype.hasOwnProperty.call(schemas, name)) continue;
        if (!Object.prototype.hasOwnProperty.call(sourceSchemas, name)) fail("Instance OpenAPI has an unresolved assay schema reference", 502);
        Object.defineProperty(schemas, name, {value: sourceSchemas[name], enumerable: true});
        queue.push(sourceSchemas[name]);
      } else queue.push(child);
    }
  }
  return {info: spec.info, openapi: spec.openapi, paths: selectedPaths, schemas};
}
