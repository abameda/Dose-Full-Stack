// dependency-cruiser cannot read `.astro` files (its supported extensions are ts, tsx, cts,
// mts, js, vue, svelte and a few others), so imports inside Astro frontmatter and <script>
// blocks would escape the boundary rules. This module closes that gap with a text scan:
// it pulls every import specifier out of each `.astro` file and judges it with the very
// same `forbidden` rules as .dependency-cruiser.cjs, so there is one list of rules.
//
// It is deliberately conservative: it scans the whole file text, so an import-looking line
// inside a comment or a code sample is reported too. Move it, or reword it.
import { readdir, readFile } from 'node:fs/promises';
import { posix } from 'node:path';

const ALWAYS_SKIPPED = /(^|\/)(node_modules|dist|[.]wrangler)(\/|$)/;

// Each pattern captures the module specifier in group 1. The clause between `import` and
// `from` may span lines but never crosses a quote or semicolon, which keeps matching linear.
const IMPORT_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

/** @param {string} source */
export function importSpecifiers(source) {
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found];
}

/** Repo-relative target of an import: relative paths are resolved, bare specifiers kept. */
function targetOf(file, specifier) {
  return specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), specifier)) : specifier;
}

const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

function assertSupported(rule) {
  for (const side of ['from', 'to']) {
    for (const key of Object.keys(rule[side] ?? {})) {
      if (key !== 'path' && key !== 'pathNot') {
        throw new Error(`Rule ${rule.name}: "${side}.${key}" is not supported by the .astro import scan.`);
      }
    }
  }
}

/** The capture groups of the first `from.path` pattern that matches, or undefined. */
function fromMatch(rule, file) {
  for (const pattern of asList(rule.from?.path)) {
    const match = new RegExp(pattern).exec(file);
    if (match) return match;
  }
  return undefined;
}

function toMatches(rule, target, groups) {
  const withGroups = (pattern) =>
    pattern.replace(/\$(\d)/g, (_whole, n) => escapeRegExp(groups[Number(n)] ?? ''));
  const inPath = asList(rule.to?.path);
  const outPath = asList(rule.to?.pathNot);
  const included = inPath.length === 0 || inPath.some((p) => new RegExp(withGroups(p)).test(target));
  const excluded = outPath.some((p) => new RegExp(withGroups(p)).test(target));
  return included && !excluded;
}

/**
 * Judge one `.astro` file against the rules.
 * @param {string} file repo-relative path with forward slashes
 * @param {string} source file text
 * @param {{ name: string, from?: object, to?: object }[]} forbidden rules from .dependency-cruiser.cjs
 */
export function violationsInSource(file, source, forbidden) {
  const violations = [];
  for (const rule of forbidden) {
    assertSupported(rule);
    const match = fromMatch(rule, file);
    if (!match) continue;
    for (const specifier of importSpecifiers(source)) {
      if (toMatches(rule, targetOf(file, specifier), match)) {
        violations.push({ file, specifier, rule: rule.name });
      }
    }
  }
  return violations;
}

async function astroFilesUnder(baseDir, root) {
  const dir = posix.join(baseDir, root);
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  // Files only: Astro generates a `.astro/` directory (types) next to every app.
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => posix.join(root, posix.relative(dir, posix.join(entry.parentPath.replaceAll('\\', '/'), entry.name))))
    .filter((file) => file.endsWith('.astro') && !ALWAYS_SKIPPED.test(file))
    .sort();
}

/**
 * Scan every `.astro` file under the given roots.
 * @param {string[]} roots repo-relative directories that exist
 * @param {{ name: string, from?: object, to?: object }[]} forbidden
 * @param {string} baseDir absolute repo root (forward or back slashes)
 */
export async function scanAstroFiles(roots, forbidden, baseDir) {
  const base = baseDir.replaceAll('\\', '/');
  const violations = [];
  for (const root of roots) {
    for (const file of await astroFilesUnder(base, root)) {
      const source = await readFile(posix.join(base, file), 'utf8');
      violations.push(...violationsInSource(file, source, forbidden));
    }
  }
  return violations;
}
