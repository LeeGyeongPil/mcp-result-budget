import { afterEach, expect, it } from "vitest";
import { withResultBudget } from "../src/index.js";
import { readAllPages } from "../src/testing.js";
import { connect, emptyInput, type Connected } from "./sdk.js";

const open: Connected[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function run(text: string, maxChars: number, maxBytes: number) {
  const c = await connect("v1", (server) => {
    withResultBudget(server, { maxChars, maxBytes });
    server.registerTool("t", { description: "d", inputSchema: emptyInput }, async () => ({ content: [{ type: "text", text }] }));
  });
  open.push(c);
  return readAllPages(c.client, { name: "t" });
}

it("multi-byte text with maxBytes == maxChars stays in a few pages", async () => {
  const text = "한국어 검색 결과 ".repeat(2000);
  const all = await run(text, 12000, 12000);
  expect(all.pages.length).toBeLessThanOrEqual(10);
  for (const p of all.pages) expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(12000);
  expect(all.text).toBe(text);
});

it("multi-byte JSON array under a tight maxBytes stays in a few pages", async () => {
  const items = Array.from({ length: 500 }, (_, i) => ({ id: i, name: "한국어 검색 결과 항목" }));
  const text = JSON.stringify(items);
  const all = await run(text, 12000, 12000);
  expect(all.pages.length).toBeLessThanOrEqual(10);
  for (const p of all.pages) expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(12000);
  expect(JSON.parse(all.text)).toEqual(items);
});

it("a roomy maxBytes keeps the original two pages", async () => {
  const all = await run("한국어 검색 결과 ".repeat(2000), 12000, 30000);
  expect(all.pages.length).toBe(2);
});
