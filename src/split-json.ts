export interface Span {
  start: number;
  end: number;
}

/**
 * Finds the element spans of a top-level JSON array inside `text`, by position in the original
 * string (nothing is re-serialized). Returns undefined when the text is not exactly one JSON array.
 */
export function scanTopLevelArray(text: string): Span[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  const spans: Span[] = [];
  let i = 0;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (text[i] !== "[") return undefined;
  i++;
  let depth = 1;
  let inString = false;
  let escaped = false;
  let elemStart = -1;
  let lastNonSpace = -1;
  const close = () => {
    if (elemStart >= 0) spans.push({ start: elemStart, end: lastNonSpace + 1 });
    elemStart = -1;
  };
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      lastNonSpace = i;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (/\s/.test(ch)) continue;
    if (depth === 1 && ch === ",") {
      close();
      continue;
    }
    if (depth === 1 && ch === "]") {
      close();
      depth = 0;
      break;
    }
    if (elemStart < 0) elemStart = i;
    lastNonSpace = i;
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
  }
  if (depth !== 0 || spans.length !== parsed.length) return undefined;
  return spans;
}
