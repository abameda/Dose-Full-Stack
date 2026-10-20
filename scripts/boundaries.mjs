// `pnpm boundaries`: checks the import rules in .dependency-cruiser.cjs over the real tree.
// dependency-cruiser fails on a root that does not exist, so roots that no task has created
// yet (such as apps/ before the admin app) are skipped instead of needing a placeholder.
//
// dependency-cruiser cannot read `.astro` files, so a second pass (scripts/astro-imports.mjs)
// scans their import specifiers against the same rules.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { cruise, format } from 'dependency-cruiser';
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config';
import { scanAstroFiles } from './astro-imports.mjs';

const roots = ['packages', 'directions', 'apps'].filter((root) => existsSync(root));
const ruleSet = await extractDepcruiseConfig('./.dependency-cruiser.cjs');
const result = await cruise(roots, { ruleSet, validate: true });
const report = await format(result.output, { outputType: 'err' });

const { forbidden } = createRequire(import.meta.url)('../.dependency-cruiser.cjs');
const astroViolations = await scanAstroFiles(roots, forbidden, process.cwd());

process.stdout.write(report.output);
for (const { file, specifier, rule } of astroViolations) {
  process.stdout.write(`error ${rule}: ${file} imports ${specifier}\n`);
}
process.exit(result.output.summary.error > 0 || astroViolations.length > 0 ? 1 : 0);
