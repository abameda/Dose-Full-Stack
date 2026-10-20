import { describe, expect, it } from 'vitest';
import { checkSeedTarget } from './target';

const LOCAL = 'postgres://dose_owner:dose_owner_local@127.0.0.1:54329/dose_e2e';
const REMOTE = 'postgres://dose_owner:secret@ep-staging-123.eu-central-1.aws.neon.tech/dose';

describe('checkSeedTarget', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('treats %s as local', (host) => {
    expect(checkSeedTarget(`postgres://u:p@${host}:5432/dose`, { allowRemote: false, fresh: false })).toEqual({ local: true });
  });

  it('allows --fresh on a local target', () => {
    expect(checkSeedTarget(LOCAL, { allowRemote: false, fresh: true })).toEqual({ local: true });
  });

  it('refuses a non-local target without --allow-remote', () => {
    expect(() => checkSeedTarget(REMOTE, { allowRemote: false, fresh: false })).toThrow(/--allow-remote/);
  });

  it('seeds a non-local target only with --allow-remote, and never as local', () => {
    expect(checkSeedTarget(REMOTE, { allowRemote: true, fresh: false })).toEqual({ local: false });
  });

  it('refuses --fresh on a non-local target, even with --allow-remote', () => {
    expect(() => checkSeedTarget(REMOTE, { allowRemote: true, fresh: true })).toThrow(/--fresh/);
  });

  it('does not take a local-looking name for a local host', () => {
    const lookalike = 'postgres://u:p@localhost.example.com:5432/dose';
    expect(() => checkSeedTarget(lookalike, { allowRemote: false, fresh: false })).toThrow(/--allow-remote/);
  });
});

describe('checkSeedTarget with a bad URL', () => {
  it('refuses it without repeating it (the URL holds the password)', () => {
    expect(() => checkSeedTarget('not a url with-secret', { allowRemote: true, fresh: false })).toThrow('--target is not a valid database URL');
  });
});
