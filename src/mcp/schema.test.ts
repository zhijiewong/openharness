import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { zodToJsonSchemaSimple } from "./schema.js";

test("ZodObject converts to JSON Schema object with properties and required", () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
    active: z.boolean().optional(),
  });
  const result = zodToJsonSchemaSimple(schema) as any;
  assert.equal(result.type, "object");
  assert.deepEqual(Object.keys(result.properties), ["name", "age", "active"]);
  assert.deepEqual(result.required, ["name", "age"]);
});

test("ZodString converts to { type: 'string' }", () => {
  const result = zodToJsonSchemaSimple(z.string()) as any;
  assert.deepEqual(result, { type: "string" });
});

test("ZodNumber converts to { type: 'number' }", () => {
  const result = zodToJsonSchemaSimple(z.number()) as any;
  assert.deepEqual(result, { type: "number" });
});

test("ZodBoolean converts to { type: 'boolean' }", () => {
  const result = zodToJsonSchemaSimple(z.boolean()) as any;
  assert.deepEqual(result, { type: "boolean" });
});

test("ZodArray converts to { type: 'array', items }", () => {
  const result = zodToJsonSchemaSimple(z.array(z.string())) as any;
  assert.equal(result.type, "array");
  assert.deepEqual(result.items, { type: "string" });
});
