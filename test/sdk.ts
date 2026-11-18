import { z } from "zod";

export const flavors = ["v1", "v2"] as const;
export type Flavor = (typeof flavors)[number];

export interface Connected {
  server: any;
  client: any;
  close: () => Promise<void>;
}

/** Connects a real SDK server and client over an in-memory transport (v1 or v2 of the official SDK). */
export async function connect(flavor: Flavor, setup: (server: any) => void | Promise<void>): Promise<Connected> {
  let McpServer: any, Client: any, InMemoryTransport: any;
  if (flavor === "v1") {
    ({ McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js"));
    ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
    ({ InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js"));
  } else {
    ({ McpServer, InMemoryTransport } = await import("@modelcontextprotocol/server"));
    ({ Client } = await import("@modelcontextprotocol/client"));
  }
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  await setup(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(ct);
  return { server, client, close: async () => { await client.close(); await server.close?.(); } };
}

export const emptyInput = z.object({});

/** About 60k chars: Korean, emoji, many lines and one 20,000-char line. */
export function bigText(): string {
  const lines = Array.from({ length: 400 }, (_, i) => `줄 ${i} 한글과 emoji 😀 ` + "x".repeat(60));
  return lines.join("\n") + "\n" + "y".repeat(20000) + "\n" + lines.slice(0, 200).join("\n");
}

export function makeRows(n = 300) {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `item-${i}`, note: "z".repeat(40) }));
}

export const RowsOut = z.object({
  total: z.number(),
  rows: z.array(z.object({ id: z.number(), name: z.string(), note: z.string() })),
});

export function pngBase64(bytes = 22000): string {
  return Buffer.alloc(bytes, 7).toString("base64");
}
