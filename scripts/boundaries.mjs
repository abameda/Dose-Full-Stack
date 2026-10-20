// `pnpm boundaries`: checks the import rules in .dependency-cruiser.cjs over the real tree.
// dependency-cruiser fails on a root that does not exist, so roots that no task has created
// yet (such as apps/ before the admin app) are skipped instead of needing a placeholder.
import { existsSync } from 'node:fs';
import process from 'node:process';
import { cruise, format } from 'dependency-cruiser';
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config';

const roots = ['packages', 'directions', 'apps'].filter((root) => existsSync(root));
const ruleSet = await extractDepcruiseConfig('./.dependency-cruiser.cjs');
const result = await cruise(roots, { ruleSet, validate: true });
const report = await format(result.output, { outputType: 'err' });

process.stdout.write(report.output);
process.exit(result.output.summary.error > 0 ? 1 : 0);
