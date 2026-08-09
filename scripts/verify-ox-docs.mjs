#!/usr/bin/env node
/**
 * Verify every ox API symbol documented in fivem-kit actually exists in the installed
 * ox sources.
 *
 * A wrong signature in a documentation product is worse than a missing one: it sends the
 * reader (or the model) confidently in the wrong direction. ox ships fast, so this check
 * is meant to be re-run whenever the reference clones are updated.
 *
 * Usage:
 *   node scripts/verify-ox-docs.mjs [pathToOxResources]
 *
 * `pathToOxResources` is a directory containing ox_lib/, ox_core/, ox_target/ and
 * ox_inventory/ checkouts. Defaults to $OX_RESOURCES, else ../fivem-resources/ox.
 *
 * Exit codes: 0 = every documented symbol found, 1 = something is documented that does
 * not exist, 2 = sources not found (skipped).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const DOCS = path.join(REPO, 'skills', 'ox-stack', 'references');

const OX =
  process.argv[2] ||
  process.env.OX_RESOURCES ||
  path.resolve(REPO, '..', 'fivem-resources', 'ox');

/**
 * Symbols the extraction regexes pick up that are not APIs.
 * `lib.init` comes from the resource path in `lib.load('@ox_core.lib.init')`.
 */
const NOT_SYMBOLS = new Set(['init']);

const walk = (d, acc = []) => {
  let entries = [];
  try {
    entries = fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const x of entries) {
    const p = path.join(d, x.name);
    if (x.isDirectory()) {
      if (x.name !== 'node_modules' && x.name !== 'web') walk(p, acc);
    } else if (x.name.endsWith('.lua')) acc.push(p);
  }
  return acc;
};

const readAll = (dir) =>
  walk(dir)
    .map((f) => {
      try {
        return fs.readFileSync(f, 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');

const doc = (f) => {
  try {
    return fs.readFileSync(path.join(DOCS, f), 'utf8');
  } catch {
    return '';
  }
};

const uniq = (a) => [...new Set(a)].sort();
const grab = (text, re) => uniq([...text.matchAll(re)].map((m) => m[1]));
const clean = (list) => list.filter((s) => !NOT_SYMBOLS.has(s));

if (!fs.existsSync(OX)) {
  console.error(`ox sources not found at ${OX}`);
  console.error('Clone the ox resources, or pass the path: node scripts/verify-ox-docs.mjs <dir>');
  process.exit(2);
}

const version = (res) => {
  try {
    const m = fs
      .readFileSync(path.join(OX, res, 'fxmanifest.lua'), 'utf8')
      .match(/^version\s+'([^']+)'/m);
    return m ? m[1] : 'unknown';
  } catch {
    return 'absent';
  }
};

const libSrc = readAll(path.join(OX, 'ox_lib'));
const targets = [
  {
    name: 'ox_lib',
    version: version('ox_lib'),
    documented: clean([
      ...grab(doc('ox-lib.md'), /\blib\.([A-Za-z_]\w*)/g),
      ...grab(doc('patterns.md'), /\blib\.([A-Za-z_]\w*)/g),
    ]),
    actual: new Set([
      ...grab(libSrc, /function\s+lib\.([A-Za-z_]\w*)/g),
      ...grab(libSrc, /^\s*lib\.([A-Za-z_]\w*)\s*=/gm),
      ...(() => {
        try {
          return fs.readdirSync(path.join(OX, 'ox_lib', 'imports')).filter((d) => !d.startsWith('_'));
        } catch {
          return [];
        }
      })(),
    ]),
  },
  {
    name: 'ox_target',
    version: version('ox_target'),
    documented: grab(doc('ox-target.md'), /exports\.ox_target:([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAll(path.join(OX, 'ox_target')), /function\s+api\.([A-Za-z_]\w*)/g)),
  },
  {
    name: 'ox_inventory',
    version: version('ox_inventory'),
    documented: uniq([
      ...grab(doc('ox-inventory.md'), /exports\.ox_inventory:([A-Za-z_]\w*)/g),
      ...grab(doc('patterns.md'), /exports\.ox_inventory:([A-Za-z_]\w*)/g),
    ]),
    actual: new Set(grab(readAll(path.join(OX, 'ox_inventory')), /exports\(\s*'([A-Za-z_]\w*)'/g)),
  },
  {
    name: 'ox_core',
    version: version('ox_core'),
    documented: uniq([
      ...grab(doc('ox-core.md'), /\bOx\.([A-Za-z_]\w*)/g),
      ...grab(doc('patterns.md'), /\bOx\.([A-Za-z_]\w*)/g),
    ]),
    actual: new Set(grab(readAll(path.join(OX, 'ox_core')), /\bOx\.([A-Za-z_]\w*)/g)),
  },
];

console.log(`Verifying fivem-kit ox documentation against ${OX}\n`);

let failed = 0;
let checked = 0;

for (const t of targets) {
  if (t.actual.size === 0) {
    console.log(`${t.name.padEnd(13)} SKIPPED — no source found`);
    continue;
  }
  const missing = t.documented.filter((s) => !t.actual.has(s));
  const undocumented = [...t.actual].filter((s) => !t.documented.includes(s));
  checked += t.documented.length;
  failed += missing.length;

  const status = missing.length ? 'FAIL' : 'ok  ';
  console.log(
    `${status} ${t.name.padEnd(13)} v${t.version.padEnd(9)} ` +
      `${String(t.documented.length).padStart(3)} documented · ` +
      `${String(t.actual.size).padStart(3)} in source · ` +
      `${undocumented.length} not yet documented`
  );
  if (missing.length) {
    console.log(`     ⚠ documented but NOT FOUND in source: ${missing.join(', ')}`);
  }
}

console.log(`\n${checked} documented symbols checked, ${failed} not found in source.`);

if (failed) {
  console.error('\nDocumentation references APIs that do not exist. Fix the docs before shipping.');
  process.exit(1);
}
console.log('All documented ox APIs verified present.');
