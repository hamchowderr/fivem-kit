#!/usr/bin/env node
/**
 * Verify that every API symbol fivem-kit documents actually exists in the real source —
 * across the ox stack, es_extended and qb-core.
 *
 * A wrong signature in a documentation product is worse than a missing one: it sends the
 * reader (or the model) confidently in the wrong direction. ox ships fast, so this check
 * is meant to be re-run whenever the reference clones are updated.
 *
 * Usage:
 *   node scripts/verify-docs.mjs [pathToOxResources] [--strict]
 *
 * `pathToOxResources` is a directory containing ox_lib/, ox_core/, ox_target/ and
 * ox_inventory/ checkouts. Defaults to $OX_RESOURCES, else ../fivem-resources/ox.
 *
 * `--strict` requires every resource to be present. CI uses it, because a resource that
 * silently has no source there means its docs went unverified while the build stayed green.
 *
 * Exit codes:
 *   0  every documented symbol was found, and at least one actually got checked
 *   1  a documented API does not exist, OR nothing could be verified at all
 *   2  the sources directory itself is missing
 *
 * Note that every non-zero exit is fatal to a CI step — there is deliberately no "skipped
 * so we passed" path. Verifying nothing is reported as failure, not success.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const DOCS = path.join(REPO, 'skills', 'ox-stack', 'references');

const ARGS = process.argv.slice(2);
const STRICT = ARGS.includes('--strict');
const OX =
  ARGS.find((a) => !a.startsWith('--')) ||
  process.env.OX_RESOURCES ||
  path.resolve(REPO, '..', 'fivem-resources', 'ox');

/**
 * Framework sources, for the ESX and QBCore references.
 *
 * Optional: a checkout that only has the ox resources still verifies those, and the framework
 * targets report NONE rather than failing the whole run — unless --strict, where a missing
 * source is a clone problem worth failing on.
 */
const FRAMEWORKS =
  process.env.FRAMEWORK_RESOURCES || path.resolve(REPO, '..', 'fivem-resources', 'frameworks');

const FW_DOCS = path.join(REPO, 'skills', 'fivem-frameworks', 'references');
const fwDoc = (f) => {
  try {
    return fs.readFileSync(path.join(FW_DOCS, f), 'utf8');
  } catch {
    return '';
  }
};

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

/** Same, for TypeScript sources. ox_banking is written in TS, not Lua. */
const walkTs = (d, acc = []) => {
  let entries = [];
  try {
    entries = fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const x of entries) {
    const p = path.join(d, x.name);
    if (x.isDirectory()) {
      if (x.name !== 'node_modules') walkTs(p, acc);
    } else if (/\.(ts|tsx|js)$/.test(x.name)) acc.push(p);
  }
  return acc;
};

const readAllTs = (dir) =>
  walkTs(dir)
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
  console.error('Clone the ox resources, or pass the path: node scripts/verify-docs.mjs <dir>');
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
  {
    name: 'ox_doorlock',
    version: version('ox_doorlock'),
    documented: grab(doc('ox-doorlock.md'), /exports\.ox_doorlock:([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAll(path.join(OX, 'ox_doorlock')), /exports\(\s*'([A-Za-z_]\w*)'/g)),
  },
  {
    name: 'ox_fuel',
    version: version('ox_fuel'),
    documented: grab(doc('ox-fuel.md'), /exports\.ox_fuel:([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAll(path.join(OX, 'ox_fuel')), /exports\(\s*'([A-Za-z_]\w*)'/g)),
  },
  {
    // ox_banking is TypeScript, so the .lua-only walk finds nothing — read its source
    // directly. Without this the resource would report zero symbols and be "skipped",
    // which under --strict is a failure rather than a silent pass.
    name: 'ox_banking',
    version: version('ox_banking'),
    documented: grab(doc('ox-banking.md'), /exports\.ox_banking:([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAllTs(path.join(OX, 'ox_banking', 'src')), /exports\(\s*'([A-Za-z_]\w*)'/g)),
  },
];

/* ------------------------------------------------------- frameworks ------- */

// es_extended lives under a bracketed directory, which is a glob character in most tools —
// resolve it as a plain path rather than matching it.
const ESX_SRC = path.join(FRAMEWORKS, 'esx_core', '[core]', 'es_extended');
const esxSrc = readAll(ESX_SRC);
const qbSrc = readAll(path.join(FRAMEWORKS, 'qb-core'));

if (fs.existsSync(ESX_SRC)) {
  targets.push({
    name: 'es_extended',
    version: 'framework',
    // xPlayer methods are documented as `xPlayer.method(`. es_extended defines them BOTH
    // ways — `self.method = function` and `function self.method(` — so both are collected
    // separately rather than as one alternation, since `grab` only reads capture group 1.
    documented: grab(fwDoc('esx.md'), /\bxPlayer\.([A-Za-z_]\w*)\s*\(/g),
    actual: new Set([
      ...grab(esxSrc, /\bself\.([A-Za-z_]\w*)\s*=\s*function/g),
      ...grab(esxSrc, /\bfunction\s+self\.([A-Za-z_]\w*)/g),
    ]),
  });
  targets.push({
    name: 'ESX.*',
    version: 'framework',
    documented: grab(fwDoc('esx.md'), /\bESX\.([A-Za-z_]\w*)\s*\(/g),
    actual: new Set([
      ...grab(esxSrc, /^function ESX\.([A-Za-z_]\w*)/gm),
      ...grab(esxSrc, /\bESX\.([A-Za-z_]\w*)\s*=/g),
    ]),
  });
}

if (fs.existsSync(path.join(FRAMEWORKS, 'qb-core'))) {
  targets.push({
    name: 'QBCore.Functions',
    version: 'framework',
    documented: grab(fwDoc('qbcore.md'), /\bQBCore\.Functions\.([A-Za-z_]\w*)/g),
    actual: new Set(grab(qbSrc, /function QBCore\.Functions\.([A-Za-z_]\w*)/g)),
  });
  // Player methods are defined on a class with a colon — `function Player:AddMoney(...)` —
  // and a `.Functions` table is built from two name lists as a compatibility shim. Both the
  // colon form and the dot form are documented, so both are collected here. Reading only the
  // old `self.Functions.X =` pattern reported 1 method against upstream, which is what caught
  // that the local checkout was seven months stale.
  targets.push({
    name: 'Player methods',
    version: 'framework',
    documented: uniq([
      ...grab(fwDoc('qbcore.md'), /\bPlayer:([A-Za-z_]\w*)\s*\(/g),
      ...grab(fwDoc('qbcore.md'), /\bPlayer\.Functions\.([A-Za-z_]\w*)/g),
    ]),
    actual: new Set([
      ...grab(qbSrc, /\bfunction\s+Player:([A-Za-z_]\w*)/g),
      ...grab(qbSrc, /\bfunction\s+self\.Functions\.([A-Za-z_]\w*)/g),
      // the varargMethods / noargMethods shim lists
      ...grab(qbSrc, /'([A-Za-z_]\w*)'/g).filter((n) => /^(Get|Set|Add|Remove|Has|Save|Logout|Notify|Update)/.test(n)),
    ]),
  });
}

console.log(`Verifying fivem-kit documentation against ox sources at ${OX}\n`);

let failed = 0;
let checked = 0;
const skipped = [];
const undocumentedResources = [];

for (const t of targets) {
  if (t.actual.size === 0) {
    console.log(`${t.name.padEnd(13)} SKIPPED — no source found`);
    skipped.push(t.name);
    continue;
  }
  const missing = t.documented.filter((s) => !t.actual.has(s));
  const undocumented = [...t.actual].filter((s) => !t.documented.includes(s));
  checked += t.documented.length;
  failed += missing.length;

  // Source is present but we document nothing from it. Reporting that as "ok" is how a
  // renamed or deleted reference file disappears silently — it was caught exactly that way
  // when ox-extras.md was split into one file per resource.
  if (t.documented.length === 0) {
    undocumentedResources.push(t.name);
    console.log(
      `${'NONE'} ${t.name.padEnd(13)} v${t.version.padEnd(9)}   0 documented · ` +
        `${String(t.actual.size).padStart(3)} in source — no reference file, or it stopped matching`
    );
    continue;
  }

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

/**
 * Verifying nothing is not success.
 *
 * A clone that produced empty directories used to end here printing "All documented ox APIs
 * verified present" after checking zero symbols, and exiting 0. In CI that is a green tick on
 * a check that never ran — strictly worse than a red one, because nobody investigates green.
 */
if (checked === 0) {
  console.error(
    `\nVerified NOTHING — no ox source was readable under ${OX}.\n` +
      'Expected checkouts of ox_lib, ox_core, ox_target and ox_inventory there.\n' +
      'A pass with zero symbols checked would be a false green, so this is a failure.'
  );
  process.exit(1);
}

// `--strict` (used by CI) additionally requires EVERY resource to be present. Locally a
// partial set is useful; in a pipeline a silently missing resource means the docs for it
// went unverified while the build stayed green.
if (STRICT && skipped.length) {
  console.error(
    `\n${skipped.length} resource(s) had no source and went unverified: ${skipped.join(', ')}.\n` +
      'Running with --strict, so this is a failure. Check the clone step.'
  );
  process.exit(1);
}

if (STRICT && undocumentedResources.length) {
  console.error(
    `\n${undocumentedResources.length} resource(s) have source but zero documented symbols: ` +
      `${undocumentedResources.join(', ')}.\n` +
      'Either the reference file is missing, or it was renamed and this script still points at\n' +
      'the old name. Running with --strict, so this is a failure rather than a quiet zero.'
  );
  process.exit(1);
}

console.log(
  `All documented APIs verified present${skipped.length ? ` (${skipped.length} resource(s) skipped)` : ''}.`
);
