import { afterEach, expect, it } from "vitest";
import { BudgetConfigError, profiles, resolveBudget, withResultBudget } from "../src/index.js";
import { connect, emptyInput, flavors, type Connected } from "./sdk.js";

const open: Connected[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

it.each(flavors)("declares maxResultSizeChars equal to resolved budget [%s]", async (flavor) => {
  let budgetChars = 0;
  const c = await connect(flavor, (server) => {
    const b = withResultBudget(server, { maxChars: 12345 });
    budgetChars = b.maxChars;
    server.registerTool("a", { description: "d", inputSchema: emptyInput, _meta: { mine: 1 } }, async () => ({ content: [] }));
    server.registerTool("b", { description: "d", inputSchema: emptyInput }, async () => ({ content: [] }));
  });
  open.push(c);
  const { tools } = await c.client.listTools();
  for (const name of ["a", "b", "read_more"]) {
    expect(tools.find((t: any) => t.name === name)._meta["anthropic/maxResultSizeChars"]).toBe(budgetChars);
  }
  expect(tools.find((t: any) => t.name === "a")._meta.mine).toBe(1);
});

it.each(flavors)("declareMeta false leaves tool _meta alone [%s]", async (flavor) => {
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 5000, declareMeta: false });
    server.registerTool("a", { description: "d", inputSchema: emptyInput }, async () => ({ content: [] }));
  });
  open.push(c);
  const { tools } = await c.client.listTools();
  for (const t of tools) expect(t._meta?.["anthropic/maxResultSizeChars"]).toBeUndefined();
});

it("profiles carry source and checked date", () => {
  const resolved = Object.entries(profiles).map(([name, p]) => {
    expect(p.source).toMatch(/^https:\/\//);
    expect(p.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    return [name, resolveBudget({ profile: name as any }).maxChars] as const;
  });
  const portable = resolved.find(([n]) => n === "portable")![1];
  for (const [n, v] of resolved) if (n !== "portable") expect(portable).toBeLessThanOrEqual(v);
  expect(resolveBudget({ profile: "agent-cli" }).maxChars).toBe(25000);
  expect(resolveBudget({ profile: "agent-cli", charsPerToken: 4 }).maxChars).toBe(50000);
  expect(resolveBudget({ profile: "http-1mib" }).maxBytes).toBe(1048576);
});

it("invalid options throw BudgetConfigError", async () => {
  const mk = () => ({ registerTool: (_n: string, _c: any, _cb: any) => ({}) });
  expect(() => withResultBudget(mk(), { maxChars: 10 })).toThrow(BudgetConfigError);
  expect(() => withResultBudget(mk(), { maxChars: 600_000 })).toThrow(BudgetConfigError);
  expect(() => withResultBudget({} as any)).toThrow(BudgetConfigError);
  expect(() => withResultBudget(mk(), { profile: "nope" as any })).toThrow(/Unknown profile/);
  expect(() => withResultBudget(mk(), { continuationTool: "bad name!" })).toThrow(BudgetConfigError);
  const s = mk();
  withResultBudget(s);
  expect(() => withResultBudget(s)).toThrow(/already wrapped/);
  expect(() => s.registerTool("read_more", {}, () => {})).toThrow(BudgetConfigError);
});

it("perTool can disable or override a tool", async () => {
  const c = await connect("v1", (server) => {
    withResultBudget(server, { maxChars: 5000, perTool: { raw: false, wide: { maxChars: 9000 } } });
    for (const n of ["raw", "wide", "norm"]) {
      server.registerTool(n, { description: "d", inputSchema: emptyInput }, async () => ({ content: [{ type: "text", text: "q".repeat(7000) }] }));
    }
  });
  open.push(c);
  const { tools } = await c.client.listTools();
  const meta = (n: string) => tools.find((t: any) => t.name === n)._meta?.["anthropic/maxResultSizeChars"];
  expect(meta("raw")).toBeUndefined();
  expect(meta("wide")).toBe(9000);
  expect(meta("norm")).toBe(5000);
  expect((await c.client.callTool({ name: "raw", arguments: {} })).content[0].text).toHaveLength(7000);
  expect((await c.client.callTool({ name: "wide", arguments: {} })).content[0].text).toHaveLength(7000);
  expect((await c.client.callTool({ name: "norm", arguments: {} }))._meta["mcp-result-budget/page"].total).toBeGreaterThan(1);
});

it.each(flavors)("read_more declares the largest perTool budget and covers every page [%s]", async (flavor) => {
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 8000, perTool: { wide: { maxChars: 20000 } } });
    server.registerTool("wide", { description: "d", inputSchema: emptyInput }, async () => ({ content: [{ type: "text", text: "w\n".repeat(25000) }] }));
  });
  open.push(c);
  const { tools } = await c.client.listTools();
  const declared = tools.find((t: any) => t.name === "read_more")._meta["anthropic/maxResultSizeChars"];
  expect(declared).toBe(20000);
  let r = await c.client.callTool({ name: "wide", arguments: {} });
  let pages = 0;
  for (;;) {
    pages++;
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(declared);
    const next = r._meta["mcp-result-budget/page"].nextCursor;
    if (!next) break;
    r = await c.client.callTool({ name: "read_more", arguments: { cursor: next } });
  }
  expect(pages).toBeGreaterThan(1);
});

it("server.tool() callbacks are split and reported; earlier registrations are warned about", async () => {
  const warnings: any[] = [];
  const c = await connect("v1", (server) => {
    server.registerTool("early", { description: "d", inputSchema: emptyInput }, async () => ({ content: [{ type: "text", text: "e".repeat(30000) }] }));
    withResultBudget(server, { maxChars: 8000, onWarning: (w) => warnings.push(w) });
    server.tool("legacy", async () => ({ content: [{ type: "text", text: "l".repeat(30000) }] }));
  });
  open.push(c);
  expect(warnings.map((w) => `${w.code}:${w.tool}`)).toEqual(["unwrapped-tool:early", "unwrapped-tool:legacy"]);
  const legacy = await c.client.callTool({ name: "legacy", arguments: {} });
  expect(legacy._meta["mcp-result-budget/page"].total).toBeGreaterThan(1);
  expect(JSON.stringify(legacy).length).toBeLessThanOrEqual(8000);
  const early = await c.client.callTool({ name: "early", arguments: {} });
  expect(early._meta?.["mcp-result-budget/page"]).toBeUndefined();
});
