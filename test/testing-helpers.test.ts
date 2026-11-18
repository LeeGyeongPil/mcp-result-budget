import { afterEach, expect, it } from "vitest";
import { withResultBudget } from "../src/index.js";
import { RoundTripError, expectRoundTrip, readAllPages, type ClientLike } from "../src/testing.js";
import { bigText, connect, emptyInput, flavors, pngBase64, type Connected } from "./sdk.js";

const open: Connected[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

const text = bigText().slice(0, 30000);
const image = { type: "image", data: pngBase64(900), mimeType: "image/png" };
const original = { content: [{ type: "text", text }, image, { type: "text", text: "tail" }] };

async function setup(flavor: "v1" | "v2") {
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 6000 });
    server.registerTool("mixed", { description: "d", inputSchema: emptyInput }, async () => original);
  });
  open.push(c);
  return c;
}

/** Wraps a real client and lets a test damage the pages it returns. */
function damaged(client: any, mutate: (page: any, n: number) => void): ClientLike {
  let n = 0;
  return { callTool: async (p, ...rest) => { const r = await client.callTool(p, ...rest); mutate(r, ++n); return r; } };
}

const call = { name: "mixed", arguments: {} };

it.each(flavors)("expectRoundTrip reports page and kind of violation [%s]", async (flavor) => {
  const c = await setup(flavor);
  await expectRoundTrip(c.client, call, { maxChars: 6000, original });

  const run = async (client: ClientLike) => {
    try { await expectRoundTrip(client, call, { maxChars: 6000, original }); } catch (e) { return e as RoundTripError; }
    throw new Error("expected RoundTripError");
  };

  const over = await run(damaged(c.client, (p, n) => { if (n === 3) p._meta.pad = "x".repeat(4000); }));
  expect(over).toBeInstanceOf(RoundTripError);
  expect(over.violations[0]).toMatchObject({ page: 3, kind: "over-budget" });
  expect(over.violations[0]!.detail).toMatch(/> 6,000/);

  const changed = await run(damaged(c.client, (p, n) => {
    if (n === 2) { const b = p.content.find((x: any) => x.type === "text"); b.text = "#" + b.text.slice(1); }
  }));
  expect(changed.violations[0]).toMatchObject({ page: 2, kind: "text-mismatch" });

  const lost = await run(damaged(c.client, (p) => { p.content = p.content.filter((b: any) => b.type !== "image"); }));
  expect(lost.violations[0]!.kind).toBe("block-missing");
  expect(lost.violations[0]!.page).toBeGreaterThan(0);
});

it("readAllPages merges continuation pieces back into the original blocks", async () => {
  const c = await setup("v1");
  const all = await readAllPages(c.client, call);
  expect(all.blocks).toEqual(original.content);
  expect(all.text).toBe(text + "tail");
});

it("readAllPages stops runaway chains", async () => {
  const c = await setup("v1");
  await expect(readAllPages(c.client, call, { maxPages: 2 })).rejects.toThrow(/maxPages/);
});

it("MemoryPageStore enforces a total size cap and keeps the newest entry", async () => {
  const { MemoryPageStore } = await import("../src/store.js");
  const page = (n: number) => ({ tool: "t", pages: [{ content: [{ type: "text", text: "x".repeat(n) }] }] });
  const s = new MemoryPageStore({ maxTotalChars: 1000 });
  await s.set("a", page(400));
  await s.set("b", page(400));
  await s.set("c", page(400));
  expect(await s.get("a")).toBeUndefined();
  expect(await s.get("c")).toBeDefined();
  await s.set("huge", page(5000));
  expect(s.size).toBe(1);
  expect(await s.get("huge")).toBeDefined();
});
