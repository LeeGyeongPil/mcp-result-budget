import { escLen, measureChars } from "./measure.js";
import { scanTopLevelArray } from "./split-json.js";
import { PART_META, type ContentBlock } from "./types.js";

/** Conservative per-block wrapper cost: `{"type":"text","text":"","_meta":{...}},` */
export const TEXT_OVERHEAD = 120;

export interface PackedPage {
  blocks: ContentBlock[];
  /** True when a single unsplittable block is larger than the page capacity. */
  atomic: boolean;
}

/**
 * Packs content blocks into pages of at most `cap` estimated characters.
 * Text is cut at line boundaries, then at code points; JSON array text at element boundaries
 * (by position in the original string); other blocks are never cut.
 */
export class Packer {
  readonly pages: PackedPage[] = [];
  private cur: ContentBlock[] = [];
  private curCost = 0;
  private curAtomic = false;

  constructor(private readonly cap: number) {}

  private room(): number {
    return this.cap - this.curCost;
  }

  flush(): void {
    if (this.cur.length === 0) return;
    this.pages.push({ blocks: this.cur, atomic: this.curAtomic });
    this.cur = [];
    this.curCost = 0;
    this.curAtomic = false;
  }

  finish(): PackedPage[] {
    this.flush();
    return this.pages;
  }

  addBlock(block: ContentBlock): void {
    const cost = measureChars(block) + 1;
    if (cost > this.room()) this.flush();
    this.cur.push(block);
    this.curCost += cost;
    if (cost > this.cap) {
      this.curAtomic = true;
      this.flush();
    }
  }

  addText(text: string, extraMeta?: Record<string, unknown>): void {
    let first = true;
    let buf = "";
    let bufCost = 0;
    const room = () => this.room() - TEXT_OVERHEAD - bufCost;
    const emit = () => {
      if (buf === "" && !(first && text === "")) return;
      const block: ContentBlock = { type: "text", text: buf };
      const meta = { ...(first ? {} : { [PART_META]: "text-cont" }), ...(extraMeta ?? {}) };
      if (Object.keys(meta).length) block._meta = meta;
      this.cur.push(block);
      this.curCost += TEXT_OVERHEAD + bufCost;
      first = false;
      buf = "";
      bufCost = 0;
    };
    if (text === "") {
      emit();
      return;
    }
    const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    for (const line of lines) {
      const c = escLen(line);
      if (c <= room()) {
        buf += line;
        bufCost += c;
        continue;
      }
      emit();
      this.flush();
      if (c <= room()) {
        buf = line;
        bufCost = c;
        continue;
      }
      for (const ch of line) {
        // for..of walks code points, so surrogate pairs are never split
        const cc = escLen(ch);
        if (cc > room() && (buf !== "" || this.cur.length > 0)) {
          emit();
          this.flush();
        }
        buf += ch;
        bufCost += cc;
      }
    }
    emit();
  }

  /** Returns false (and adds nothing) when the text is not a splittable JSON array. */
  addJsonArray(text: string): boolean {
    const spans = scanTopLevelArray(text);
    if (!spans || spans.length < 2) return false;
    const maxElem = Math.max(...spans.map((s) => escLen(text.slice(s.start, s.end))));
    if (maxElem + 2 + TEXT_OVERHEAD > this.cap) return false;

    let start = 0; // first element index of the current group
    let groupCost = 0;
    let first = true;
    const emitGroup = (endIdx: number) => {
      const body = "[" + text.slice(spans[start]!.start, spans[endIdx]!.end) + "]";
      this.cur.push({ type: "text", text: body, _meta: { [PART_META]: first ? "json-start" : "json-cont" } });
      this.curCost += TEXT_OVERHEAD + escLen(body);
      first = false;
    };
    for (let k = 0; k < spans.length; k++) {
      const s = spans[k]!;
      const prevEnd = k > start ? spans[k - 1]!.end : s.start;
      const add = escLen(text.slice(prevEnd, s.end));
      if (k > start && groupCost + add + 2 + TEXT_OVERHEAD > this.room()) {
        emitGroup(k - 1);
        this.flush();
        start = k;
        groupCost = 0;
        k--; // re-evaluate this element as the first of a new group
        continue;
      }
      if (k === start && add + 2 + TEXT_OVERHEAD > this.room()) {
        this.flush();
      }
      groupCost += add;
    }
    emitGroup(spans.length - 1);
    return true;
  }
}
