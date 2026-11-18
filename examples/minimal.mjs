// Minimal example and install smoke test: wrap a server, return a big result, read it back.
// Usage: node minimal.mjs [v1|v2]   (v1 = @modelcontextprotocol/sdk, v2 = @modelcontextprotocol/server)
import { z } from "zod";
import { withResultBudget } from "mcp-result-budget";
import { readAllPages } from "mcp-result-budget/testing";

const flavor = process.argv[2] ?? "v1";
let McpServer, Client, InMemoryTransport;
if (flavor === "v1") {
  ({ McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js"));
  ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
  ({ InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js"));
} else {
  ({ McpServer, InMemoryTransport } = await import("@modelcontextprotocol/server"));
  ({ Client } = await import("@modelcontextprotocol/client"));
}

const server = new McpServer({ name: "minimal", version: "0.0.0" });
withResultBudget(server, { maxChars: 8000 }); // line 1: before registering tools
const big = Array.from({ length: 2000 }, (_, i) => `row ${i}`).join("\n");
server.registerTool("search", { description: "big result", inputSchema: z.object({}) }, async () => ({
  content: [{ type: "text", text: big }], // line 2: nothing else changes
}));

const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
const client = new Client({ name: "client", version: "0.0.0" });
await client.connect(ct);

const all = await readAllPages(client, { name: "search" });
if (all.text !== big) throw new Error("round trip differs from the original");
console.log(`minimal ok: ${all.pages.length} pages, ${all.text.length} chars restored`);
await client.close();
