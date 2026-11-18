// A stdio MCP server with a deliberately large tool, for trying the library in a real client.
//   claude mcp add budget-demo -- node /path/to/examples/stdio-server.mjs
//   npx @modelcontextprotocol/inspector node examples/stdio-server.mjs
// Uses SDK v1 (@modelcontextprotocol/sdk) and zod, which you install in your own project.
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { withResultBudget } from "../dist/index.js";

const server = new McpServer({ name: "budget-demo", version: "0.1.0" });
withResultBudget(server, { profile: "portable", onWarning: (w) => console.error("[budget]", JSON.stringify(w)) });

server.registerTool(
  "big_log",
  { description: "Returns a 150,000-character synthetic log", inputSchema: z.object({ lines: z.number().int().min(1).max(5000).default(3000) }) },
  async ({ lines }) => ({
    content: [{ type: "text", text: Array.from({ length: lines }, (_, i) => `2026-11-18T10:00:00Z INFO request ${i} handled in ${i % 97} ms`).join("\n") }],
  }),
);

await server.connect(new StdioServerTransport());
