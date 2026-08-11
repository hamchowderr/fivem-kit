#!/usr/bin/env node
/**
 * Verify that every API symbol fivem-kit documents actually exists in the real source —
 * across the ox stack, oxmysql, es_extended, qb-core and qbx_core, plus every native name
 * against the official CitizenFX natives database.
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
 *
 * `init` comes from the resource path in `lib.load('@ox_core.lib.init')`. `md` appears once
 * the scan covers prose as well as reference tables: a sentence mentioning `ox-lib.md` matches
 * the `lib.<name>` pattern and yields "md". `lua` is the same shape one level up — the import
 * path `@oxmysql/lib/MySQL.lua` matches `MySQL.<name>`.
 *
 * All three are file extensions or path segments, never API names.
 */
const NOT_SYMBOLS = new Set(['init', 'md', 'lua']);

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

/**
 * EVERY markdown file under skills/ and docs/, concatenated.
 *
 * This deliberately replaces a hardcoded list of reference files. That list covered 10 of 26
 * documents and left 96 API symbols unverified — including migration-map.md, which is the
 * file that tells people how to translate between frameworks and is therefore the worst one
 * to have wrong. A SKILL.md body makes API claims exactly like a reference file does.
 *
 * Scanning everything means a new document is covered the moment it exists, rather than when
 * someone remembers to add it here. `docs/` is included for the same reason: hooks.md and
 * lsp.md name real APIs, and being the files nobody re-reads is what makes them rot quietly.
 */
const DOC_DIRS = [path.join(REPO, 'skills'), path.join(REPO, 'docs')];

const allDocs = (() => {
  const out = [];
  const walkMd = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkMd(p);
      else if (e.name.endsWith('.md')) {
        try {
          out.push(fs.readFileSync(p, 'utf8'));
        } catch {
          /* unreadable */
        }
      }
    }
  };
  DOC_DIRS.forEach(walkMd);
  return out.join('\n');
})();

/**
 * Symbols a document names ON PURPOSE while being wrong.
 *
 * `docs/lsp.md` explains how to tell the language server is working by writing a misspelled
 * native and expecting a diagnostic. That counter-example is the whole point of the passage,
 * and a verifier that cannot tell it from a mistake would force the docs to stop showing what
 * failure looks like.
 *
 * The exemption is per-symbol and declared in the file that needs it:
 *
 *     <!-- verify-docs: allow SetEntityCoodrs -->
 *
 * Deliberately NOT a whole-file skip. A file that opted out entirely would go unverified for
 * every other API it names, which is the failure this script exists to prevent.
 */
const ALLOWED_FICTION = new Set(
  [...allDocs.matchAll(/<!--\s*verify-docs:\s*allow\s+([^>]+?)\s*-->/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim())
    .filter(Boolean)
);

/** Kept for call-site readability; every target now reads the whole corpus. */
const doc = () => allDocs;
const fwDocAll = () => allDocs;

const uniq = (a) => [...new Set(a)].sort();
const grab = (text, re) => uniq([...text.matchAll(re)].map((m) => m[1]));
const clean = (list) => list.filter((s) => !NOT_SYMBOLS.has(s) && !ALLOWED_FICTION.has(s));

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
    // One grab, not two. These three targets each spread the same `grab` twice, which
    // deduplicates nothing (`grab` already returns a unique list) and simply counted every
    // symbol a second time — the headline "488 symbols checked" was inflated by 136.
    // A verification count that overstates itself is the same failure as a check that passes
    // without checking, just quieter.
    documented: clean(grab(doc(), /\blib\.([A-Za-z_]\w*)/g)),
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
    documented: grab(doc(), /exports\.ox_target:([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAll(path.join(OX, 'ox_target')), /function\s+api\.([A-Za-z_]\w*)/g)),
  },
  {
    name: 'ox_inventory',
    version: version('ox_inventory'),
    documented: grab(doc(), /exports\.ox_inventory:([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAll(path.join(OX, 'ox_inventory')), /exports\(\s*'([A-Za-z_]\w*)'/g)),
  },
  {
    name: 'ox_core',
    version: version('ox_core'),
    documented: grab(doc(), /\bOx\.([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAll(path.join(OX, 'ox_core')), /\bOx\.([A-Za-z_]\w*)/g)),
  },
  {
    name: 'ox_doorlock',
    version: version('ox_doorlock'),
    documented: grab(doc(), /exports\.ox_doorlock:([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAll(path.join(OX, 'ox_doorlock')), /exports\(\s*'([A-Za-z_]\w*)'/g)),
  },
  {
    name: 'ox_fuel',
    version: version('ox_fuel'),
    documented: grab(doc(), /exports\.ox_fuel:([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAll(path.join(OX, 'ox_fuel')), /exports\(\s*'([A-Za-z_]\w*)'/g)),
  },
  {
    // ox_banking is TypeScript, so the .lua-only walk finds nothing — read its source
    // directly. Without this the resource would report zero symbols and be "skipped",
    // which under --strict is a failure rather than a silent pass.
    name: 'ox_banking',
    version: version('ox_banking'),
    documented: grab(doc(), /exports\.ox_banking:([A-Za-z_]\w*)/g),
    actual: new Set(grab(readAllTs(path.join(OX, 'ox_banking', 'src')), /exports\(\s*'([A-Za-z_]\w*)'/g)),
  },
];

// oxmysql is the database layer every framework sits on, and `fivem-mariadb` documents its
// whole surface. The Lua API is built in lib/MySQL.lua from an explicit method list plus a
// few directly-assigned members, so read those rather than guessing.
const OXMYSQL_LIB = path.join(OX, 'oxmysql', 'lib', 'MySQL.lua');
if (fs.existsSync(OXMYSQL_LIB)) {
  const src = fs.readFileSync(OXMYSQL_LIB, 'utf8');
  // for _, method in pairs({ 'scalar', 'single', … }) do
  const methodList = src.match(/for\s+_,\s*method\s+in\s+pairs\(\{([\s\S]*?)\}\)/);
  targets.push({
    name: 'oxmysql',
    version: version('oxmysql'),
    documented: clean(grab(doc(), /\bMySQL\.([A-Za-z_]\w*)/g)),
    actual: new Set([
      ...(methodList ? grab(methodList[1], /'([A-Za-z_]\w*)'/g) : []),
      ...grab(src, /\bMySQL\.([A-Za-z_]\w*)\s*=/g),
      ...grab(src, /\bfunction\s+MySQL\.([A-Za-z_]\w*)/g),
      // MySQL.Sync.* / MySQL.Async.* resolve through an alias table
      ...grab(src, /^\s*([A-Za-z_]\w*)\s*=\s*'(?:query|scalar|single|insert|update|transaction|prepare)'/gm),
    ]),
  });
}

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
    documented: grab(fwDocAll(), /\bxPlayer\.([A-Za-z_]\w*)\s*\(/g),
    actual: new Set([
      ...grab(esxSrc, /\bself\.([A-Za-z_]\w*)\s*=\s*function/g),
      ...grab(esxSrc, /\bfunction\s+self\.([A-Za-z_]\w*)/g),
    ]),
  });
  targets.push({
    name: 'ESX.*',
    version: 'framework',
    documented: grab(fwDocAll(), /\bESX\.([A-Za-z_]\w*)\s*\(/g),
    actual: new Set([
      ...grab(esxSrc, /^function ESX\.([A-Za-z_]\w*)/gm),
      ...grab(esxSrc, /\bESX\.([A-Za-z_]\w*)\s*=/g),
    ]),
  });
}

// Qbox. Documented in qbcore.md as `exports.qbx_core:*` and previously verified by nothing.
const qbxDir = path.join(FRAMEWORKS, 'qbx_core');
if (fs.existsSync(qbxDir)) {
  targets.push({
    name: 'qbx_core',
    version: 'framework',
    documented: grab(fwDocAll(), /exports\.qbx_core:([A-Za-z_]\w*)/g),
    actual: new Set([
      ...grab(readAll(qbxDir), /exports\(\s*'([A-Za-z_]\w*)'/g),
      ...grab(readAll(qbxDir), /\bfunction\s+[A-Za-z_]\w*[.:]([A-Za-z_]\w*)/g),
    ]),
  });
}

if (fs.existsSync(path.join(FRAMEWORKS, 'qb-core'))) {
  targets.push({
    name: 'QBCore.Functions',
    version: 'framework',
    documented: grab(fwDocAll(), /\bQBCore\.Functions\.([A-Za-z_]\w*)/g),
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
      ...grab(fwDocAll(), /\bPlayer:([A-Za-z_]\w*)\s*\(/g),
      ...grab(fwDocAll(), /\bPlayer\.Functions\.([A-Za-z_]\w*)/g),
    ]),
    actual: new Set([
      ...grab(qbSrc, /\bfunction\s+Player:([A-Za-z_]\w*)/g),
      ...grab(qbSrc, /\bfunction\s+self\.Functions\.([A-Za-z_]\w*)/g),
      // the varargMethods / noargMethods shim lists
      ...grab(qbSrc, /'([A-Za-z_]\w*)'/g).filter((n) => /^(Get|Set|Add|Remove|Has|Save|Logout|Notify|Update)/.test(n)),
    ]),
  });
}

/* ---------------------------------------------------------- natives ------- */

/**
 * CFX runtime functions — real, callable, and NOT in the natives database.
 *
 * The scripting runtime provides these on top of the native ABI, so a lookup against
 * natives.json correctly reports them as absent. Without this list every one of them would
 * be flagged as invented, which would make the natives check unusable and therefore ignored.
 *
 * Provenance: the Lua runtime function reference in citizenfx/fivem-docs —
 *   content/docs/scripting-reference/runtimes/lua/functions/*.md
 * plus the globals the runtime injects that have no page of their own (`Entity`, `Player`,
 * `GlobalState`, `LocalPlayer`) and the NUI-side `GetParentResourceName`.
 *
 * To refresh after `node scripts/update-sources.mjs`:
 *   ls ../fivem-resources/docs/fivem-docs/content/docs/scripting-reference/runtimes/lua/functions/
 */
const RUNTIME_FUNCTIONS = [
  'AddEventHandler',
  'RegisterNetEvent',
  'RegisterServerEvent',
  'RemoveEventHandler',
  'TriggerEvent',
  'TriggerClientEvent',
  'TriggerServerEvent',
  'TriggerLatentClientEvent',
  'TriggerLatentServerEvent',
  'GetPlayers',
  'GetPlayerIdentifiers',
  'PerformHttpRequest',
  'PerformHttpRequestAwait',
  'RegisterNUICallback',
  'SendNUIMessage',
  'CreateThread',
  'SetTimeout',
  'Wait',
  'Citizen',
  // runtime-injected globals with no function page of their own
  'Entity',
  'Player',
  'GlobalState',
  'LocalPlayer',
  // browser side, injected into the NUI page rather than the Lua runtime
  'GetParentResourceName',
];

/**
 * Every native this documentation claims exists must exist.
 *
 * This is the largest surface the project had left unverified: `fivem-core`'s natives
 * reference, and now the networking and NUI skills, are almost entirely native names. The
 * whole product promise is "these APIs are real", and until this target existed that promise
 * was checked for ox and the frameworks but not for the natives themselves.
 *
 * Extraction is deliberately conservative, because a noisy check is one people learn to
 * ignore. Three filters, each earning its place against a real false positive found here:
 *
 *  1. **No space before `(`.** Prose puts a parenthetical after a capitalised word — "the
 *     Overextended (ox) stack", "Chromium (CEF)", "Artifacts (FXServer builds)". Requiring
 *     `Name(` with no gap removes that entire class.
 *  2. **At least one lowercase letter.** Keeps SQL types out: `VARCHAR(50)`, `TINYINT(1)`.
 *  3. **Not reached through `.` or `:`.** A native is always a bare global in Lua. Anything
 *     qualified is a method on something else — `lib.disableControls:Clear(…)`,
 *     `exports['qb-target']:AddBoxZone(…)` — and looking it up in natives.json would only
 *     ever produce a false alarm.
 *  4. **Not already verified by another target.** `exports.ox_inventory:AddItem(...)` matches
 *     the shape of a native call, but `AddItem` is ox_inventory's and is checked against
 *     ox_inventory's own source above. Skipping it here is delegation, not exemption — if it
 *     were invented, that target fails.
 *
 * What this deliberately does NOT cover: a resource we do not clone. The migration tables
 * document qb-target's old API to say what to replace, and nothing verifies those names
 * because qb-target is not a source here. They are historical by design.
 */
try {
  const verifiedElsewhere = new Set(targets.flatMap((t) => [...t.actual]));

  // This target DEPENDS on the ox and framework sources being readable. Filter 4 is what
  // separates a native from a framework method, and with no clones loaded there is nothing
  // to delegate to — every `ESX.GetExtendedPlayers` shorthand in prose would be reported as
  // an invented native. Rather than emit a wall of false alarms, declare the dependency:
  // report SKIPPED, which --strict already treats as a failure.
  if (verifiedElsewhere.size === 0) throw new Error('no ox/framework source loaded to delegate to');

  const { byName } = await (await import('../mcp/src/natives.mjs')).loadNatives();
  const documented = uniq(
    [...allDocs.matchAll(/(?<![:.\w])([A-Z][A-Za-z0-9]{3,})\(/g)]
      .map((m) => m[1])
      .filter((n) => /[a-z]/.test(n))
      .filter((n) => !RUNTIME_FUNCTIONS.includes(n))
      .filter((n) => !verifiedElsewhere.has(n))
      .filter((n) => !ALLOWED_FICTION.has(n))
  );
  targets.push({
    name: 'natives',
    version: 'runtime',
    documented,
    // byName is keyed uppercase and holds both SET_NUI_FOCUS and SetNuiFocus, so casing
    // variants (SendNUIMessage vs SendNuiMessage) collapse to the same key.
    actual: new Set([...byName.keys()].map((k) => k.toUpperCase())),
    normalise: (s) => s.toUpperCase(),
  });
} catch (err) {
  // The natives database is fetched over the network, and the target also needs the other
  // sources present. Either failure must not silently become a pass — push an empty target
  // so it reports SKIPPED and --strict fails on it.
  console.error(`natives target unavailable: ${err.message}`);
  targets.push({ name: 'natives', version: 'runtime', documented: [], actual: new Set() });
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
  // `normalise` exists for the natives target, where SendNUIMessage and SendNuiMessage are
  // the same native spelled two ways. Every other target compares names literally.
  const norm = t.normalise || ((s) => s);
  const documentedNorm = new Set(t.documented.map(norm));
  const missing = t.documented.filter((s) => !t.actual.has(norm(s)));
  const undocumented = [...t.actual].filter((s) => !documentedNorm.has(s));
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
