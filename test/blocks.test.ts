import { afterEach, expect, it } from "vitest";
import { withResultBudget, type BudgetWarning } from "../src/index.js";
import { readAllPages } from "../src/testing.js";
import { bigText, connect, emptyInput, flavors, pngBase64, type Connected } from "./sdk.js";

const open: Connected[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

it.each(flavors)("image and resource blocks are kept whole [%s]", async (flavor) => {
  const png = pngBase64(22000); // ~29,334 chars of base64
  const head = bigText().slice(0, 12000);
  const resource = { type: "resource", resource: { uri: "file:///a.txt", mimeType: "text/plain", text: "hello" } };
  const image = { type: "image", data: png, mimeType: "image/png" };
  const warnings: BudgetWarning[] = [];
  const c = await connect(flavor, (server) => {
    withResultBudget(server, { maxChars: 8000, onWarning: (w) => warnings.push(w) });
    server.registerTool("shot", { description: "d", inputSchema: emptyInput }, async () => ({
      content: [{ type: "text", text: head }, image, resource, { type: "text", text: "tail" }],
    }));
  });
  open.push(c);
  const all = await readAllPages(c.client, { name: "shot" });
  const images = all.blocks.filter((b) => b.type === "image");
  expect(images).toHaveLength(1);
  expect(images[0]).toEqual(image);
  expect(all.blocks.filter((b) => b.type === "resource")).toEqual([resource]);
  expect(all.blocks.filter((b) => b.type === "text").map((b) => b.text)).toEqual([head, "tail"]);
  // the image alone is larger than the budget: own page + warning
  const imagePage = all.pages.findIndex((p) => p.content!.some((b) => b.type === "image"));
  expect(all.pages[imagePage]!.content!.filter((b) => b.type !== "text" || !b._meta?.["mcp-result-budget/note"])).toHaveLength(1);
  expect(warnings.filter((w) => w.code === "oversize-atomic")).toHaveLength(1);
});

it("small images share a page with text when they fit", async () => {
  const image = { type: "image", data: pngBase64(300), mimeType: "image/png" };
  const c = await connect("v1", (server) => {
    withResultBudget(server, { maxChars: 4000 });
    server.registerTool("s", { description: "d", inputSchema: emptyInput }, async () => ({
      content: [{ type: "text", text: "a".repeat(6000) }, image],
    }));
  });
  open.push(c);
  const all = await readAllPages(c.client, { name: "s" });
  expect(all.blocks.filter((b) => b.type === "image")).toEqual([image]);
  expect(all.text).toBe("a".repeat(6000));
});
