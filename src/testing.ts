import { measureChars } from "./measure.js";
import { NOTE_META, PAGE_META, PART_META, type CallToolResultLike, type ContentBlock } from "./types.js";

export interface ClientLike {
  callTool(params: { name: string; arguments?: Record<string, unknown> }, ...rest: any[]): Promise<any>;
}

export interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ReadAllResult {
  pages: CallToolResultLike[];
  /** Text of all text blocks joined (JSON-array pages are merged and re-stringified). */
  text: string;
  /** Original-looking block list: continuation pieces merged, note blocks removed. */
  blocks: ContentBlock[];
  /** structuredContent of every page that has one. */
  structured: unknown[];
}

export type ViolationKind =
  | "over-budget"
  | "text-mismatch"
  | "block-missing"
  | "structured-mismatch"
  | "schema"
  | "is-error"
  | "chain";

export interface Violation {
  /** One-based page number (0 for whole-result violations). */
  page: number;
  kind: ViolationKind;
  detail: string;
}

export class RoundTripError extends Error {
  readonly violations: Violation[];
  constructor(violations: Violation[]) {
    const first = violations[0];
    super(
      `Round trip failed with ${violations.length} violation(s). First: page ${first?.page} ${first?.kind} (${first?.detail})`,
    );
    this.name = "RoundTripError";
    this.violations = violations;
  }
}

function pageMeta(page: CallToolResultLike): { index: number; total: number; nextCursor: string | null; key?: string } | undefined {
  const m = page._meta?.[PAGE_META];
  return m && typeof m === "object" ? (m as any) : undefined;
}

/** Calls a tool and follows the continuation cursor until the last page. */
export async function readAllPages(
  client: ClientLike,
  call: ToolCall,
  opts: { continuationTool?: string; maxPages?: number } = {},
): Promise<ReadAllResult> {
  const continuationTool = opts.continuationTool ?? "read_more";
  const maxPages = opts.maxPages ?? 1000;
  const pages: CallToolResultLike[] = [await client.callTool({ name: call.name, arguments: call.arguments ?? {} })];
  for (;;) {
    const last = pages[pages.length - 1]!;
    const next = pageMeta(last)?.nextCursor;
    if (!next || last.isError) break;
    if (pages.length >= maxPages) {
      throw new Error(`readAllPages stopped after ${maxPages} pages; raise opts.maxPages if this is expected.`);
    }
    pages.push(await client.callTool({ name: continuationTool, arguments: { cursor: next } }));
  }
  const blocks = mergeBlocks(pages);
  return {
    pages,
    blocks,
    text: blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    structured: pages.filter((p) => p.structuredContent !== undefined).map((p) => p.structuredContent),
  };
}

function mergeBlocks(pages: CallToolResultLike[]): ContentBlock[] {
  type Work = { block: ContentBlock; json?: unknown[] };
  const out: Work[] = [];
  for (const page of pages) {
    for (const b of page.content ?? []) {
      if (b._meta?.[NOTE_META]) continue;
      const part = b._meta?.[PART_META];
      const prev = out[out.length - 1];
      if (part === "text-cont" && prev && prev.block.type === "text" && !prev.json) {
        prev.block = { ...prev.block, text: (prev.block.text ?? "") + (b.text ?? "") };
      } else if (part === "json-cont" && prev?.json) {
        prev.json.push(...(safeParse(b.text) as unknown[]));
      } else if (part === "json-start") {
        out.push({ block: b, json: [...(safeParse(b.text) as unknown[])] });
      } else {
        out.push({ block: b });
      }
    }
  }
  return out.map(({ block, json }) => {
    const { _meta, ...rest } = block;
    const clean: ContentBlock = { ...rest } as ContentBlock;
    if (json) clean.text = JSON.stringify(json);
    if (_meta) {
      const { [PART_META]: _p, ...others } = _meta;
      if (Object.keys(others).length) clean._meta = others;
    }
    return clean;
  });
}

function safeParse(text: string | undefined): unknown {
  try {
    const v = JSON.parse(text ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

function sameText(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return deepEqual(JSON.parse(a), JSON.parse(b));
  } catch {
    return false;
  }
}

/**
 * Reads every page of a tool and throws `RoundTripError` when a page is over budget, an error,
 * breaks the cursor chain, fails the optional schema, or (given `original`) does not rebuild it.
 */
export async function expectRoundTrip(
  client: ClientLike,
  call: ToolCall,
  opts: {
    maxChars: number;
    original?: CallToolResultLike;
    continuationTool?: string;
    outputSchema?: { safeParse(value: unknown): { success: boolean } };
  },
): Promise<void> {
  const readOpts = opts.continuationTool ? { continuationTool: opts.continuationTool } : {};
  const all = await readAllPages(client, call, readOpts);
  const violations: Violation[] = [];

  all.pages.forEach((page, i) => {
    const n = i + 1;
    if (page.isError) violations.push({ page: n, kind: "is-error", detail: "page is an error result" });
    const size = measureChars(page);
    if (size > opts.maxChars) {
      violations.push({
        page: n,
        kind: "over-budget",
        detail: `${size.toLocaleString("en-US")} > ${opts.maxChars.toLocaleString("en-US")}`,
      });
    }
    const meta = pageMeta(page);
    if (all.pages.length > 1 && (!meta || meta.index !== i || meta.total !== all.pages.length)) {
      violations.push({ page: n, kind: "chain", detail: "page metadata does not match its position" });
    }
    if (opts.outputSchema && page.structuredContent !== undefined) {
      if (!opts.outputSchema.safeParse(page.structuredContent).success) {
        violations.push({ page: n, kind: "schema", detail: "structuredContent fails outputSchema" });
      }
    }
  });

  const original = opts.original;
  if (original && !all.pages.some((p) => p.isError)) {
    const want = original.content ?? [];
    const got = all.blocks;
    const wantOther = want.filter((b) => b.type !== "text");
    const gotOther = got.filter((b) => b.type !== "text");
    if (wantOther.length !== gotOther.length || wantOther.some((b, i) => !deepEqual(b, gotOther[i]))) {
      const lost = wantOther.findIndex((b, i) => !deepEqual(b, gotOther[i]));
      violations.push({
        page: expectedPage(all.pages, want, wantOther[Math.max(lost, 0)]),
        kind: "block-missing",
        detail: `${wantOther.length} non-text block(s) expected, ${gotOther.length} found`,
      });
    }
    if (original.structuredContent === undefined) {
      const wantText = want.filter((b) => b.type === "text");
      const gotText = got.filter((b) => b.type === "text");
      for (let i = 0; i < Math.max(wantText.length, gotText.length); i++) {
        const w = wantText[i]?.text;
        const g = gotText[i]?.text;
        if (w === undefined || g === undefined || !sameText(w, g)) {
          violations.push({
            page: firstMismatchPage(all.pages, i, w, g),
            kind: "text-mismatch",
            detail: `text block ${i + 1} differs${firstDiff(w, g)}`,
          });
          break;
        }
      }
    } else {
      const key = pageMeta(all.pages[0]!)?.key;
      const rebuilt = key
        ? { ...(all.structured[0] as object), [key]: all.structured.flatMap((s) => (s as any)[key] as unknown[]) }
        : all.structured[0];
      if (!deepEqual(rebuilt, original.structuredContent)) {
        violations.push({ page: 0, kind: "structured-mismatch", detail: "merged structuredContent differs" });
      }
    }
  }

  if (violations.length > 0) throw new RoundTripError(violations);
}

function firstDiff(w: string | undefined, g: string | undefined): string {
  if (w === undefined || g === undefined) return " (block missing on one side)";
  let i = 0;
  while (i < w.length && i < g.length && w[i] === g[i]) i++;
  return ` at char ${i}`;
}

/** Best-effort page number for a text mismatch: the page holding the first differing character. */
function firstMismatchPage(pages: CallToolResultLike[], _blockIndex: number, w?: string, g?: string): number {
  if (w === undefined || g === undefined) return 0;
  let at = 0;
  while (at < w.length && at < g.length && w[at] === g[at]) at++;
  let seen = 0;
  for (let i = 0; i < pages.length; i++) {
    for (const b of pages[i]!.content ?? []) {
      if (b._meta?.[NOTE_META] || b.type !== "text") continue;
      seen += (b.text ?? "").length;
    }
    if (at < seen) return i + 1;
  }
  return pages.length;
}

/** Page where a missing block should have appeared: the page holding the text just before it. */
function expectedPage(pages: CallToolResultLike[], want: ContentBlock[], block: ContentBlock | undefined): number {
  if (!block) return 0;
  const idx = want.indexOf(block);
  let before = 0;
  for (let i = 0; i < idx; i++) if (want[i]!.type === "text") before += want[i]!.text?.length ?? 0;
  if (before === 0) return 1;
  let seen = 0;
  for (let i = 0; i < pages.length; i++) {
    for (const b of pages[i]!.content ?? []) {
      if (b._meta?.[NOTE_META] || b.type !== "text") continue;
      seen += (b.text ?? "").length;
    }
    if (before <= seen) return i + 1;
  }
  return pages.length;
}
