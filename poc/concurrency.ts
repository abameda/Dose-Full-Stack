// `pnpm poc:concurrency --target <origin> --auth access|bearer --runs <n> [--start <k>] [--concurrency 200] [--units 10] [--out <file.jsonl>]`
//
// The concurrency proof of Milestone 1, Task 19 (belief B4), against the poc Worker or the Node
// container. Per run: `POC-CONCURRENCY` is reset to exactly `--units` free units through the owner
// connection, `--concurrency` checkouts are fired at once, and the run passes only with exactly
// `--units` 201s, every other answer a 409 `out_of_stock`, that many orders in the database and no
// broken rule. Prints a line per run and a summary; exits 1 when any run failed (runner.ts).
//   --target       the target's origin, e.g. https://dose-web-poc.<subdomain>.workers.dev
//   --auth         access: the Cloudflare Access service token (the Worker); bearer: POC_TOKEN (the container)
//   --runs         how many runs; --start numbers the first (default 1), so a proof split across
//                  days (the Worker's Hyperdrive allows 100,000 queries a day) keeps one numbering
//   --concurrency  checkouts per run (default 200); --units: free units per run (default 10)
//   --out          appends one JSON line per run to this file (relative to where pnpm was run)
// Environment (never printed): POC_OWNER_URL, the owner role (`dose_owner`) on the poc branch; for
// --auth access CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET; for --auth bearer POC_TOKEN.
// It refuses to start unless the database's env_identity is `nonprod:poc`, and while another
// invocation runs against the same database (a Postgres advisory lock). Never measure latency on
// /poc/latency while it runs.
import path from 'node:path';
import process from 'node:process';
import { createPoolDb, createRequestDb } from '@dose/core/db';
import { authHeaders, ownerUrlFrom, parseRunnerArgs, runConcurrencyProof } from './runner';

const args = parseRunnerArgs(process.argv.slice(2));
// Every variable is checked before anything connects; a malformed owner URL never reaches the
// driver, whose parse error would carry the URL (and its password) into the terminal.
const ownerUrl = ownerUrlFrom(process.env);
const headers = authHeaders(args.auth, process.env);
// `pnpm poc:concurrency` runs this in poc/; a relative --out means where the command was typed.
const out = args.out === undefined ? undefined : path.resolve(process.env['INIT_CWD'] ?? process.cwd(), args.out);

const owner = createPoolDb(ownerUrl, { max: 2 });
// One session of its own for the runner lock, held until the end.
const lock = createRequestDb(ownerUrl);
try {
  const summary = await runConcurrencyProof(
    { ...args, ...(out === undefined ? {} : { out }) },
    { owner, lock, fetch: (input, init) => fetch(input, init), headers, log: (line) => { console.log(line); } },
  );
  process.exitCode = summary.failed > 0 ? 1 : 0;
} finally {
  await Promise.all([owner.close(), lock.close()]);
}
