import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { importSpecifiers, scanAstroFiles, violationsInSource } from '../../scripts/astro-imports.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const configPath = fileURLToPath(new URL('../../.dependency-cruiser.cjs', import.meta.url));
const require = createRequire(import.meta.url);
const { forbidden } = require(configPath) as { forbidden: Parameters<typeof violationsInSource>[2] };

const rulesFor = (file: string, source: string) =>
  violationsInSource(file, source, forbidden).map((v) => v.rule);

const frontmatter = (...imports: string[]) => `---\n${imports.join('\n')}\n---\n<h1>Hi</h1>\n`;

describe('importSpecifiers', () => {
  test('finds static, type-only, side-effect, re-export, dynamic and multi-line imports', () => {
    const source = [
      `---`,
      `import A from '@dose/a';`,
      `import type { B } from "@dose/b";`,
      `import { c,`,
      `  d } from '@dose/c';`,
      `import '@dose/side-effect';`,
      `export { e } from '@dose/e';`,
      `const f = await import('@dose/f');`,
      `---`,
      `<script>import g from '@dose/g';</script>`,
    ].join('\n');
    expect(importSpecifiers(source).sort()).toEqual(
      ['@dose/a', '@dose/b', '@dose/c', '@dose/e', '@dose/f', '@dose/g', '@dose/side-effect'].sort(),
    );
  });

  test('ignores text that is not an import', () => {
    expect(importSpecifiers(`---\nconst important = 'from';\n---\n<p>import maps</p>`)).toEqual([]);
  });
});

describe('.astro files in directions', () => {
  const file = 'directions/d0-baseline/src/Layout.astro';

  test.each([
    ['@dose/core', `import { checkout } from '@dose/core';`],
    ['@dose/api', `import { createApp } from '@dose/api';`],
    ['pg', `import pg from 'pg';`],
    ['a type-only commerce import', `import type { Cart } from '@dose/core';`],
    ['a relative path into commerce code', `import { x } from '../../../packages/core/src/money';`],
    ['an app', `import { x } from '../../../apps/web/src/env';`],
    ['a dynamic import', `const m = await import('@dose/core');`],
  ])('fails on %s', (_name, line) => {
    expect(rulesFor(file, frontmatter(line))).toContain('directions-only-contract-ui-shop');
  });

  test('fails on another direction by relative path', () => {
    expect(rulesFor(file, frontmatter(`import { x } from '../../x1-studio/src/index';`))).toEqual([
      'no-direction-imports-another-direction',
    ]);
  });

  test('allows contract, ui, shop, react, astro and its own files', () => {
    const source = frontmatter(
      `import type { Product } from '@dose/contract';`,
      `import { Button } from '@dose/ui';`,
      `import { Bag } from '@dose/shop';`,
      `import { useState } from 'react';`,
      `import { getCollection } from 'astro:content';`,
      `import Layout from './Layout.astro';`,
      `import tokens from '../tokens.css';`,
    );
    expect(rulesFor(file, source)).toEqual([]);
  });
});

describe('.astro files in the other constrained areas', () => {
  test('packages/ui and packages/shop may not import commerce code', () => {
    const bad = frontmatter(`import { checkout } from '@dose/core';`);
    expect(rulesFor('packages/ui/src/Card.astro', bad)).toEqual(['ui-shop-contract-admin-no-commerce']);
    expect(rulesFor('packages/shop/src/Bag.astro', bad)).toEqual(['ui-shop-contract-admin-no-commerce']);
  });

  test('apps/web is not constrained', () => {
    expect(rulesFor('apps/web/src/pages/index.astro', frontmatter(`import { x } from '@dose/core';`))).toEqual([]);
  });
});

describe('scanAstroFiles', () => {
  test('finds the violation in the fixture .astro file and nothing in the real tree', async () => {
    const fixture = await scanAstroFiles(['test/boundaries/fixtures'], forbidden, repoRoot);
    expect(fixture.map((v) => [v.file, v.specifier, v.rule])).toEqual([
      [
        'test/boundaries/fixtures/bad-direction/Page.astro',
        '@dose/core',
        'directions-only-contract-ui-shop',
      ],
    ]);

    expect(await scanAstroFiles(['packages', 'directions'], forbidden, repoRoot)).toEqual([]);
  });
});
