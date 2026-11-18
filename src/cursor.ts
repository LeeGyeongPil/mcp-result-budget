import { randomBytes } from "node:crypto";

export function newId(): string {
  return randomBytes(16).toString("base64url");
}

/** Opaque cursor: base64url of `tool \n id \n page`. The tool name lets errors say what to call again. */
export function encodeCursor(tool: string, id: string, page: number): string {
  return Buffer.from(`${tool}\n${id}\n${page}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { tool: string; id: string; page: number } | undefined {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 2000) return undefined;
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
  const parts = raw.split("\n");
  if (parts.length !== 3) return undefined;
  const [tool, id, pageText] = parts as [string, string, string];
  const page = Number(pageText);
  if (!tool || !id || !Number.isInteger(page) || page < 0) return undefined;
  return { tool, id, page };
}
