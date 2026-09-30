import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packagesDirectory = new URL('../packages/', import.meta.url);
let checked = 0;

// Exercise package resolution through workspace links, including both module
// formats and every public subpath. Builds must run before this check.
for (const directory of await readdir(packagesDirectory, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;

  const packageDirectory = new URL(`${directory.name}/`, packagesDirectory);
  const manifest = JSON.parse(await readFile(new URL('package.json', packageDirectory), 'utf8'));

  for (const [subpath, targets] of Object.entries(manifest.exports)) {
    const specifier = manifest.name + (subpath === '.' ? '' : subpath.slice(1));
    const esm = await import(specifier);
    const cjs = require(specifier);

    assert.ok(Object.keys(esm).length > 0, `${specifier} has no ESM exports`);
    assert.deepEqual(
      Object.keys(cjs).sort(),
      Object.keys(esm).sort(),
      `${specifier} has different CommonJS and ESM exports`,
    );
    await access(new URL(targets.types, packageDirectory));
    console.log(`Checked ${specifier}: ESM, CommonJS, declarations`);
    checked += 1;
  }
}

assert.ok(checked > 0, 'No package exports were checked');
console.log(`Checked ${checked} public package entry points.`);
