/**
 * Payload hygiene for the audit trail: nothing secret goes in, nothing huge
 * stays in. Pure functions so they are trivially testable.
 */

const SECRET_KEY =
  /pass(word)?|secret|token|hash|authorization|cookie|api[-_]?key|otp|private[-_]?key|credential/i;

export const REDACTED = '[redacted]';

export interface SanitizeLimits {
  maxDepth: number;
  maxArray: number;
  maxString: number;
  maxKeys: number;
  /** Serialized size cap for the whole payload, in characters. */
  maxBytes: number;
}

export const DEFAULT_LIMITS: SanitizeLimits = {
  maxDepth: 5,
  maxArray: 20,
  maxString: 500,
  maxKeys: 60,
  maxBytes: 8_000,
};

export function sanitize(value: unknown, limits: Partial<SanitizeLimits> = {}): unknown {
  const l = { ...DEFAULT_LIMITS, ...limits };
  const cleaned = walk(value, 0, l, new WeakSet());
  let size: number;
  try {
    size = JSON.stringify(cleaned)?.length ?? 0;
  } catch {
    return { _truncated: true };
  }
  if (size <= l.maxBytes) return cleaned;
  // Still too big after per-node limits: keep only the shape.
  const keys =
    cleaned && typeof cleaned === 'object' ? Object.keys(cleaned as object).slice(0, l.maxKeys) : [];
  return { _truncated: true, _size: size, keys };
}

function walk(value: unknown, depth: number, l: SanitizeLimits, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
      return value.length > l.maxString
        ? `${value.slice(0, l.maxString)}…[+${value.length - l.maxString}]`
        : value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const obj = value as object;
  // Prisma.Decimal and similar expose toJSON.
  if (typeof (obj as { toJSON?: unknown }).toJSON === 'function' && !Array.isArray(obj)) {
    try {
      return walk((obj as { toJSON: () => unknown }).toJSON(), depth, l, seen);
    } catch {
      return null;
    }
  }
  if (seen.has(obj)) return '[circular]';
  if (depth >= l.maxDepth) return '[max depth]';
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const out = obj.slice(0, l.maxArray).map((item) => walk(item, depth + 1, l, seen));
      if (obj.length > l.maxArray) out.push(`[+${obj.length - l.maxArray} more]`);
      return out;
    }
    const out: Record<string, unknown> = {};
    const entries = Object.entries(obj as Record<string, unknown>);
    for (const [key, v] of entries.slice(0, l.maxKeys)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : walk(v, depth + 1, l, seen);
    }
    if (entries.length > l.maxKeys) out._truncatedKeys = entries.length - l.maxKeys;
    return out;
  } finally {
    seen.delete(obj);
  }
}

/** Top-level scalar fields only: enough to read "validated, number FA-0001". */
export function scalarSummary(value: unknown, max = 20): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (n >= max) break;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[key] = v;
      n++;
    }
  }
  return sanitize(out) as Record<string, unknown>;
}
