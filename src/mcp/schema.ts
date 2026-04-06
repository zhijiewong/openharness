import type { z } from 'zod';

/**
 * Simple Zod-to-JSON-Schema converter for MCP tool definitions.
 * Handles common cases: object, string, number, boolean, array, optional.
 */
export function zodToJsonSchemaSimple(schema: z.ZodType): unknown {
  const def = (schema as any)._def;

  if (def?.typeName === 'ZodObject') {
    const shape = (schema as z.ZodObject<any>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const field = value as z.ZodType;
      const fieldDef = (field as any)._def;

      if (fieldDef?.typeName === 'ZodOptional') {
        properties[key] = zodToJsonSchemaSimple(fieldDef.innerType);
      } else {
        properties[key] = zodToJsonSchemaSimple(field);
        required.push(key);
      }

      if ((field as any).description) {
        (properties[key] as any).description = (field as any).description;
      }
    }

    return { type: 'object', properties, required };
  }

  if (def?.typeName === 'ZodString') return { type: 'string' };
  if (def?.typeName === 'ZodNumber') return { type: 'number' };
  if (def?.typeName === 'ZodBoolean') return { type: 'boolean' };
  if (def?.typeName === 'ZodArray') return { type: 'array', items: zodToJsonSchemaSimple(def.type) };
  if (def?.typeName === 'ZodRecord') return { type: 'object' };
  if (def?.typeName === 'ZodEnum') return { type: 'string', enum: def.values };

  return { type: 'string' }; // fallback
}
