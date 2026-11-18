import { afterEach, expect, it } from "vitest";
import { BudgetConfigError, MemoryPageStore, withResultBudget, type BudgetWarning } from "../src/index.js";
import { connect, emptyInput, flavors, type Connected } from "./sdk.js";

const open: Connected[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

const long = "E".repeat(4000) + "\n" + "한".repeat(4000) + "😀".repeat(500) + "TAILMARK";

it.each(flavors)("oversize error results are trimmed not paginated [%s]", async (flavor) => {
  const warnings: BudgetWarning[] = [];
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 3000, onWarning: (w) => warnings.push(w) });
    server.registerTool("boom", { description: "d", inputSchema: emptyInput }, async () => ({ isError: true, content: [{ type: "text", text: long }] }));
  });
  open.push(c);
  const r = await c.client.callTool({ name: "boom", arguments: {} });
  expect(r.isError).toBe(true);
  expect(JSON.stringify(r).length).toBeLessThanOrEqual(3000);
  expect(r._meta?.["mcp-result-budget/page"]).toBeUndefined();
  const text: string = r.content[0].text;
  expect(text).toMatch(/… \[\d+ chars omitted\] …/);
  expect(text.startsWith("EEE")).toBe(true);
  expect(text.endsWith("TAILMARK")).toBe(true);
  expect(text.isWellFormed()).toBe(true);
  const w = warnings.find((x) => x.code === "error-trimmed") as any;
  expect(w.omitted).toBe(long.length - (text.length - text.match(/… \[\d+ chars omitted\] …/)![0].length));
});

it("errorPolicy pass leaves errors alone", async () => {
  const c = await connect("v1", (server) => {
    withResultBudget(server, { maxChars: 3000, errorPolicy: "pass" });
    server.registerTool("boom", { description: "d", inputSchema: emptyInput }, async () => ({ isError: true, content: [{ type: "text", text: long }] }));
  });
  open.push(c);
  const r = await c.client.callTool({ name: "boom", arguments: {} });
  expect(r.content[0].text).toBe(long);
});

it("MemoryPageStore rejects non-positive options instead of silently breaking paging", () => {
  expect(() => new MemoryPageStore({ ttlMs: -5 })).toThrow(BudgetConfigError);
  expect(() => new MemoryPageStore({ maxEntries: 0 })).toThrow(/maxEntries/);
  expect(() => new MemoryPageStore({ maxTotalChars: Number.NaN })).toThrow(/maxTotalChars/);
  expect(() => new MemoryPageStore({ ttlMs: 1000 })).not.toThrow();
});
