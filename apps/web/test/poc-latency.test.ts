import { checkoutInputSchema } from '@dose/contract';
import { normalisePhone } from '@dose/core/phone';
import { describe, expect, test } from 'vitest';
import {
  CHECKOUTS_PER_TARGET,
  interleaved,
  latencyCheckoutBody,
  latencyPageConfig,
  latencyTestPhone,
  percentile,
  stats,
  verdict,
  type Stats,
} from '../src/poc-latency';

/** 1, 2, …, n in a shuffled order, so nothing relies on the input being sorted. */
const shuffled = (n: number) => Array.from({ length: n }, (_, i) => ((i * 37) % n) + 1);

describe('percentile (nearest rank)', () => {
  test('of 50 values: p50 is the 25th, p95 the 48th, p99 the 50th smallest', () => {
    const values = shuffled(50);
    expect(new Set(values).size).toBe(50);
    expect(percentile(values, 50)).toBe(25);
    expect(percentile(values, 95)).toBe(48);
    expect(percentile(values, 99)).toBe(50);
    expect(percentile(values, 100)).toBe(50);
  });

  test('of 100 values: p95 is the 95th smallest', () => {
    expect(percentile(shuffled(100), 95)).toBe(95);
  });

  test('is always a measured value, never an interpolation', () => {
    expect(percentile([100, 200], 50)).toBe(100);
    expect(percentile([100, 200], 95)).toBe(200);
    expect(percentile([10.5, 300.25, 42], 95)).toBe(300.25);
  });

  test('of one value is that value', () => {
    expect(percentile([7], 1)).toBe(7);
    expect(percentile([7], 99)).toBe(7);
  });

  test('does not reorder its input', () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });

  test('refuses no values and a percentile outside (0, 100]', () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
    expect(() => percentile([1], 0)).toThrow(RangeError);
    expect(() => percentile([1], 101)).toThrow(RangeError);
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError);
  });
});

describe('stats', () => {
  test('n, p50, p95, p99, min and max', () => {
    expect(stats(shuffled(50).map((v) => v * 10))).toEqual({ n: 50, p50: 250, p95: 480, p99: 500, min: 10, max: 500 });
  });

  test('none when every checkout failed', () => {
    expect(stats([])).toBeNull();
  });
});

describe('verdict (worker_p95 / container_p95)', () => {
  const at = (p95: number): Stats => ({ n: 50, p50: p95 / 2, p95, p99: p95, min: 1, max: p95 });

  test('the ratio to two decimals', () => {
    expect(verdict(at(300), at(200))).toEqual({ ratio: 1.5, exceeds: false });
    expect(verdict(at(250), at(300))).toEqual({ ratio: 0.83, exceeds: false });
    expect(verdict(at(1000), at(300))).toEqual({ ratio: 3.33, exceeds: true });
  });

  test('exactly 1.5 does not exceed; anything more does, even when it rounds to 1.50', () => {
    expect(verdict(at(450), at(300))?.exceeds).toBe(false);
    expect(verdict(at(450.6), at(300))).toEqual({ ratio: 1.5, exceeds: true });
    expect(verdict(at(451), at(300))).toEqual({ ratio: 1.5, exceeds: true });
  });

  test('none without both targets measured', () => {
    expect(verdict(null, at(300))).toBeNull();
    expect(verdict(at(300), null)).toBeNull();
    expect(verdict(at(300), at(0))).toBeNull();
  });
});

test('the checkouts alternate W, C, W, C, starting with the Worker, 50 of each', () => {
  const plan = interleaved(CHECKOUTS_PER_TARGET);
  expect(plan).toHaveLength(100);
  expect(plan.slice(0, 4)).toEqual(['worker', 'container', 'worker', 'container']);
  expect(plan.filter((t) => t === 'worker')).toHaveLength(50);
  expect(plan.every((t, i) => t === (i % 2 === 0 ? 'worker' : 'container'))).toBe(true);
});

test('test phones are valid +2011 mobiles at both ends of the range', () => {
  for (const r of [0, 0.5, 0.999999999]) {
    const phone = latencyTestPhone(() => r);
    expect(phone).toMatch(/^\+2011\d{8}$/);
    expect(normalisePhone(phone)).toEqual({ ok: true, e164: phone });
  }
  expect(latencyTestPhone(() => 0)).toBe('+201100000000');
});

test('a checkout body passes the API contract', () => {
  const body = latencyCheckoutBody({ key: crypto.randomUUID(), phone: latencyTestPhone(), quotedTotal: 17_000, target: 'container', index: 3 });
  expect(checkoutInputSchema.safeParse(body).success).toBe(true);
  expect(body.lines).toEqual([{ sku: 'POC-LATENCY', quantity: 1 }]);
});

describe('latencyPageConfig', () => {
  const CONTAINER = 'https://dose-node-control.fly.dev';
  const ready = { ENVIRONMENT: 'staging', POC_CONTAINER_URL: CONTAINER, POC_TOKEN: 'secret-token' };

  test('production is a 404, whatever is configured', () => {
    expect(latencyPageConfig({ ...ready, ENVIRONMENT: 'production' })).toEqual({ kind: 'not-found' });
  });

  test('with both settings it runs', () => {
    expect(latencyPageConfig(ready)).toEqual({ kind: 'ready', containerUrl: CONTAINER, token: 'secret-token' });
    expect(latencyPageConfig({ ...ready, POC_CONTAINER_URL: `${CONTAINER}/` })).toMatchObject({ containerUrl: CONTAINER });
  });

  test.each([
    ['neither', { ENVIRONMENT: 'staging' }, ['POC_CONTAINER_URL', 'POC_TOKEN']],
    ['an empty container URL (the checked-in value)', { ...ready, POC_CONTAINER_URL: '' }, ['POC_CONTAINER_URL']],
    ['a container URL with a path', { ...ready, POC_CONTAINER_URL: `${CONTAINER}/api` }, ['POC_CONTAINER_URL']],
    ['a container URL that is not http', { ...ready, POC_CONTAINER_URL: 'ftp://x.example' }, ['POC_CONTAINER_URL']],
    ['no token', { ...ready, POC_TOKEN: undefined }, ['POC_TOKEN']],
    ['an empty token', { ...ready, POC_TOKEN: '' }, ['POC_TOKEN']],
  ])('with %s it names what is missing and runs nothing', (_name, env, names) => {
    expect(latencyPageConfig(env)).toEqual({ kind: 'missing', names });
  });
});
