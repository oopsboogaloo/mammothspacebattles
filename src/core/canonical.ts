// Canonical JSON and hashing (ARC-003, DET-002).
// Object keys are sorted, -0 is preserved, and non-finite numbers are rejected,
// so serialise → parse → serialise always gives the same bytes.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonicalStringify(value: unknown, path = "$"): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path}: ${value}`);
      if (Object.is(value, -0)) return "-0";
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v, i) => canonicalStringify(v, `${path}[${i}]`)).join(",") + "]";
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return (
        "{" +
        keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k], `${path}.${k}`)).join(",") +
        "}"
      );
    }
    default:
      throw new Error(`Cannot serialise ${typeof value} at ${path}`);
  }
}

export function canonicalParse(text: string): Json {
  return JSON.parse(text) as Json;
}

/** 64-bit non-cryptographic hash (cyrb53 lanes) of a string, as 16 hex chars. */
export function hashString(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export function hashValue(value: unknown): string {
  return hashString(canonicalStringify(value));
}
