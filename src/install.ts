import { z } from "zod";
import { decodeCursor } from "./cursor.js";
import { BudgetConfigError } from "./errors.js";
import { defaultNote, paginateResult, type PaginateContext } from "./paginate.js";
import { resolveBudget } from "./profiles.js";
import { toValidator, type Validator } from "./schema.js";
import { MemoryPageStore } from "./store.js";
import {
  DECLARE_META,
  type CallToolResultLike,
  type McpServerLike,
  type ResultBudget,
  type ResultBudgetOptions,
} from "./types.js";

const WRAPPED = Symbol.for("mcp-result-budget.wrapped");

/**
 * Wraps `server.registerTool` so oversized results are split into pages that fit the budget,
 * and registers the continuation tool (`read_more` by default). Call it BEFORE registering tools.
 */
export function withResultBudget(server: McpServerLike, options: ResultBudgetOptions = {}): ResultBudget {
  if (!server || typeof server.registerTool !== "function") {
    throw new BudgetConfigError(
      "withResultBudget needs a server with a registerTool(name, config, cb) method, such as the SDK McpServer.",
    );
  }
  if ((server as any)[WRAPPED]) {
    throw new BudgetConfigError("This server is already wrapped by withResultBudget; call it once.");
  }
  const resolved = resolveBudget(options);
  const continuationTool = options.continuationTool ?? "read_more";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(continuationTool)) {
    throw new BudgetConfigError(
      `continuationTool "${continuationTool}" is not a valid tool name (letters, digits, _ . -, max 64).`,
    );
  }
  const errorPolicy = options.errorPolicy ?? "trim";
  if (errorPolicy !== "trim" && errorPolicy !== "pass") {
    throw new BudgetConfigError(`errorPolicy must be "trim" or "pass", got ${String(errorPolicy)}.`);
  }
  const perTool = options.perTool ?? {};
  const perToolBudget = new Map<string, ReturnType<typeof resolveBudget> | false>();
  for (const [name, v] of Object.entries(perTool)) {
    if (v === false) perToolBudget.set(name, false);
    else {
      const { maxChars } = v;
      perToolBudget.set(
        name,
        maxChars === undefined ? resolved : resolveBudget({ maxChars, maxBytes: options.maxBytes }),
      );
    }
  }
  const store = options.store ?? new MemoryPageStore();
  const declareMeta = options.declareMeta ?? true;
  const validators = new Map<string, Validator>();
  const warn = options.onWarning ?? (() => {});
  const orig = server.registerTool.bind(server);

  const budgetFor = (tool: string) => (perToolBudget.has(tool) ? perToolBudget.get(tool)! : resolved);

  const paginate = async (tool: string, result: CallToolResultLike): Promise<CallToolResultLike> => {
    const b = budgetFor(tool);
    if (b === false) return result;
    const validator = validators.get(tool);
    const ctx: PaginateContext = {
      tool,
      maxChars: b.maxChars,
      errorPolicy,
      continuationTool,
      store,
      note: options.note ?? defaultNote,
      warn,
    };
    if (b.maxBytes !== undefined) ctx.maxBytes = b.maxBytes;
    if (validator) ctx.validator = validator;
    return paginateResult(ctx, result);
  };

  const err = (text: string): CallToolResultLike => ({ isError: true, content: [{ type: "text", text }] });

  // read_more returns pages of any tool, so it must declare the largest budget in use.
  let declaredMax = resolved.maxChars;
  for (const v of perToolBudget.values()) if (v !== false && v.maxChars > declaredMax) declaredMax = v.maxChars;

  // Tools registered before this call are not wrapped; say so instead of passing silently.
  const existing = (server as any)._registeredTools;
  if (existing && typeof existing === "object") {
    for (const name of Object.keys(existing)) {
      warn({
        code: "unwrapped-tool",
        tool: name,
        reason: "registered before withResultBudget was called; its results are not split. Call withResultBudget first.",
      });
    }
  }

  orig(
    continuationTool,
    {
      description:
        "Read the next page of a large tool result. Pass the cursor from the previous page's note or _meta.",
      inputSchema: z.object({ cursor: z.string().describe("Cursor from the previous page") }),
      annotations: { readOnlyHint: true, idempotentHint: true },
      ...(declareMeta ? { _meta: { [DECLARE_META]: declaredMax } } : {}),
    },
    async ({ cursor }: { cursor: string }) => {
      const d = decodeCursor(cursor);
      if (!d) return err(`cursor is not valid; call the original tool again to start over`);
      const stored = await store.get(d.id);
      const page = stored && stored.tool === d.tool ? stored.pages[d.page] : undefined;
      if (!page) return err(`cursor expired or unknown; call \`${d.tool}\` again`);
      return page;
    },
  );

  (server as any).registerTool = (name: string, config: any, cb: any) => {
    if (name === continuationTool) {
      throw new BudgetConfigError(
        `Tool name "${name}" clashes with the continuation tool. Pass { continuationTool: "other_name" } to withResultBudget.`,
      );
    }
    const b = budgetFor(name);
    if (b === false) return orig(name, config, cb);
    const validator = toValidator(config?.outputSchema);
    if (validator) validators.set(name, validator);
    const cfg = declareMeta
      ? { ...(config ?? {}), _meta: { ...(config?._meta ?? {}), [DECLARE_META]: b.maxChars } }
      : config;
    return orig(name, cfg, async (...args: unknown[]) => paginate(name, await cb(...args)));
  };
  // Deprecated v1 server.tool(): wrap its callback (the last argument) so results are still split.
  // It cannot carry _meta or outputSchema, so the budget declaration is not available for these tools.
  const origTool = typeof (server as any).tool === "function" ? (server as any).tool.bind(server) : undefined;
  if (origTool) {
    (server as any).tool = (name: string, ...rest: any[]) => {
      if (name === continuationTool) {
        throw new BudgetConfigError(
          `Tool name "${name}" clashes with the continuation tool. Pass { continuationTool: "other_name" } to withResultBudget.`,
        );
      }
      const last = rest.length - 1;
      if (last < 0 || typeof rest[last] !== "function" || budgetFor(name) === false) return origTool(name, ...rest);
      warn({
        code: "unwrapped-tool",
        tool: name,
        reason: "registered with the deprecated server.tool(); results are split but no size is declared. Prefer registerTool.",
      });
      const cb = rest[last];
      rest[last] = async (...args: unknown[]) => paginate(name, await cb(...args));
      return origTool(name, ...rest);
    };
  }
  (server as any)[WRAPPED] = true;

  return { maxChars: resolved.maxChars, paginate };
}
