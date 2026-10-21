import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Hyperdrive } from '@cloudflare/workers-types';
import { describe, expect, test } from 'vitest';
import { apiFor, type WorkerEnv } from '../src/env';

// The checked-in wrangler.jsonc is what a deploy uses when nothing overrides it, so its defaults
// must fail closed: `local` accepts X-Dev-Staff-Email, so it is opted into per run (e2e passes
// `--var ENVIRONMENT:local`; a developer uses a git-ignored .dev.vars), never the default.
const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

/** wrangler.jsonc without its `//` comments (none of its strings holds an escaped quote). */
function parseJsonc(source: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (inString) {
      if (ch === '"') inString = false;
      out += ch;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
    } else {
      out += ch;
    }
  }
  return JSON.parse(out);
}

interface WorkerConfig {
  name?: string;
  account_id?: string;
  vars?: Record<string, string>;
  hyperdrive?: { binding: string; id: string; localConnectionString?: string }[];
  r2_buckets?: unknown[];
  placement?: Record<string, string>;
  triggers?: { crons: string[] };
  observability?: { enabled: boolean };
  preview_urls?: boolean;
  env?: Record<string, WorkerConfig>;
}

const config = parseJsonc(text) as WorkerConfig;

function topLevelVar(name: string): string {
  const value = config.vars?.[name];
  if (value === undefined) throw new Error(`wrangler.jsonc declares no top-level var ${name}`);
  return value;
}

test('the checked-in ENVIRONMENT is production, not local', () => {
  expect(topLevelVar('ENVIRONMENT')).toBe('production');
});

test('the checked-in vars refuse to start the API without Cloudflare Access', () => {
  const env: WorkerEnv = {
    HYPERDRIVE: {} as Hyperdrive,
    ENVIRONMENT: topLevelVar('ENVIRONMENT'),
    ACCESS_TEAM_DOMAIN: topLevelVar('ACCESS_TEAM_DOMAIN'),
    ACCESS_AUD: topLevelVar('ACCESS_AUD'),
  };
  expect(() => apiFor(env)).toThrow('ACCESS_TEAM_DOMAIN and ACCESS_AUD must be set outside local development');
});

const DOSE_ACCOUNT_ID = 'a61331a1643fa91a513c9cb775d7d619';
/**
 * SHA-256 of the other Cloudflare account on the same login, which belongs to another business
 * (decision 0008). Only its hash may be written here: the ID itself must appear nowhere.
 */
const OTHER_ACCOUNT_SHA256 = '02014597a955b8dcab8775302357b0b671dea8502ccc0c930896e2f00911f2c4';

describe('the Cloudflare account', () => {
  test("is DÖSE's", () => {
    expect(config.account_id).toBe(DOSE_ACCOUNT_ID);
    expect(Object.values(config.env ?? {}).map((e) => e.account_id)).toEqual([undefined, undefined]);
  });

  test('the other account ID appears in no file of the repository', () => {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter((f) => f !== '');
    const hits: string[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(`${root}/${file}`, 'latin1');
      } catch {
        continue; // listed by git but deleted in the working tree
      }
      for (const [token] of content.matchAll(/[0-9a-f]{32}/gi)) {
        if (createHash('sha256').update(token.toLowerCase()).digest('hex') === OTHER_ACCOUNT_SHA256) hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe.each(['staging', 'poc'])('the %s environment', (name) => {
  const env = config.env?.[name];

  test('exists, and takes its Worker name (dose-web-<env>) from wrangler', () => {
    expect(env).toBeDefined();
    expect(env?.name).toBeUndefined(); // wrangler names it dose-web-<env>
  });

  test('is ENVIRONMENT staging, with Access vars to be filled in', () => {
    expect(env?.vars).toEqual({ ENVIRONMENT: 'staging', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' });
  });

  test('has its own Hyperdrive binding, with no local connection string', () => {
    expect(env?.hyperdrive).toEqual([{ binding: 'HYPERDRIVE', id: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown }]);
    expect(env?.hyperdrive?.[0]?.id).not.toBe(config.hyperdrive?.[0]?.id);
  });

  test('has no R2 bucket (decision 0011)', () => {
    expect(env?.r2_buckets).toEqual([]);
  });

  test('is placed beside the database in Frankfurt (belief B1)', () => {
    expect(env?.placement).toEqual({ region: 'aws:eu-central-1' });
  });

  test('has observability on', () => {
    expect(env?.observability).toEqual({ enabled: true });
  });
});

test('the two environments use different Hyperdrive configs', () => {
  expect(config.env?.['staging']?.hyperdrive?.[0]?.id).not.toBe(config.env?.['poc']?.hyperdrive?.[0]?.id);
});

test('only staging runs the cron', () => {
  expect(config.env?.['staging']?.triggers).toEqual({ crons: ['*/5 * * * *'] });
  expect(config.env?.['poc']?.triggers).toEqual({ crons: [] });
});

test('only staging serves preview URLs (each pull request preview is a version of dose-web-staging)', () => {
  expect(config.env?.['staging']?.preview_urls).toBe(true);
  expect(config.env?.['poc']?.preview_urls).toBeUndefined();
  expect(config.preview_urls).toBeUndefined();
});

test('there is no production environment (no Worker is bound to production in Milestone 1)', () => {
  expect(Object.keys(config.env ?? {}).sort()).toEqual(['poc', 'staging']);
});
