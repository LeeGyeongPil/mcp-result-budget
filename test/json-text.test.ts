import { afterEach, expect, it } from "vitest";
import { withResultBudget } from "../src/index.js";
import { scanTopLevelArray } from "../src/split-json.js";
import { readAllPages } from "../src/testing.js";
import { connect, emptyInput, flavors, type Connected } from "./sdk.js";

const open: Connected[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

const tricky = ['a,b]"c', 'quote \\" and ] , [', "한글😀", "x".repeat(300)];
const items = Array.from({ length: 200 }, (_, i) => ({ id: i, s: tricky[i % tricky.length], nested: [i, { k: [1, 2, "]"] }] }));
const compact = JSON.stringify(items);

it.each(flavors)("compact JSON array splits on element boundaries without reformatting [%s]", async (flavor) => {
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 6000 });
    server.registerTool("list", { description: "d", inputSchema: emptyInput }, async () => ({ content: [{ type: "text", text: compact }] }));
  });
  open.push(c);
  const all = await readAllPages(c.client, { name: "list" });
  expect(all.pages.length).toBeGreaterThan(2);
  const merged: unknown[] = [];
  for (const p of all.pages) {
    const textBlocks = p.content!.filter((b) => b.type === "text" && !b._meta?.["mcp-result-budget/note"]);
    expect(textBlocks).toHaveLength(1);
    const t = textBlocks[0]!.text!;
    expect(JSON.stringify(p).length).toBeLessThanOrEqual(6000);
    const arr = JSON.parse(t); // each page is a valid JSON array
    // element text is a verbatim slice of the original: no spaces, no re-indentation
    expect(compact.includes(t.slice(1, -1))).toBe(true);
    merged.push(...arr);
  }
  expect(merged).toEqual(items);
});

it("scanner returns exact element spans and rejects non-arrays", () => {
  const text = ' [1, "a,]", {"x":[2,3]} ,[4] ] ';
  const spans = scanTopLevelArray(text)!;
  expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(["1", '"a,]"', '{"x":[2,3]}', "[4]"]);
  expect(scanTopLevelArray("{}")).toBeUndefined();
  expect(scanTopLevelArray("[1,")).toBeUndefined();
  expect(scanTopLevelArray("plain text")).toBeUndefined();
});

it("falls back to plain text splitting when one element exceeds a page", async () => {
  const text = JSON.stringify(["a", "b".repeat(5000), "c"]);
  const c = await connect("v1", (server) => {
    withResultBudget(server, { maxChars: 2000 });
    server.registerTool("big", { description: "d", inputSchema: emptyInput }, async () => ({ content: [{ type: "text", text }] }));
  });
  open.push(c);
  const all = await readAllPages(c.client, { name: "big" });
  expect(all.text).toBe(text);
});
