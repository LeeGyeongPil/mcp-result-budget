/** Thrown synchronously for invalid options (out-of-range budget, name clash, no registerTool). */
export class BudgetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetConfigError";
  }
}

/** Reported through `onWarning`; the library never silently breaks a result. */
export type BudgetWarning =
  | { code: "unsplittable-structured"; tool: string; reason: string }
  | { code: "unsupported-shape"; tool: string; reason: string }
  | { code: "oversize-atomic"; tool: string; page: number; chars: number }
  | { code: "error-trimmed"; tool: string; omitted: number }
  | { code: "unwrapped-tool"; tool: string; reason: string }
  | { code: "budget-not-met"; tool: string; page: number; chars: number };
