import { expect, it } from "vitest";
import { assaySchema } from "./assay-schema";
it("retains transitive schema references and handles cycles without unrelated schemas", () => {
  const schemas = {Filter: {properties: {cases: {$ref: "#/components/schemas/Case"}}}, Case: {properties: {parent: {$ref: "#/components/schemas/Filter"}}}, Unrelated: {type: "object"}};
  const result = assaySchema({paths: {"/api/generic_assay_data/fetch": {post: {requestBody: {$ref: "#/components/schemas/Filter"}}}}, components: {schemas}});
  expect(Object.keys(result.schemas).sort()).toEqual(["Case", "Filter"]);
  expect(result.schemas.Case).toEqual(schemas.Case);
});
it("rejects a missing schema dependency", () => {
  expect(() => assaySchema({paths: {"/api/generic_assay_data/fetch": {$ref: "#/components/schemas/Missing"}}, components: {schemas: {}}})).toThrow("unresolved");
});
