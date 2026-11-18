import type { BudgetWarning } from "./errors.js";

export interface ContentBlock {
  type: string;
  text?: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CallToolResultLike {
  content?: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Anything with the `registerTool(name, config, cb)` method of the official SDK `McpServer`. */
export interface McpServerLike {
  registerTool: (name: string, config: any, cb: any) => any;
}

export interface PageInfo {
  index: number; // zero-based
  total: number;
  nextCursor: string | null;
  remainingChars: number;
  continuationTool: string;
}

export interface StoredResult {
  tool: string;
  pages: CallToolResultLike[];
}

export interface PageStore {
  get(id: string): Promise<StoredResult | undefined>;
  set(id: string, value: StoredResult): Promise<void>;
  delete(id: string): Promise<void>;
}

export type ProfileName = "agent-cli" | "codex" | "gemini-cli" | "http-1mib" | "portable";

export interface ClientProfile {
  tokens?: number;
  chars?: number;
  bytes?: number;
  source: string;
  checked: string;
  note: string;
}

export interface ResultBudgetOptions {
  profile?: ProfileName;
  maxChars?: number;
  maxBytes?: number;
  charsPerToken?: number;
  continuationTool?: string;
  store?: PageStore;
  declareMeta?: boolean;
  perTool?: Record<string, { maxChars?: number } | false>;
  errorPolicy?: "trim" | "pass";
  note?: (info: PageInfo) => string;
  onWarning?: (warning: BudgetWarning) => void;
}

export interface ResultBudget {
  readonly maxChars: number;
  paginate(toolName: string, result: CallToolResultLike): Promise<CallToolResultLike>;
}

/** Keys used in `_meta` (page info, block markers). */
export const PAGE_META = "mcp-result-budget/page";
export const PART_META = "mcp-result-budget/part";
export const NOTE_META = "mcp-result-budget/note";
export const DECLARE_META = "anthropic/maxResultSizeChars";
