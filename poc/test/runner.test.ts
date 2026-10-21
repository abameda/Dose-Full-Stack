import { checkoutInputSchema } from '@dose/contract';
import { normalisePhone } from '@dose/core/phone';
import { describe, expect, test } from 'vitest';
import {
  authHeaders,
  checkoutBody,
  classify,
  idempotencyKey,
  judgeRun,
  newRunTag,
  nextPhones,
  parseRunnerArgs,
  runKeyPrefix,
  runLine,
  summarise,
  summaryLines,
  tally,
  testPhone,
  type RunResult,
  type RunTally,
} from '../runner';

const TARGET = 'https://dose-web-poc.example-sub.workers.dev';

describe('parseRunnerArgs', () => {
  const base = ['--target', TARGET, '--auth', 'access', '--runs', '100'];

  test('the full command line', () => {
    expect(
      parseRunnerArgs([...base, '--start', '51', '--concurrency', '200', '--units', '10', '--out', 'worker.jsonl']),
    ).toEqual({ target: TARGET, auth: 'access', runs: 100, start: 51, concurrency: 200, units: 10, out: 'worker.jsonl' });
  });

  test('defaults: start 1, concurrency 200, units 10, no output file', () => {
    expect(parseRunnerArgs(base)).toEqual({ target: TARGET, auth: 'access', runs: 100, start: 1, concurrency: 200, units: 10 });
  });

  test('the `--` pnpm may put before the arguments is ignored', () => {
    expect(parseRunnerArgs(['--', ...base]).runs).toBe(100);
  });

  test('a trailing slash on the target is dropped; http works for a local target', () => {
    expect(parseRunnerArgs(['--target', `${TARGET}/`, '--auth', 'bearer', '--runs', '1']).target).toBe(TARGET);
    expect(parseRunnerArgs(['--target', 'http://127.0.0.1:4010', '--auth', 'bearer', '--runs', '1']).target).toBe('http://127.0.0.1:4010');
  });

  test.each([
    ['no target', ['--auth', 'access', '--runs', '1'], /--target/],
    ['a target with a path', ['--target', `${TARGET}/api`, '--auth', 'access', '--runs', '1'], /origin/],
    ['a target that is not http', ['--target', 'ftp://x.example', '--auth', 'access', '--runs', '1'], /origin/],
    ['no auth', ['--target', TARGET, '--runs', '1'], /--auth/],
    ['an unknown auth', ['--target', TARGET, '--auth', 'cookie', '--runs', '1'], /--auth/],
    ['no runs', ['--target', TARGET, '--auth', 'access'], /--runs/],
    ['zero runs', [...base.slice(0, 4), '--runs', '0'], /--runs/],
    ['a fractional concurrency', [...base, '--concurrency', '2.5'], /--concurrency/],
    ['a negative start', [...base, '--start', '-1'], /start/],
    ['more units than checkouts', [...base, '--concurrency', '5', '--units', '6'], /--units/],
    ['an empty output file', [...base, '--out', ''], /--out/],
    ['an unknown option', [...base, '--fast'], /fast/],
    ['a stray positional', [...base, 'extra'], /extra|positional/i],
  ])('refuses %s', (_name, argv, message) => {
    expect(() => parseRunnerArgs(argv)).toThrow(message);
  });
});

describe('authHeaders', () => {
  test('access sends the service token headers', () => {
    expect(authHeaders('access', { CF_ACCESS_CLIENT_ID: 'id.access', CF_ACCESS_CLIENT_SECRET: 'secret' })).toEqual({
      'CF-Access-Client-Id': 'id.access',
      'CF-Access-Client-Secret': 'secret',
    });
  });

  test('bearer sends the container token', () => {
    expect(authHeaders('bearer', { POC_TOKEN: 'tok' })).toEqual({ authorization: 'Bearer tok' });
  });

  test.each([
    ['access', {}, 'CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are not set'],
    ['access', { CF_ACCESS_CLIENT_ID: 'id.access' }, 'CF_ACCESS_CLIENT_SECRET is not set'],
    ['access', { CF_ACCESS_CLIENT_SECRET: 'the-secret', CF_ACCESS_CLIENT_ID: '' }, 'CF_ACCESS_CLIENT_ID is not set'],
    ['bearer', { CF_ACCESS_CLIENT_ID: 'id.access' }, 'POC_TOKEN is not set'],
  ] as const)('%s fails naming what is missing, and no value', (auth, env: Record<string, string>, message) => {
    expect(() => authHeaders(auth, env)).toThrow(message);
    try {
      authHeaders(auth, env);
    } catch (error) {
      for (const value of Object.values(env).filter((v) => v !== '')) expect((error as Error).message).not.toContain(value);
    }
  });
});

describe('test phones', () => {
  test('are +2010 and eight digits, valid Egyptian mobiles', () => {
    for (const n of [0, 1, 12_345_678, 99_999_999]) {
      const phone = testPhone(n);
      expect(phone).toMatch(/^\+2010\d{8}$/);
      expect(normalisePhone(phone)).toEqual({ ok: true, e164: phone });
    }
    expect(testPhone(42)).toBe('+201000000042');
  });

  test('outside the eight digits there are none', () => {
    expect(() => testPhone(-1)).toThrow(RangeError);
    expect(() => testPhone(100_000_000)).toThrow(RangeError);
    expect(() => testPhone(1.5)).toThrow(RangeError);
  });

  test('the next phones follow the last one used, all different', () => {
    expect(nextPhones(null, 3)).toEqual(['+201000000000', '+201000000001', '+201000000002']);
    expect(nextPhones('+201000000199', 2)).toEqual(['+201000000200', '+201000000201']);
    expect(new Set(nextPhones('+201012345678', 200)).size).toBe(200);
  });

  test('refuse to run out or to continue from something that is not a test phone', () => {
    expect(() => nextPhones('+201099999990', 10)).toThrow(/used up/);
    expect(() => nextPhones('+201112345678', 1)).toThrow(/not a \+2010 test phone/);
  });
});

describe('idempotency keys', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test('carry the run prefix, stay valid uuids, and differ', () => {
    const prefix = runKeyPrefix('20261021T081500Z-abcdef', 7);
    const keys = Array.from({ length: 50 }, () => idempotencyKey(prefix));
    for (const key of keys) {
      expect(key).toMatch(UUID_V4);
      expect(key.startsWith(prefix)).toBe(true);
    }
    expect(new Set(keys).size).toBe(50);
  });

  test('the prefix differs between runs and between invocations', () => {
    expect(runKeyPrefix('tag-a', 1)).not.toBe(runKeyPrefix('tag-a', 2));
    expect(runKeyPrefix('tag-a', 1)).not.toBe(runKeyPrefix('tag-b', 1));
    expect(runKeyPrefix('tag-a', 1)).toBe(runKeyPrefix('tag-a', 1));
  });

  test('a run tag is time-stamped and unique per invocation', () => {
    const now = new Date('2026-10-21T08:15:00.123Z');
    expect(newRunTag(now)).toMatch(/^20261021T081500Z-[0-9a-f]{6}$/);
    expect(newRunTag(now)).not.toBe(newRunTag(now));
  });
});

test('a checkout body passes the API contract', () => {
  const body = checkoutBody({
    sku: 'POC-CONCURRENCY',
    quotedTotal: 17_000,
    key: idempotencyKey('0a1b2c3d'),
    phone: testPhone(5),
    run: 3,
    index: 4,
  });
  expect(checkoutInputSchema.safeParse(body).success).toBe(true);
  expect(body.lines).toEqual([{ sku: 'POC-CONCURRENCY', quantity: 1 }]);
});

describe('classify and tally', () => {
  test('201 is an order, 409 out_of_stock a refusal, anything else is other with its status and body', () => {
    expect(classify(201, '{"ok":true,"orderNumber":"D10001","total":17000}')).toBe('created');
    expect(classify(409, '{"ok":false,"code":"out_of_stock","skus":["POC-CONCURRENCY"]}')).toBe('outOfStock');
    expect(classify(409, '{"ok":false,"code":"price_changed"}')).toEqual({ status: 409, message: '{"ok":false,"code":"price_changed"}' });
    expect(classify(500, '{"error":"internal"}')).toEqual({ status: 500, message: '{"error":"internal"}' });
    expect(classify(503, '<html>\n  Service   Unavailable </html>')).toEqual({ status: 503, message: '<html> Service Unavailable </html>' });
  });

  test('tally counts each kind', () => {
    const other = { status: null, message: 'TimeoutError: The operation was aborted due to timeout' };
    expect(tally(['created', 'outOfStock', 'outOfStock', other])).toEqual({ created: 1, outOfStock: 2, other: [other] });
  });
});

describe('judgeRun', () => {
  const pass: RunTally = { created: 10, outOfStock: 190, other: [] };
  const judge = (o: Partial<Parameters<typeof judgeRun>[0]> = {}) =>
    judgeRun({ units: 10, concurrency: 200, tally: pass, orders: 10, violations: [], ...o });

  test('exactly the units placed, the rest refused, the orders there and the rules intact: passes', () => {
    expect(judge()).toEqual([]);
  });

  test('one more order than units (an oversell) fails on 201, 409 and the orders', () => {
    expect(judge({ tally: { created: 11, outOfStock: 189, other: [] }, orders: 11 })).toEqual([
      '201=11, expected 10',
      '409 out_of_stock=189, expected 190',
      'orders=11 in the database, expected 10',
    ]);
  });

  test('connection errors and timeouts fail the run, each distinct one named with its count (belief B4)', () => {
    const tooMany = { status: 500, message: '{"error":"internal"}' };
    const timeout = { status: null, message: 'TimeoutError: The operation was aborted due to timeout' };
    expect(judge({ tally: { created: 10, outOfStock: 187, other: [tooMany, tooMany, timeout] } })).toEqual([
      '409 out_of_stock=187, expected 190',
      '2 x status 500: {"error":"internal"}',
      '1 x no response: TimeoutError: The operation was aborted due to timeout',
    ]);
  });

  test('a database that disagrees with the answers fails', () => {
    expect(judge({ orders: 9 })).toEqual(['orders=9 in the database, expected 10']);
  });

  test('a broken rule fails', () => {
    expect(judge({ violations: [{ rule: 3, detail: 'variant POC-CONCURRENCY: reserved 11 with 10 on hand' }] })).toEqual([
      'rule 3 broken: variant POC-CONCURRENCY: reserved 11 with 10 on hand',
    ]);
  });
});

describe('output', () => {
  const result = (o: Partial<RunResult>): RunResult => ({
    runTag: 'tag',
    run: 1,
    target: TARGET,
    auth: 'access',
    concurrency: 200,
    units: 10,
    startedAt: '2026-10-21T08:15:00.000Z',
    ms: 3_210,
    created: 10,
    outOfStock: 190,
    other: 0,
    orders: 10,
    rulesBroken: 0,
    failures: [],
    ok: true,
    ...o,
  });

  test('one line per run', () => {
    expect(runLine(result({ run: 3 }), 100)).toBe('run 3/100: 201=10 409=190 other=0 orders=10 rules=ok in 3.2 s');
    expect(runLine(result({ rulesBroken: 2, other: 1 }), 1)).toBe('run 1/1: 201=10 409=190 other=1 orders=10 rules=2 broken in 3.2 s');
  });

  test('the summary: passed and failed, wall time, the slowest run and every distinct failure with its runs', () => {
    const results = [
      result({ run: 1, ms: 3_000 }),
      result({ run: 2, ms: 9_400, ok: false, failures: ['1 x status 500: {"error":"internal"}'] }),
      result({ run: 3, ms: 4_000, ok: false, failures: ['1 x status 500: {"error":"internal"}', 'orders=9 in the database, expected 10'] }),
    ];
    const summary = summarise(results, 75_000);
    expect(summary).toMatchObject({ passed: 1, failed: 2, ms: 75_000 });
    expect(summary.slowest?.run).toBe(2);
    expect(summaryLines(summary)).toEqual([
      'summary: 3 run(s), 1 passed, 2 failed, in 1 min 15 s',
      'slowest: run 2, 9.4 s',
      'failures:',
      '  - 1 x status 500: {"error":"internal"} (runs 2, 3)',
      '  - orders=9 in the database, expected 10 (run 3)',
    ]);
  });

  test('an all-pass summary lists no failures', () => {
    expect(summaryLines(summarise([result({})], 3_300))).toEqual(['summary: 1 run(s), 1 passed, 0 failed, in 3.3 s', 'slowest: run 1, 3.2 s']);
  });
});
