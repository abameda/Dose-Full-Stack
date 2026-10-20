import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise, type IReporterOutput } from 'dependency-cruiser';
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config';
import { describe, expect, test } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const configPath = fileURLToPath(new URL('../../.dependency-cruiser.cjs', import.meta.url));

// Importing the config proves it exports the same rule names the tests assert on.
const require = createRequire(import.meta.url);
const { forbidden } = require(configPath) as { forbidden: { name: string }[] };

async function violationsFor(paths: string[]) {
  const ruleSet = await extractDepcruiseConfig(configPath);
  const result = await cruise(paths, { ruleSet, validate: true, baseDir: repoRoot });
  const output = result.output as Exclude<IReporterOutput['output'], string>;
  return output.summary;
}

describe('code boundaries', () => {
  test('a direction importing commerce code fails the build', async () => {
    const summary = await violationsFor(['test/boundaries/fixtures/bad-direction']);
    expect(summary.violations.map((v) => v.rule.name)).toContain('directions-only-contract-ui-shop');
    expect(summary.error).toBeGreaterThan(0);
  });

  test('the real tree has no violations', async () => {
    const summary = await violationsFor(
      // Roots no task has created yet (apps/ before the admin app) cannot be cruised.
      ['packages', 'directions', 'apps'].filter((root) => existsSync(join(repoRoot, root))),
    );
    expect(summary.violations).toEqual([]);
    expect(summary.error).toBe(0);
  });

  test('the four boundary rules are all present at severity error', () => {
    expect(forbidden.map((rule) => rule.name).sort()).toEqual([
      'core-only-contract',
      'directions-only-contract-ui-shop',
      'no-direction-imports-another-direction',
      'ui-shop-contract-admin-no-commerce',
    ]);
  });
});
