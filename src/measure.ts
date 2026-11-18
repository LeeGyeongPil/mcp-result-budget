const encoder = new TextEncoder();

/** Final serialized size in UTF-16 code units: what a client receives on the wire (as JSON). */
export function measureChars(value: unknown): number {
  return JSON.stringify(value).length;
}

/** Final serialized size in UTF-8 bytes. */
export function measureBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Cost of a string once it sits inside a JSON string literal (without the quotes). */
export function escLen(text: string): number {
  return JSON.stringify(text).length - 2;
}
