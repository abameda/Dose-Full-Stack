// The maths and the plain parts of the latency page (`/poc/latency`, Milestone 1 Task 19): the
// checkout time of the poc Worker against the Node container, measured from a phone. The decision
// rule (master plan, section A): if the Worker's p95 is more than 1.5 times the container's, the
// commerce core moves to the container. Runs in the browser (the page's script) and in the Worker
// (the page's configuration), so it imports nothing.

export type Target = 'worker' | 'container';

/** Checkouts per target in one measurement, after one warm-up each that is not counted. */
export const CHECKOUTS_PER_TARGET = 50;

/** The decision rule's threshold for `worker_p95 / container_p95`. */
export const RATIO_LIMIT = 1.5;

/** The variant every checkout orders one unit of (`pnpm poc:concurrency` keeps it stocked). */
export const LATENCY_SKU = 'POC-LATENCY';

export interface Stats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

/**
 * The `p`th percentile (0 < p <= 100) of `values` by the nearest-rank method: the smallest value
 * with at least p% of the values at or below it. Always one of the measured values, never an
 * interpolation; with 50 values p95 is the 48th smallest and p99 the 50th (the largest).
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('no values');
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentile must be in (0, 100], got ${String(p)}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1] ?? Number.NaN;
}

/** n, p50, p95, p99, min and max of the successful timings, in ms; null when there are none. */
export function stats(timings: readonly number[]): Stats | null {
  if (timings.length === 0) return null;
  return {
    n: timings.length,
    p50: percentile(timings, 50),
    p95: percentile(timings, 95),
    p99: percentile(timings, 99),
    min: Math.min(...timings),
    max: Math.max(...timings),
  };
}

export interface Verdict {
  /** `worker_p95 / container_p95`, rounded to two decimals for display. */
  ratio: number;
  /** Whether the unrounded ratio is more than `RATIO_LIMIT` (the core would move to the container). */
  exceeds: boolean;
}

/** The decision rule over the two p95s; null when either target has no successful checkout. */
export function verdict(worker: Stats | null, container: Stats | null): Verdict | null {
  if (worker === null || container === null || container.p95 <= 0) return null;
  const exact = worker.p95 / container.p95;
  return { ratio: Math.round(exact * 100) / 100, exceeds: exact > RATIO_LIMIT };
}

/** The order of the measured checkouts: W, C, W, C, … `perTarget` of each. */
export function interleaved(perTarget: number): Target[] {
  return Array.from({ length: perTarget * 2 }, (_, i) => (i % 2 === 0 ? 'worker' : 'container'));
}

/** A test phone `+2011` and eight random digits (the concurrency runner uses `+2010…`, so they never meet). */
export function latencyTestPhone(random: () => number = Math.random): string {
  const digits = Math.floor(random() * 100_000_000);
  return `+2011${String(Math.min(digits, 99_999_999)).padStart(8, '0')}`;
}

/** One checkout of one unit of `POC-LATENCY` (the storefront contract's body). */
export function latencyCheckoutBody(o: { key: string; phone: string; quotedTotal: number; target: Target; index: number }) {
  return {
    idempotencyKey: o.key,
    lang: 'en' as const,
    direction: 'd0-baseline',
    lines: [{ sku: LATENCY_SKU, quantity: 1 }],
    quotedTotal: o.quotedTotal,
    customer: { name: `POC Latency ${o.target} ${String(o.index)}`, phone: o.phone },
    address: { governorate: 'cairo', area: 'POC Test Area', street: 'POC Test Street', building: '1' },
  };
}

export type LatencyPageConfig =
  | { kind: 'not-found' }
  | { kind: 'missing'; names: string[] }
  | { kind: 'ready'; containerUrl: string; token: string };

/**
 * What the page may do in this Worker: nothing in production (a 404, like any unknown page);
 * outside it, run only with both `POC_CONTAINER_URL` (an http(s) origin; a trailing slash is
 * dropped) and `POC_TOKEN`, else name what is missing.
 */
export function latencyPageConfig(env: { ENVIRONMENT: string; POC_CONTAINER_URL?: string | undefined; POC_TOKEN?: string | undefined }): LatencyPageConfig {
  if (env.ENVIRONMENT === 'production') return { kind: 'not-found' };
  const names: string[] = [];
  let containerUrl: string | null = null;
  try {
    const url = new URL(env.POC_CONTAINER_URL ?? '');
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.origin === (env.POC_CONTAINER_URL ?? '').replace(/\/$/, '')) {
      containerUrl = url.origin;
    }
  } catch {
    containerUrl = null;
  }
  if (containerUrl === null) names.push('POC_CONTAINER_URL');
  const token = env.POC_TOKEN ?? '';
  if (token === '') names.push('POC_TOKEN');
  if (containerUrl === null || token === '') return { kind: 'missing', names };
  return { kind: 'ready', containerUrl, token };
}
