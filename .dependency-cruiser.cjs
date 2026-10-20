/**
 * Code boundaries for DÖSE. Every rule has severity `error`, so `pnpm boundaries`
 * (part of `pnpm check`) fails the build on any violation.
 *
 * Imports are matched in three spellings so a rule cannot be dodged:
 * - the resolved workspace path (`packages/core/src/money.ts`),
 * - the pnpm link in node_modules (`node_modules/@dose/core/...`),
 * - the bare specifier when it cannot be resolved (`@dose/core`).
 *
 * `test/boundaries/fixtures/bad-direction` is treated as a direction by rule 1 so the
 * test can prove the rule fires. `pnpm boundaries` scans packages, directions and apps
 * only, so the fixture never reaches the real build.
 *
 * dependency-cruiser cannot read .astro files, so scripts/astro-imports.mjs scans their import
 * specifiers against these same rules (only `path` and `pathNot` on `from`/`to` are supported
 * there; scripts/astro-imports.mjs throws on any other key, so a new rule cannot silently skip it).
 */

const nm = '(^|/)node_modules/';
const dose = (names) => [
  `^packages/(${names})/`,
  `${nm}@dose/(${names})(/|$)`,
  `^@dose/(${names})(/|$)`,
];
const external = (names) => [`${nm}(${names})(/|$)`, `^(${names})(/|:|$)`];

const DIRECTION_FIXTURE = '^test/boundaries/fixtures/bad-direction/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'directions-only-contract-ui-shop',
      comment:
        'A direction may import only @dose/contract, @dose/ui, @dose/shop, react, astro and its own files.',
      severity: 'error',
      from: { path: ['^directions/', DIRECTION_FIXTURE] },
      to: {
        pathNot: [
          '^directions/',
          DIRECTION_FIXTURE,
          ...dose('contract|ui|shop'),
          ...external('react|astro'),
        ],
      },
    },
    {
      name: 'ui-shop-contract-admin-no-commerce',
      comment:
        'packages/ui, packages/shop, packages/contract and apps/admin never import @dose/core, @dose/api or pg.',
      severity: 'error',
      from: { path: '^(packages/(ui|shop|contract)|apps/admin)/' },
      to: { path: [...dose('core|api'), ...external('pg')] },
    },
    {
      name: 'core-only-contract',
      comment:
        'packages/core never imports hono, astro, react, or any @dose/* package except @dose/contract.',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: {
        path: [
          ...external('hono|astro|react'),
          '^packages/(?!core/|contract/)',
          '^(directions|apps)/',
          `${nm}@dose/(?!contract(/|$))`,
          '^@dose/(?!contract(/|$))',
        ],
      },
    },
    {
      name: 'no-direction-imports-another-direction',
      comment: 'A direction never imports another direction.',
      severity: 'error',
      from: { path: '^directions/([^/]+)/' },
      to: { path: '^directions/[^/]+/', pathNot: '^directions/$1/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Count `import type` too: a type-only import of commerce code is still a leak.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    exclude: { path: '(^|/)(node_modules|dist|[.]wrangler)/' },
  },
};
