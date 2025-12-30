/**
 * Deterministic JSON stringify:
 * - Sorts object keys recursively
 * - No extra whitespace
 * - UTF-8 by default in Node
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortRec(value));
}

function sortRec(x: any): any {
  if (Array.isArray(x)) return x.map(sortRec);
  if (x && typeof x === "object") {
    const out: any = {};
    for (const k of Object.keys(x).sort()) out[k] = sortRec(x[k]);
    return out;
  }
  return x;
}
