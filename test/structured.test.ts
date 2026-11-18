import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { withResultBudget, type BudgetWarning } from "../src/index.js";
import { readAllPages } from "../src/testing.js";
import { RowsOut, connect, emptyInput, flavors, makeRows, type Connected } from "./sdk.js";

const open: Connected[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

it.each(flavors)("structured pages each pass outputSchema [%s]", async (flavor) => {
  const rows = makeRows(300);
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 8000 });
    server.registerTool("rows", { description: "d", inputSchema: emptyInput, outputSchema: RowsOut }, async () => ({
      content: [{ type: "text", text: JSON.stringify({ total: 300, rows }) }],
      structuredContent: { total: 300, rows },
    }));
  });
  open.push(c);
  const all = await readAllPages(c.client, { name: "rows" });
  expect(all.pages.length).toBeGreaterThan(3);
  for (const p of all.pages) {
    expect(p.isError).toBeFalsy();
    expect(JSON.stringify(p).length).toBeLessThanOrEqual(8000);
    expect(p.structuredContent).toBeDefined();
    expect(RowsOut.safeParse(p.structuredContent).success).toBe(true);
    expect((p.structuredContent as any).total).toBe(300);
  }
  expect(all.structured.flatMap((s: any) => s.rows)).toEqual(rows);
});

it.each(flavors)("unsplittable schema returns original and warns once [%s]", async (flavor) => {
  const rows = makeRows(300);
  const Strict = z.object({ total: z.number(), rows: z.array(z.any()).min(300) });
  const warnings: BudgetWarning[] = [];
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 8000, onWarning: (w) => warnings.push(w) });
    server.registerTool("strict", { description: "d", inputSchema: emptyInput, outputSchema: Strict }, async () => ({
      content: [{ type: "text", text: JSON.stringify({ total: 300, rows }) }],
      structuredContent: { total: 300, rows },
    }));
  });
  open.push(c);
  const r = await c.client.callTool({ name: "strict", arguments: {} });
  expect(r.isError).toBeFalsy();
  expect((r.structuredContent as any).rows).toHaveLength(300);
  expect(r._meta?.["mcp-result-budget/page"]).toBeUndefined();
  expect(warnings.filter((w) => w.code === "unsplittable-structured")).toHaveLength(1);
});

it("structured results with foreign content blocks are returned whole with a warning", async () => {
  const warnings: BudgetWarning[] = [];
  const rows = makeRows(100);
  const c = await connect("v1", (server) => {
    withResultBudget(server, { maxChars: 3000, onWarning: (w) => warnings.push(w) });
    server.registerTool("odd", { description: "d", inputSchema: emptyInput }, async () => ({
      content: [{ type: "text", text: "summary only" }],
      structuredContent: { rows },
    }));
  });
  open.push(c);
  const r = await c.client.callTool({ name: "odd", arguments: {} });
  expect((r.structuredContent as any).rows).toHaveLength(100);
  expect(warnings.map((w) => w.code)).toEqual(["unsupported-shape"]);
});

it("raw zod shape outputSchema is validated too", async () => {
  const rows = makeRows(200);
  const c = await connect("v1", (server) => {
    withResultBudget(server, { maxChars: 6000 });
    server.registerTool("rawshape", { description: "d", inputSchema: emptyInput, outputSchema: { rows: z.array(z.any()) } }, async () => ({
      content: [{ type: "text", text: JSON.stringify({ rows }) }],
      structuredContent: { rows },
    }));
  });
  open.push(c);
  const all = await readAllPages(c.client, { name: "rawshape" });
  expect(all.pages.length).toBeGreaterThan(2);
  expect(all.structured.flatMap((s: any) => s.rows)).toEqual(rows);
});
