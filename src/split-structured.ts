import { escLen } from "./measure.js";

export interface StructuredPage {
  structuredContent: Record<string, unknown>;
  atomic: boolean;
}

/** `{"type":"text","text":""},` plus slack for the mirrored JSON text block. */
const MIRROR_OVERHEAD = 40;

/**
 * Splits the largest top-level array of `sc` at element boundaries. Every page keeps all other
 * fields unchanged, so each page has the same shape as the original.
 * `mirror` = the content text repeats the JSON, so its size counts twice.
 */
export function splitStructured(
  sc: Record<string, unknown>,
  mirror: boolean,
  cap: number,
): { key: string; pages: StructuredPage[] } | { error: string } {
  let key: string | undefined;
  let bestLen = -1;
  for (const [k, v] of Object.entries(sc)) {
    if (!Array.isArray(v)) continue;
    const len = JSON.stringify(v).length;
    if (len > bestLen) {
      bestLen = len;
      key = k;
    }
  }
  if (key === undefined) return { error: "structuredContent has no top-level array to split" };
  const items = sc[key] as unknown[];
  if (items.length < 2) return { error: `array "${key}" has fewer than 2 elements` };

  const shell = JSON.stringify({ ...sc, [key]: [] });
  const base = shell.length + (mirror ? escLen(shell) + MIRROR_OVERHEAD : 0);
  const pages: StructuredPage[] = [];
  let batch: unknown[] = [];
  let cost = base;
  const push = (atomic: boolean) => {
    pages.push({ structuredContent: { ...sc, [key!]: batch }, atomic });
    batch = [];
    cost = base;
  };
  for (const item of items) {
    const json = JSON.stringify(item) ?? "null";
    const c = json.length + 1 + (mirror ? escLen(json) + 1 : 0);
    if (batch.length > 0 && cost + c > cap) push(false);
    batch.push(item);
    cost += c;
    if (cost > cap) push(true); // a single element larger than the page
  }
  if (batch.length > 0) push(false);
  return { key, pages };
}
