import { afterEach, expect, it } from "vitest";
import { MemoryPageStore, withResultBudget } from "../src/index.js";
import { readAllPages } from "../src/testing.js";
import { connect, emptyInput, flavors, type Connected } from "./sdk.js";

const open: Connected[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

it.each(flavors)("bad, tampered and expired cursors return isError [%s]", async (flavor) => {
  let now = 1_000;
  let calls = 0;
  const store = new MemoryPageStore({ ttlMs: 1000, now: () => now });
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 2000, store });
    server.registerTool("search", { description: "d", inputSchema: emptyInput }, async () => {
      calls++;
      return { content: [{ type: "text", text: "line\n".repeat(2000) }] };
    });
  });
  open.push(c);
  const first = await c.client.callTool({ name: "search", arguments: {} });
  const cursor = first._meta["mcp-result-budget/page"].nextCursor as string;

  const garbage = await c.client.callTool({ name: "read_more", arguments: { cursor: "bm9wZTox" } });
  expect(garbage.isError).toBe(true);
  expect(garbage.content[0].text).toContain("call the original tool again");

  const parts = Buffer.from(cursor, "base64url").toString().split("\n");
  const forged = Buffer.from([parts[0], "AAAAAAAAAAAAAAAAAAAAAA", parts[2]].join("\n")).toString("base64url");
  const bad = await c.client.callTool({ name: "read_more", arguments: { cursor: forged } });
  expect(bad.isError).toBe(true);
  expect(bad.content[0].text).toContain("`search`");

  const ok = await c.client.callTool({ name: "read_more", arguments: { cursor } });
  expect(ok.isError).toBeFalsy();

  now += 5000; // TTL elapsed
  const expired = await c.client.callTool({ name: "read_more", arguments: { cursor } });
  expect(expired.isError).toBe(true);
  expect(expired.content[0].text).toContain("`search`");
  expect(calls).toBe(1);
});

it.each(flavors)("original handler runs once even when read to the end [%s]", async (flavor) => {
  let calls = 0;
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 2000 });
    server.registerTool("search", { description: "d", inputSchema: emptyInput }, async () => {
      calls++;
      return { content: [{ type: "text", text: "line\n".repeat(2000) }] };
    });
  });
  open.push(c);
  const all = await readAllPages(c.client, { name: "search" });
  expect(all.pages.length).toBeGreaterThan(3);
  expect(calls).toBe(1);
});

it("store evicts least recently used", async () => {
  const store = new MemoryPageStore({ maxEntries: 2 });
  const v = (t: string) => ({ tool: t, pages: [] });
  await store.set("a", v("a"));
  await store.set("b", v("b"));
  await store.get("a"); // a is now the most recently used
  await store.set("c", v("c"));
  expect(await store.get("b")).toBeUndefined();
  expect(await store.get("a")).toBeDefined();
  expect(await store.get("c")).toBeDefined();
  expect(store.size).toBe(2);
});
