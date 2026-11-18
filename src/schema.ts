import { z } from "zod";

export type Validator = (value: unknown) => Promise<{ ok: boolean; message?: string }>;

function isSchemaLike(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (typeof (v as any).safeParse === "function" || typeof (v as any)["~standard"]?.validate === "function")
  );
}

/**
 * Turns whatever `registerTool` received as `outputSchema` into a validator:
 * zod 3/4 schema, any Standard Schema, or a raw zod shape (`{ a: z.string() }`).
 */
export function toValidator(schema: unknown): Validator | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  let s: any = schema;
  if (!isSchemaLike(s)) {
    const values = Object.values(s);
    if (values.length > 0 && values.every(isSchemaLike)) s = z.object(s as any);
    else return undefined;
  }
  if (typeof s.safeParse === "function") {
    return async (value) => {
      const r = await s.safeParse(value);
      return r.success ? { ok: true } : { ok: false, message: String(r.error?.message ?? "invalid") };
    };
  }
  return async (value) => {
    const r = await s["~standard"].validate(value);
    return r.issues ? { ok: false, message: JSON.stringify(r.issues).slice(0, 300) } : { ok: true };
  };
}
