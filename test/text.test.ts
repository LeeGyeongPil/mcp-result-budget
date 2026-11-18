import { afterEach, expect, it } from "vitest";
import { withResultBudget } from "../src/index.js";
import { readAllPages } from "../src/testing.js";
import { bigText, connect, emptyInput, flavors, type Connected } from "./sdk.js";

const open: Connected[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

it.each(flavors)("text round-trips byte-exact within final budget [%s]", async (flavor) => {
  const text = bigText();
  let calls = 0;
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 8000 });
    server.registerTool("logs", { description: "d", inputSchema: emptyInput }, async () => {
      calls++;
      return { content: [{ type: "text", text }] };
    });
  });
  open.push(c);
  const all = await readAllPages(c.client, { name: "logs" });
  expect(all.pages.length).toBeGreaterThan(5);
  for (const p of all.pages) expect(JSON.stringify(p).length).toBeLessThanOrEqual(8000);
  expect(all.text).toBe(text);
  expect(all.blocks).toHaveLength(1);
  expect(calls).toBe(1);
});

it("small results pass through untouched", async () => {
  const c = await connect("v1", (server) => {
    withResultBudget(server, { maxChars: 8000 });
    server.registerTool("tiny", { description: "d", inputSchema: emptyInput }, async () => ({ content: [{ type: "text", text: "hi" }] }));
  });
  open.push(c);
  const r = await c.client.callTool({ name: "tiny", arguments: {} });
  expect(r.content).toEqual([{ type: "text", text: "hi" }]);
  expect(r._meta).toBeUndefined();
});

it("never splits surrogate pairs", async () => {
  const text = "😀".repeat(5000);
  const c = await connect("v1", (server) => {
    withResultBudget(server, { maxChars: 1500 });
    server.registerTool("emoji", { description: "d", inputSchema: emptyInput }, async () => ({ content: [{ type: "text", text }] }));
  });
  open.push(c);
  const all = await readAllPages(c.client, { name: "emoji" });
  expect(all.text).toBe(text);
  for (const p of all.pages) {
    for (const b of p.content!) {
      if (b.type === "text") expect(b.text!.isWellFormed()).toBe(true);
    }
  }
});
