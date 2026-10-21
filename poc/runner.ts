// The concurrency proof of Milestone 1, Task 19 (belief B4): against one target (the poc Worker or
// the Node container), each run resets one variant to `units` free units through the owner
// connection, fires `concurrency` checkouts for it at the same moment, and checks that exactly
// `units` were placed and every other one was refused as out of stock, with the commerce rules
// intact. The CLI is concurrency.ts; this file holds everything it does, so tests can run it
// against the in-process API.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { CheckoutInput, ProductView } from '@dose/contract';
import type { Db, Tx } from '@dose/core/db';
import { readEnvIdentity } from '@dose/core/env-identity';
import { checkRules, type Violation } from '@dose/core/rules';
import { adjustStock, getStock, receiveStock } from '@dose/core/stock';

/** The only database the runner writes to: the Neon `poc` branch (`pnpm env:identity`). */
export const POC_IDENTITY = 'nonprod:poc';

/** The products the proof of concept uses, on the poc branch only. */
export const CONCURRENCY_PRODUCT = { slug: 'poc-concurrency', sku: 'POC-CONCURRENCY' } as const;
export const LATENCY_PRODUCT = { slug: 'poc-latency', sku: 'POC-LATENCY' } as const;

/** The latency page orders `POC-LATENCY` one unit at a time; the runner keeps at least this many free. */
export const LATENCY_MIN_FREE = 10_000;

/** Placeholder price of both products (EGP 100), in piastres. */
const POC_PRICE = 10_000;

/** Where every checkout is delivered; cash on delivery is offered there. */
const GOVERNORATE = 'cairo';

/** A checkout that has not answered in this long counts as a failure (a timeout). */
export const CHECKOUT_TIMEOUT_MS = 60_000;

const ACTOR = { type: 'system', id: 'poc:concurrency' } as const;

// ── Arguments and environment ────────────────────────────────────────────────────────────────

export type AuthMode = 'access' | 'bearer';

export interface RunnerArgs {
  /** The target's origin, e.g. `https://dose-web-poc.<sub>.workers.dev`. */
  target: string;
  auth: AuthMode;
  runs: number;
  /** The number of the first run (runs are numbered `start` to `start + runs - 1`). */
  start: number;
  concurrency: number;
  units: number;
  /** Appends one JSON line per run here. */
  out?: string;
}

export const USAGE =
  'pnpm poc:concurrency --target <origin> --auth access|bearer --runs <n> [--start <k>] [--concurrency 200] [--units 10] [--out <file.jsonl>]';

function wholeNumber(name: string, value: string | undefined, fallback?: number): number {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} <whole number> is required (${USAGE})`);
  }
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`--${name} must be a whole number of at least 1`);
  }
  return Number(value);
}

/** The command line (after `pnpm poc:concurrency`), checked. Throws with what is wrong. */
export function parseRunnerArgs(argv: readonly string[]): RunnerArgs {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      target: { type: 'string' },
      auth: { type: 'string' },
      runs: { type: 'string' },
      start: { type: 'string' },
      concurrency: { type: 'string' },
      units: { type: 'string' },
      out: { type: 'string' },
    },
  });

  let target: URL;
  try {
    target = new URL(values.target ?? '');
  } catch {
    throw new Error(`--target <origin> is required, e.g. https://dose-web-poc.<subdomain>.workers.dev (${USAGE})`);
  }
  if ((target.protocol !== 'https:' && target.protocol !== 'http:') || target.origin !== (values.target ?? '').replace(/\/$/, '')) {
    throw new Error('--target must be an http(s) origin: scheme, host and optional port, without a path');
  }
  const auth = values.auth;
  if (auth !== 'access' && auth !== 'bearer') throw new Error('--auth must be access (Cloudflare Access service token) or bearer (POC_TOKEN)');

  const concurrency = wholeNumber('concurrency', values.concurrency, 200);
  const units = wholeNumber('units', values.units, 10);
  if (units > concurrency) throw new Error('--units must not exceed --concurrency');
  const out = values.out;
  if (out === '') throw new Error('--out needs a file name');
  return {
    target: target.origin,
    auth,
    runs: wholeNumber('runs', values.runs),
    start: wholeNumber('start', values.start, 1),
    concurrency,
    units,
    ...(out === undefined ? {} : { out }),
  };
}

/** `name` from the environment; throws naming it (never a value) when it is missing or empty. */
export function requireVar(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

/**
 * `POC_OWNER_URL`, checked to be a postgres URL before any driver sees it. The error never includes
 * the value: it holds the owner password, and a URL parse error would carry it along as its input.
 */
export function ownerUrlFrom(env: Record<string, string | undefined>): string {
  const value = requireVar(env, 'POC_OWNER_URL');
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    protocol = '';
  }
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error('POC_OWNER_URL is not a valid postgres:// URL');
  }
  return value;
}

/** The session advisory lock (`pg_try_advisory_lock`) one invocation of the runner holds; any fixed number. */
export const RUNNER_LOCK_KEY = 1_909_201_019;

/** The headers that get a request past the target's front door. */
export function authHeaders(auth: AuthMode, env: Record<string, string | undefined>): Record<string, string> {
  if (auth === 'bearer') return { authorization: `Bearer ${requireVar(env, 'POC_TOKEN')}` };
  // Both are checked before either is used, so one run names every missing variable at once.
  const missing = ['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'].filter((name) => (env[name] ?? '') === '');
  if (missing.length > 0) throw new Error(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set`);
  return {
    'CF-Access-Client-Id': requireVar(env, 'CF_ACCESS_CLIENT_ID'),
    'CF-Access-Client-Secret': requireVar(env, 'CF_ACCESS_CLIENT_SECRET'),
  };
}

// ── Test identities ──────────────────────────────────────────────────────────────────────────

const PHONE_PREFIX = '+2010';
const PHONE_DIGITS = 8;
const PHONE_SPACE = 10 ** PHONE_DIGITS;

/** The `n`th test phone, `+2010` and eight digits: a valid Egyptian mobile in E.164. */
export function testPhone(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= PHONE_SPACE) throw new RangeError(`no test phone number ${String(n)}`);
  return `${PHONE_PREFIX}${String(n).padStart(PHONE_DIGITS, '0')}`;
}

/**
 * `count` test phones never used before: the ones after `lastUsed`, the highest `+2010…` phone
 * already in the database (null when there is none).
 */
export function nextPhones(lastUsed: string | null, count: number): string[] {
  const after = lastUsed === null ? -1 : Number(lastUsed.slice(PHONE_PREFIX.length));
  if (lastUsed !== null && (!lastUsed.startsWith(PHONE_PREFIX) || !Number.isInteger(after))) {
    throw new Error(`${lastUsed} is not a ${PHONE_PREFIX} test phone`);
  }
  if (after + count >= PHONE_SPACE) throw new RangeError(`the ${PHONE_PREFIX} test phones are used up`);
  return Array.from({ length: count }, (_, i) => testPhone(after + 1 + i));
}

/** A tag unique to one invocation of the runner, e.g. `20261021T081500Z-3f9a1c`. */
export function newRunTag(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
}

/** The first eight hex digits of every idempotency key of run `run` of the invocation `runTag`. */
export function runKeyPrefix(runTag: string, run: number): string {
  return createHash('sha256').update(`${runTag}:${String(run)}`).digest('hex').slice(0, 8);
}

/** A random (version 4) uuid whose first eight hex digits are `prefix`, so it stays a valid uuid. */
export function idempotencyKey(prefix: string): string {
  if (!/^[0-9a-f]{8}$/.test(prefix)) throw new Error('an idempotency key prefix is eight lower-case hex digits');
  return `${prefix}${randomUUID().slice(8)}`;
}

/** One checkout of one unit of `sku`, as the storefront's contract has it. */
export function checkoutBody(o: { sku: string; quotedTotal: number; key: string; phone: string; run: number; index: number }): CheckoutInput {
  return {
    idempotencyKey: o.key,
    lang: 'en',
    direction: 'd0-baseline',
    lines: [{ sku: o.sku, quantity: 1 }],
    quotedTotal: o.quotedTotal,
    customer: { name: `POC Test ${String(o.run)}-${String(o.index)}`, phone: o.phone },
    address: { governorate: GOVERNORATE, area: 'POC Test Area', street: 'POC Test Street', building: '1' },
  };
}

// ── Judging one run ──────────────────────────────────────────────────────────────────────────

/** Any answer that is neither a placed order nor an out-of-stock refusal: a status, or a network error / timeout (null). */
export interface OtherAnswer {
  status: number | null;
  message: string;
}

export interface RunTally {
  /** 201: an order was placed. */
  created: number;
  /** 409 with code `out_of_stock`. */
  outOfStock: number;
  other: OtherAnswer[];
}

const isJson = (contentType: string | null | undefined): boolean => contentType?.toLowerCase().includes('json') === true;

/**
 * One answer's body as a short line for a failure message. A body that is not JSON (an HTML login
 * or error page, say) is prefixed with its content type, e.g. `[text/html] <!doctype html>…`.
 */
export function bodySnippet(body: string, contentType?: string | null): string {
  const text = body.replace(/\s+/g, ' ').trim().slice(0, 200) || '(empty body)';
  return contentType === undefined || isJson(contentType) ? text : `[${contentType ?? 'no content-type'}] ${text}`;
}

/**
 * Sorts one checkout's answer into the tally: 201 (an order), 409 with a JSON body whose code is
 * `out_of_stock`, or anything else, a redirect (an Access login after a revoked token) included,
 * with its status, content type and the start of its body.
 */
export function classify(status: number, body: string, contentType?: string | null): 'created' | 'outOfStock' | OtherAnswer {
  if (status === 201) return 'created';
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  const code = typeof parsed === 'object' && parsed !== null && 'code' in parsed ? parsed.code : undefined;
  if (status === 409 && code === 'out_of_stock') return 'outOfStock';
  return { status, message: bodySnippet(body, contentType) };
}

export function tally(answers: readonly ('created' | 'outOfStock' | OtherAnswer)[]): RunTally {
  const result: RunTally = { created: 0, outOfStock: 0, other: [] };
  for (const answer of answers) {
    if (answer === 'created') result.created++;
    else if (answer === 'outOfStock') result.outOfStock++;
    else result.other.push(answer);
  }
  return result;
}

const describeOther = (o: OtherAnswer): string => `${o.status === null ? 'no response' : `status ${String(o.status)}`}: ${o.message}`;

/**
 * What is wrong with one run (empty: it passed): exactly `units` 201s, exactly the rest 409
 * `out_of_stock`, nothing else (each distinct other answer is named with how often it came),
 * exactly `units` orders in the database for the run's keys, and no broken rule.
 */
export function judgeRun(r: { units: number; concurrency: number; tally: RunTally; orders: number; violations: readonly Violation[] }): string[] {
  const failures: string[] = [];
  if (r.tally.created !== r.units) failures.push(`201=${String(r.tally.created)}, expected ${String(r.units)}`);
  const refused = r.concurrency - r.units;
  if (r.tally.outOfStock !== refused) failures.push(`409 out_of_stock=${String(r.tally.outOfStock)}, expected ${String(refused)}`);
  const counts = new Map<string, number>();
  for (const other of r.tally.other) counts.set(describeOther(other), (counts.get(describeOther(other)) ?? 0) + 1);
  for (const [text, count] of counts) failures.push(`${String(count)} x ${text}`);
  if (r.orders !== r.units) failures.push(`orders=${String(r.orders)} in the database, expected ${String(r.units)}`);
  for (const v of r.violations) failures.push(`rule ${String(v.rule)} broken: ${v.detail}`);
  return failures;
}

export interface RunResult {
  runTag: string;
  run: number;
  target: string;
  auth: AuthMode;
  concurrency: number;
  units: number;
  startedAt: string;
  ms: number;
  created: number;
  outOfStock: number;
  other: number;
  orders: number;
  rulesBroken: number;
  failures: string[];
  ok: boolean;
}

/** `run 3/100: 201=10 409=190 other=0 orders=10 rules=ok in 3.2 s` */
export function runLine(r: RunResult, last: number): string {
  const rules = r.rulesBroken === 0 ? 'ok' : `${String(r.rulesBroken)} broken`;
  return `run ${String(r.run)}/${String(last)}: 201=${String(r.created)} 409=${String(r.outOfStock)} other=${String(r.other)} orders=${String(r.orders)} rules=${rules} in ${(r.ms / 1000).toFixed(1)} s`;
}

export interface Summary {
  passed: number;
  failed: number;
  ms: number;
  slowest: RunResult | null;
  /** Each distinct failure, with the runs it happened in. */
  failures: { failure: string; runs: number[] }[];
}

export function summarise(results: readonly RunResult[], ms: number): Summary {
  const failures = new Map<string, number[]>();
  for (const r of results) for (const f of r.failures) failures.set(f, [...(failures.get(f) ?? []), r.run]);
  const slowest = results.reduce<RunResult | null>((max, r) => (max === null || r.ms > max.ms ? r : max), null);
  return {
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    ms,
    slowest,
    failures: [...failures].map(([failure, runs]) => ({ failure, runs })),
  };
}

function duration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${String(Math.floor(seconds / 60))} min ${String(Math.round(seconds % 60))} s`;
}

export function summaryLines(s: Summary): string[] {
  const lines = [
    `summary: ${String(s.passed + s.failed)} run(s), ${String(s.passed)} passed, ${String(s.failed)} failed, in ${duration(s.ms)}`,
  ];
  if (s.slowest !== null) lines.push(`slowest: run ${String(s.slowest.run)}, ${(s.slowest.ms / 1000).toFixed(1)} s`);
  if (s.failures.length > 0) {
    lines.push('failures:');
    for (const f of s.failures) lines.push(`  - ${f.failure} (run${f.runs.length > 1 ? 's' : ''} ${f.runs.join(', ')})`);
  }
  return lines;
}

// ── The database side (owner role) ───────────────────────────────────────────────────────────

const PLACEHOLDER = 'PLACEHOLDER —';

const POC_COPY = {
  nameEn: (what: string) => `${PLACEHOLDER} POC ${what}`,
  nameAr: (what: string) => `${PLACEHOLDER} إثبات المفهوم: ${what}`,
  storyEn: `${PLACEHOLDER} This product exists only for the Milestone 1 proof of concept, on the poc database. It is not for sale.`,
  storyAr: `${PLACEHOLDER} هذا المنتج موجود فقط لإثبات المفهوم في المرحلة الأولى، على قاعدة بيانات poc. ليس للبيع.`,
  labelEn: `${PLACEHOLDER} Proof of concept only.`,
  labelAr: `${PLACEHOLDER} لإثبات المفهوم فقط.`,
};

/** Upserts a published product with one active variant (matched by slug and SKU, as the seed does); returns the variant id. */
async function upsertPocProduct(tx: Tx, p: { slug: string; sku: string }, what: string): Promise<string> {
  const [product] = await tx.query<{ id: string }>(
    `insert into products (slug, status, name_ar, name_en, story_ar, story_en, label_copy_ar, label_copy_en)
     values ($1, 'published', $2, $3, $4, $5, $6, $7)
     on conflict (slug) do update set
       status = 'published', name_ar = excluded.name_ar, name_en = excluded.name_en,
       story_ar = excluded.story_ar, story_en = excluded.story_en,
       label_copy_ar = excluded.label_copy_ar, label_copy_en = excluded.label_copy_en
     returning id`,
    [p.slug, POC_COPY.nameAr(what), POC_COPY.nameEn(what), POC_COPY.storyAr, POC_COPY.storyEn, POC_COPY.labelAr, POC_COPY.labelEn],
  );
  if (product === undefined) throw new Error(`upserting product ${p.slug} returned no row`);
  const [variant] = await tx.query<{ id: string }>(
    `insert into variants (product_id, sku, kind, size_ml, price_piastres, status)
     values ($1, $2, 'full', 50, $3, 'active')
     on conflict (sku) do update set
       product_id = excluded.product_id, kind = 'full', size_ml = 50, price_piastres = excluded.price_piastres, status = 'active'
     returning id`,
    [product.id, p.sku, POC_PRICE],
  );
  if (variant === undefined) throw new Error(`upserting variant ${p.sku} returned no row`);
  return variant.id;
}

export interface PocSetup {
  concurrencyVariantId: string;
  /** Units received for `POC-LATENCY` now (0 when it already had enough). */
  latencyToppedUp: number;
}

/**
 * Refuses unless the database names itself `nonprod:poc`, then (idempotently) makes the two poc
 * products and tops `POC-LATENCY` up to at least `LATENCY_MIN_FREE` free units, under the source
 * key `poc-topup:<runTag>`. One transaction.
 */
export async function setupPoc(owner: Db, runTag: string): Promise<PocSetup> {
  const identity = await readEnvIdentity(owner);
  if (identity !== POC_IDENTITY) {
    throw new Error(`refusing to run: this database calls itself ${identity ?? '(nothing)'}, not ${POC_IDENTITY}`);
  }
  return owner.transaction(async (tx) => {
    const concurrencyVariantId = await upsertPocProduct(tx, CONCURRENCY_PRODUCT, 'concurrency');
    const latencyVariantId = await upsertPocProduct(tx, LATENCY_PRODUCT, 'latency');
    const { available } = await getStock(tx, latencyVariantId);
    const shortfall = LATENCY_MIN_FREE - available;
    if (shortfall > 0) {
      await receiveStock(tx, { variantId: latencyVariantId, quantity: shortfall, sourceKey: `poc-topup:${runTag}`, actor: ACTOR });
    }
    return { concurrencyVariantId, latencyToppedUp: Math.max(shortfall, 0) };
  });
}

/** Brings the variant's free stock (on hand minus reserved) to exactly `units`, with one ledger adjustment under `sourceKey`. */
export async function resetFreeStock(owner: Db, variantId: string, units: number, sourceKey: string): Promise<void> {
  await owner.transaction(async (tx) => {
    // Locks the row, so the free count cannot move between reading it and adjusting it.
    await tx.query(`select 1 from stock_levels where variant_id = $1 for update`, [variantId]);
    const { available } = await getStock(tx, variantId);
    const delta = units - available;
    if (delta !== 0) await adjustStock(tx, { variantId, delta, sourceKey, actor: ACTOR });
    const after = await getStock(tx, variantId);
    if (after.available !== units) throw new Error(`reset left ${String(after.available)} free units, not ${String(units)}`);
  });
}

async function lastTestPhone(owner: Tx): Promise<string | null> {
  const [row] = await owner.query<{ phone: string | null }>(
    `select max(phone_e164) as phone from customers where phone_e164 like $1`,
    [`${PHONE_PREFIX}%`],
  );
  return row?.phone ?? null;
}

async function deliveryFee(owner: Tx): Promise<number> {
  const [row] = await owner.query<{ fee_piastres: number }>(`select fee_piastres from governorate_delivery where governorate = $1`, [GOVERNORATE]);
  if (row === undefined) throw new Error(`no delivery fee for ${GOVERNORATE}`);
  return row.fee_piastres;
}

async function ordersFor(owner: Tx, keys: readonly string[]): Promise<number> {
  const [row] = await owner.query<{ n: number }>(`select count(*)::int as n from orders where checkout_key = any($1::uuid[])`, [keys]);
  return row?.n ?? 0;
}

// ── Running ──────────────────────────────────────────────────────────────────────────────────

export interface RunnerDeps {
  /** The owner role (`dose_owner`) on the poc branch. */
  owner: Db;
  /**
   * A second owner connection of its own (one session, `createRequestDb`), which holds the runner's
   * advisory lock for the whole invocation, so two invocations never run against one database at once.
   */
  lock: Db;
  fetch: typeof fetch;
  /** The target's front-door headers (`authHeaders`). */
  headers: Record<string, string>;
  log: (line: string) => void;
  /** Where `--out` lines go; defaults to appending to the file. */
  appendLine?: (file: string, line: string) => Promise<void>;
  /** For tests. */
  timeoutMs?: number;
  now?: () => Date;
}

/** A network error or timeout as one line, e.g. `TypeError: fetch failed (connect ECONNREFUSED …)`. */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
  return `${error.name}: ${error.message}${cause}`;
}

/** One request; network errors and timeouts become a null status with their message. */
/**
 * One request; network errors and timeouts become a null status with their message. Redirects are
 * not followed (`redirect: 'manual'`): a 3xx, such as Access sending a refused service token to its
 * login page, is an answer in its own right and is recorded as one.
 */
async function send(deps: RunnerDeps, url: string, init: RequestInit): Promise<{ status: number | null; contentType: string | null; body: string }> {
  try {
    const response = await deps.fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(deps.timeoutMs ?? CHECKOUT_TIMEOUT_MS) });
    return { status: response.status, contentType: response.headers.get('content-type'), body: await response.text() };
  } catch (error) {
    return { status: null, contentType: null, body: errorText(error) };
  }
}

/**
 * Today's total for one unit of `POC-CONCURRENCY` delivered to Cairo: its price from the target's
 * API, plus the fee. Anything but a 200 with the product as JSON is returned as the failure to record.
 */
async function quotedTotal(deps: RunnerDeps, target: string): Promise<number | string> {
  const what = `GET /api/products/${CONCURRENCY_PRODUCT.slug}`;
  const answer = await send(deps, `${target}/api/products/${CONCURRENCY_PRODUCT.slug}?lang=en`, { headers: deps.headers });
  if (answer.status === null) return `${what}: no response: ${answer.body}`;
  const snippet = bodySnippet(answer.body, answer.contentType);
  if (answer.status !== 200) return `${what}: status ${String(answer.status)}: ${snippet}`;
  let product: Partial<ProductView> | null;
  try {
    product = JSON.parse(answer.body) as Partial<ProductView> | null;
  } catch {
    product = null;
  }
  if (!isJson(answer.contentType) || product === null || !Array.isArray(product.variants)) {
    return `${what}: status 200 but not the product as JSON: ${bodySnippet(answer.body, answer.contentType)}`;
  }
  const variant = product.variants.find((v) => v.sku === CONCURRENCY_PRODUCT.sku);
  if (variant === undefined) return `${what}: no ${CONCURRENCY_PRODUCT.sku} variant`;
  return variant.price + (await deliveryFee(deps.owner));
}

/** One run: reset, fire every checkout at once, then count and check. */
export async function runOnce(args: RunnerArgs, deps: RunnerDeps, setup: PocSetup, runTag: string, run: number): Promise<RunResult> {
  const startedAt = (deps.now ?? (() => new Date()))();
  const began = performance.now();
  const base = {
    runTag,
    run,
    target: args.target,
    auth: args.auth,
    concurrency: args.concurrency,
    units: args.units,
    startedAt: startedAt.toISOString(),
  };

  await resetFreeStock(deps.owner, setup.concurrencyVariantId, args.units, `poc-reset:${runTag}:${String(run)}`);
  const total = await quotedTotal(deps, args.target);
  if (typeof total === 'string') {
    const failures = [total];
    return { ...base, ms: Math.round(performance.now() - began), created: 0, outOfStock: 0, other: 0, orders: 0, rulesBroken: 0, failures, ok: false };
  }

  const prefix = runKeyPrefix(runTag, run);
  const phones = nextPhones(await lastTestPhone(deps.owner), args.concurrency);
  const bodies = phones.map((phone, index) =>
    checkoutBody({ sku: CONCURRENCY_PRODUCT.sku, quotedTotal: total, key: idempotencyKey(prefix), phone, run, index }),
  );
  const headers = { ...deps.headers, 'content-type': 'application/json' };
  const answers = await Promise.all(
    bodies.map(async (body) => {
      const answer = await send(deps, `${args.target}/api/checkout`, { method: 'POST', headers, body: JSON.stringify(body) });
      return answer.status === null ? { status: null, message: answer.body } : classify(answer.status, answer.body, answer.contentType);
    }),
  );
  const counted = tally(answers);
  const orders = await ordersFor(deps.owner, bodies.map((b) => b.idempotencyKey));
  const violations = await checkRules(deps.owner);
  const failures = judgeRun({ units: args.units, concurrency: args.concurrency, tally: counted, orders, violations });
  return {
    ...base,
    ms: Math.round(performance.now() - began),
    created: counted.created,
    outOfStock: counted.outOfStock,
    other: counted.other.length,
    orders,
    rulesBroken: violations.length,
    failures,
    ok: failures.length === 0,
  };
}

/**
 * The whole proof: the runner lock (refused while another invocation holds it), setup, then runs
 * `start` to `start + runs - 1` one after another, a line per run (and a JSON line per run with
 * `--out`), then the summary. A failed run does not stop the rest; the summary says how many failed.
 */
export async function runConcurrencyProof(args: RunnerArgs, deps: RunnerDeps): Promise<Summary> {
  const [lock] = await deps.lock.query<{ held: boolean }>(`select pg_try_advisory_lock($1) as held`, [RUNNER_LOCK_KEY]);
  if (lock?.held !== true) {
    throw new Error(
      'refusing to run: another pnpm poc:concurrency is running against this database (it holds the runner lock); ' +
        'two at once would reset the same stock under each other. Wait for it to finish.',
    );
  }
  try {
    return await runLocked(args, deps);
  } finally {
    await deps.lock.query(`select pg_advisory_unlock($1)`, [RUNNER_LOCK_KEY]).catch(() => undefined);
  }
}

async function runLocked(args: RunnerArgs, deps: RunnerDeps): Promise<Summary> {
  const began = performance.now();
  const runTag = newRunTag((deps.now ?? (() => new Date()))());
  const setup = await setupPoc(deps.owner, runTag);
  deps.log(
    `poc:concurrency ${runTag}: ${args.target} (${args.auth}), ${String(args.runs)} run(s) of ${String(args.concurrency)} checkouts for ${String(args.units)} units` +
      (setup.latencyToppedUp > 0 ? `; ${LATENCY_PRODUCT.sku} topped up by ${String(setup.latencyToppedUp)}` : ''),
  );
  const append = deps.appendLine ?? ((file: string, line: string) => appendFile(file, line, 'utf8'));
  const last = args.start + args.runs - 1;
  const results: RunResult[] = [];
  for (let run = args.start; run <= last; run++) {
    const result = await runOnce(args, deps, setup, runTag, run);
    results.push(result);
    deps.log(runLine(result, last));
    for (const failure of result.failures) deps.log(`  ${failure}`);
    if (args.out !== undefined) await append(args.out, `${JSON.stringify(result)}\n`);
  }
  const summary = summarise(results, performance.now() - began);
  for (const line of summaryLines(summary)) deps.log(line);
  return summary;
}
