import { readFileSync } from 'node:fs';
import type { Hyperdrive, R2Bucket } from '@cloudflare/workers-types';
import { expect, test } from 'vitest';
import { apiFor, type WorkerEnv } from '../src/env';

// The checked-in wrangler.jsonc is what a deploy uses when nothing overrides it, so its defaults
// must fail closed: `local` accepts X-Dev-Staff-Email, so it is opted into per run (e2e passes
// `--var ENVIRONMENT:local`; a developer uses a git-ignored .dev.vars), never the default.
const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

function checkedInVar(name: string): string {
  const match = new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(config);
  if (match?.[1] === undefined) throw new Error(`wrangler.jsonc declares no string var ${name}`);
  return match[1];
}

test('the checked-in ENVIRONMENT is production, not local', () => {
  expect(checkedInVar('ENVIRONMENT')).toBe('production');
});

test('the checked-in vars refuse to start the API without Cloudflare Access', () => {
  const env: WorkerEnv = {
    HYPERDRIVE: {} as Hyperdrive,
    MEDIA: {} as R2Bucket,
    ENVIRONMENT: checkedInVar('ENVIRONMENT'),
    ACCESS_TEAM_DOMAIN: checkedInVar('ACCESS_TEAM_DOMAIN'),
    ACCESS_AUD: checkedInVar('ACCESS_AUD'),
  };
  expect(() => apiFor(env)).toThrow('ACCESS_TEAM_DOMAIN and ACCESS_AUD must be set outside local development');
});
