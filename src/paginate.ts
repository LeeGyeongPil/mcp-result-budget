import { encodeCursor, newId } from "./cursor.js";
import type { BudgetWarning } from "./errors.js";
import { measureBytes, measureChars } from "./measure.js";
import type { Validator } from "./schema.js";
import { Packer, TEXT_OVERHEAD } from "./split-text.js";
import { splitStructured } from "./split-structured.js";
import {
  NOTE_META,
  PAGE_META,
  type CallToolResultLike,
  type ContentBlock,
  type PageInfo,
  type PageStore,
} from "./types.js";

export interface PaginateContext {
  tool: string;
  maxChars: number;
  maxBytes?: number;
  errorPolicy: "trim" | "pass";
  continuationTool: string;
  store: PageStore;
  validator?: Validator;
  note: (info: PageInfo) => string;
  warn: (w: BudgetWarning) => void;
}

const MAX_ATTEMPTS = 8;
// Below this the packer has no room left for content (TEXT_OVERHEAD is charged per text block).
const MIN_CAP = TEXT_OVERHEAD + 100;

export function defaultNote(info: PageInfo): string {
  const n = `page ${info.index + 1}/${info.total}`;
  if (info.nextCursor === null) return `[${n} · end]`;
  const left = info.remainingChars.toLocaleString("en-US");
  return `[${n} · ${left} chars left] call ${info.continuationTool} {"cursor":"${info.nextCursor}"}`;
}

function fits(ctx: PaginateContext, value: unknown): boolean {
  if (measureChars(value) > ctx.maxChars) return false;
  return ctx.maxBytes === undefined || measureBytes(value) <= ctx.maxBytes;
}

function excess(ctx: PaginateContext, value: unknown): number {
  const c = measureChars(value) - ctx.maxChars;
  const b = ctx.maxBytes === undefined ? -1 : measureBytes(value) - ctx.maxBytes;
  return Math.max(c, b);
}

/** Splits an oversized result into pages, stores them and returns page 1. */
export async function paginateResult(ctx: PaginateContext, result: CallToolResultLike): Promise<CallToolResultLike> {
  if (!result || typeof result !== "object" || !Array.isArray(result.content)) return result;
  if (fits(ctx, result)) return result;
  if (result.isError) return ctx.errorPolicy === "pass" ? result : trimError(ctx, result);

  const { content, structuredContent, _meta, ...rest } = result;
  const structured = structuredContent !== undefined && structuredContent !== null;

  let mirror = false;
  if (structured) {
    const only = content.length === 1 ? content[0] : undefined;
    mirror = only?.type === "text" && typeof only.text === "string" && sameJson(only.text, structuredContent);
    if (!(content.length === 0 || mirror)) {
      ctx.warn({
        code: "unsupported-shape",
        tool: ctx.tool,
        reason: "structuredContent comes with content blocks that are not a JSON mirror of it",
      });
      return result;
    }
  }

  const id = newId();
  const cursor = (i: number) => encodeCursor(ctx.tool, id, i);

  type Raw = { content: ContentBlock[]; sc?: Record<string, unknown>; atomic: boolean };
  let key: string | undefined;
  let failure: string | undefined;

  const build = (cap: number): Raw[] | undefined => {
    if (structured) {
      const s = splitStructured(structuredContent as Record<string, unknown>, mirror, cap);
      if ("error" in s) {
        failure = s.error;
        return undefined;
      }
      key = s.key;
      return s.pages.map((p) => ({
        content: mirror ? [{ type: "text", text: JSON.stringify(p.structuredContent) }] : [],
        sc: p.structuredContent,
        atomic: p.atomic,
      }));
    }
    const packer = new Packer(cap);
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        if (!packer.addJsonArray(block.text)) packer.addText(block.text);
      } else {
        packer.addBlock(block);
      }
    }
    return packer.finish().map((p) => ({ content: p.blocks, atomic: p.atomic }));
  };

  const decorate = (raw: Raw[], remaining: number[]): CallToolResultLike[] =>
    raw.map((r, i) => {
      const info: PageInfo = {
        index: i,
        total: raw.length,
        nextCursor: i + 1 < raw.length ? cursor(i + 1) : null,
        remainingChars: remaining[i] ?? 0,
        continuationTool: ctx.continuationTool,
      };
      const page: CallToolResultLike = {
        ...rest,
        content: [...r.content, { type: "text", text: ctx.note(info), _meta: { [NOTE_META]: true } }],
        _meta: {
          ...(_meta ?? {}),
          [PAGE_META]: {
            index: info.index,
            total: info.total,
            nextCursor: info.nextCursor,
            ...(key !== undefined ? { key } : {}),
          },
        },
      };
      if (r.sc) page.structuredContent = r.sc;
      return page;
    });

  const remainingFor = (raw: Raw[]): number[] => {
    const sizes = raw.map((r) => measureChars({ content: r.content, structuredContent: r.sc }));
    const out: number[] = [];
    let acc = 0;
    for (let i = raw.length - 1; i >= 0; i--) {
      out[i] = acc;
      acc += sizes[i]!;
    }
    return out;
  };

  // Estimate the fixed cost of a decorated page, then correct it by measuring the real pages.
  const worst = decorate([{ content: [], atomic: false }], [9_999_999])[0]!;
  worst._meta = {
    ...(worst._meta ?? {}),
    [PAGE_META]: { index: 9999, total: 9999, nextCursor: cursor(9999), ...(structured ? { key: "k".repeat(16) } : {}) },
  };
  const noteWorst = ctx.note({
    index: 9998,
    total: 9999,
    nextCursor: cursor(9999),
    remainingChars: 9_999_999,
    continuationTool: ctx.continuationTool,
  });
  worst.content = [{ type: "text", text: noteWorst, _meta: { [NOTE_META]: true } }];
  let cap = Math.max(MIN_CAP, ctx.maxChars - measureChars(worst) - (structured ? 40 : 0));

  let raw: Raw[] | undefined;
  let pages: CallToolResultLike[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    raw = build(cap);
    if (!raw) break;
    pages = decorate(raw, remainingFor(raw));
    let over = 0;
    let ratio = 1;
    pages.forEach((p, i) => {
      if (raw![i]!.atomic) return;
      const c = measureChars(p) - ctx.maxChars;
      over = Math.max(over, c);
      if (ctx.maxBytes !== undefined) {
        const bytes = measureBytes(p);
        // Bytes can exceed the budget by far more than chars do (multi-byte text), so a byte
        // overshoot shrinks the char cap proportionally instead of subtracting raw bytes.
        if (bytes > ctx.maxBytes && bytes - ctx.maxBytes > c) {
          ratio = Math.min(ratio, ctx.maxBytes / bytes);
          over = Math.max(over, 1);
        }
      }
    });
    if (over <= 0 || cap <= MIN_CAP) break;
    const byChars = cap - over;
    const byBytes = Math.floor(cap * ratio * 0.97);
    cap = Math.max(MIN_CAP, Math.min(byChars, byBytes, cap - 1));
  }

  if (!raw) {
    ctx.warn({ code: "unsplittable-structured", tool: ctx.tool, reason: failure ?? "cannot split" });
    return result;
  }

  if (structured && ctx.validator) {
    for (let i = 0; i < raw.length; i++) {
      const v = await ctx.validator(raw[i]!.sc);
      if (!v.ok) {
        ctx.warn({
          code: "unsplittable-structured",
          tool: ctx.tool,
          reason: `page ${i + 1} would violate outputSchema: ${v.message ?? "invalid"}`,
        });
        return result;
      }
    }
  }

  pages.forEach((p, i) => {
    if (fits(ctx, p)) return;
    const chars = measureChars(p);
    if (raw![i]!.atomic) ctx.warn({ code: "oversize-atomic", tool: ctx.tool, page: i + 1, chars });
    else ctx.warn({ code: "budget-not-met", tool: ctx.tool, page: i + 1, chars });
  });

  if (pages.length === 1) return result;
  await ctx.store.set(id, { tool: ctx.tool, pages });
  return pages[0]!;
}

function sameJson(text: string, value: unknown): boolean {
  if (text === JSON.stringify(value)) return true;
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
  } catch {
    return false;
  }
}

/** Error results are never paginated; the middle of the largest text block is cut out instead. */
function trimError(ctx: PaginateContext, result: CallToolResultLike): CallToolResultLike {
  const content = result.content ?? [];
  let target = -1;
  let longest = -1;
  content.forEach((b, i) => {
    if (b.type === "text" && typeof b.text === "string" && b.text.length > longest) {
      longest = b.text.length;
      target = i;
    }
  });
  if (target < 0) return result;
  const original = content[target]!.text as string;

  let removed = 0;
  let need = excess(ctx, result) + 40;
  for (let iter = 0; iter < 30; iter++) {
    removed = Math.min(original.length, removed + Math.max(need, 1));
    const keep = original.length - removed;
    let head = Math.ceil(keep / 2);
    let tail = keep - head;
    if (head > 0 && isHigh(original.charCodeAt(head - 1))) head--;
    const tailStart = original.length - tail;
    if (tail > 0 && isLow(original.charCodeAt(tailStart))) tail--;
    const omitted = original.length - head - tail;
    const text =
      original.slice(0, head) + `… [${omitted} chars omitted] …` + original.slice(original.length - tail);
    const next: CallToolResultLike = {
      ...result,
      content: content.map((b, i) => (i === target ? { ...b, text } : b)),
    };
    if (fits(ctx, next) || keep === 0) {
      ctx.warn({ code: "error-trimmed", tool: ctx.tool, omitted });
      return next;
    }
    need = excess(ctx, next);
  }
  return result;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
