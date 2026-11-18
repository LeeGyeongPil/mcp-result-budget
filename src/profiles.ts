import { BudgetConfigError } from "./errors.js";
import type { ClientProfile, ProfileName, ResultBudgetOptions } from "./types.js";

export const MIN_CHARS = 1000;
export const MAX_CHARS = 500_000;

const base: Record<Exclude<ProfileName, "portable">, ClientProfile> = {
  "agent-cli": {
    tokens: 25_000,
    chars: 50_000,
    source: "https://code.claude.com/docs/en/mcp.md",
    checked: "2026-11-18",
    note: "MAX_MCP_OUTPUT_TOKENS default 25,000 tokens; text over 50,000 chars is saved to a file.",
  },
  codex: {
    tokens: 12_000,
    source: "https://learn.chatgpt.com/docs/config-file/config-sample",
    checked: "2026-11-18",
    note: "tool_output_token_limit as shown in the sample config (an example value, not a documented default).",
  },
  "gemini-cli": {
    chars: 40_000,
    source: "https://www.mintlify.com/google-gemini/gemini-cli/reference/settings",
    checked: "2026-11-18",
    note: "tools.truncateToolOutputThreshold default; taken from a third-party mirror of the settings reference.",
  },
  "http-1mib": {
    bytes: 1_048_576,
    source: "https://github.com/MysterionRise/pubchem-finder/issues/201",
    checked: "2026-11-18",
    note: "Official Python client SSE events are capped at 1 MiB (reported in the linked issue).",
  },
};

function minOf(values: Array<number | undefined>): number | undefined {
  const nums = values.filter((v): v is number => typeof v === "number");
  return nums.length ? Math.min(...nums) : undefined;
}

const others = Object.values(base);
const portable: ClientProfile = {
  tokens: minOf(others.map((p) => p.tokens)),
  chars: minOf(others.map((p) => p.chars)),
  bytes: minOf(others.map((p) => p.bytes)),
  source: "https://code.claude.com/docs/en/mcp.md",
  checked: "2026-11-18",
  note: "Smallest limit of the other profiles, so one setting is safe everywhere.",
};

export const profiles: Readonly<Record<ProfileName, ClientProfile>> = Object.freeze({
  ...base,
  portable,
});

export function resolveBudget(
  opts: Pick<ResultBudgetOptions, "profile" | "maxChars" | "maxBytes" | "charsPerToken">,
): { maxChars: number; maxBytes?: number } {
  const cpt = opts.charsPerToken ?? 1;
  if (!(typeof cpt === "number" && cpt > 0 && Number.isFinite(cpt))) {
    throw new BudgetConfigError(`charsPerToken must be a positive number, got ${String(cpt)}.`);
  }
  const name = opts.profile ?? "portable";
  const profile = profiles[name];
  if (!profile) {
    throw new BudgetConfigError(
      `Unknown profile "${String(name)}". Use one of: ${Object.keys(profiles).join(", ")}.`,
    );
  }
  let maxChars = opts.maxChars;
  if (maxChars === undefined) {
    const fromProfile = minOf([
      profile.tokens !== undefined ? Math.floor(profile.tokens * cpt) : undefined,
      profile.chars,
    ]);
    maxChars = fromProfile ?? MAX_CHARS;
  }
  if (!Number.isInteger(maxChars) || maxChars < MIN_CHARS || maxChars > MAX_CHARS) {
    throw new BudgetConfigError(
      `maxChars must be an integer between ${MIN_CHARS} and ${MAX_CHARS}, got ${String(maxChars)}. ` +
        `Pass a value in range or pick a profile.`,
    );
  }
  let maxBytes = opts.maxBytes ?? (opts.maxChars === undefined ? profile.bytes : undefined);
  if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes < MIN_CHARS)) {
    throw new BudgetConfigError(`maxBytes must be an integer >= ${MIN_CHARS}, got ${String(maxBytes)}.`);
  }
  return maxBytes === undefined ? { maxChars } : { maxChars, maxBytes };
}
