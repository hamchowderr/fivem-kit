#!/usr/bin/env node
/**
 * fivem-kit — server stack detection.
 *
 * Walks a FiveM server folder, enumerates its resources, and works out which
 * framework/libraries it actually runs so the rest of the plugin can speak the
 * right dialect instead of guessing.
 *
 * Usage:
 *   node detect-stack.mjs [serverPath] [--json] [--quiet]
 *
 * With no serverPath it searches upward from cwd for a folder containing
 * `resources/` (optionally alongside a server.cfg).
 *
 * Exit codes: 0 = a server was found and analysed, 1 = no server folder found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESOURCE_MANIFESTS = ['fxmanifest.lua', '__resource.lua'];

/** Signatures keyed by the resource folder name we expect on disk. */
const SIGNATURES = {
  framework: [
    { name: 'ox_core', resource: 'ox_core', label: 'ox_core (Overextended)' },
    { name: 'qbx_core', resource: 'qbx_core', label: 'Qbox (qbx_core)' },
    { name: 'qb-core', resource: 'qb-core', label: 'QBCore' },
    { name: 'esx', resource: 'es_extended', label: 'ESX Legacy' },
  ],
  mysql: [
    { name: 'oxmysql', resource: 'oxmysql', label: 'oxmysql' },
    { name: 'mysql-async', resource: 'mysql-async', label: 'mysql-async (legacy)' },
    { name: 'ghmattimysql', resource: 'ghmattimysql', label: 'ghmattimysql (legacy)' },
  ],
  inventory: [
    { name: 'ox_inventory', resource: 'ox_inventory', label: 'ox_inventory' },
    { name: 'qb-inventory', resource: 'qb-inventory', label: 'qb-inventory' },
    { name: 'qs-inventory', resource: 'qs-inventory', label: 'qs-inventory' },
    { name: 'codem-inventory', resource: 'codem-inventory', label: 'codem-inventory' },
  ],
  target: [
    { name: 'ox_target', resource: 'ox_target', label: 'ox_target' },
    { name: 'qb-target', resource: 'qb-target', label: 'qb-target' },
    { name: 'qtarget', resource: 'qtarget', label: 'qtarget (deprecated)' },
    { name: 'bt-target', resource: 'bt-target', label: 'bt-target (deprecated)' },
  ],
  lib: [
    { name: 'ox_lib', resource: 'ox_lib', label: 'ox_lib' },
    { name: 'qb-menu', resource: 'qb-menu', label: 'qb-menu' },
  ],
};

function isResourceDir(dir) {
  return RESOURCE_MANIFESTS.some((m) => fs.existsSync(path.join(dir, m)));
}

function manifestPath(dir) {
  for (const m of RESOURCE_MANIFESTS) {
    const p = path.join(dir, m);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * FiveM nests resources inside `[category]` folders, arbitrarily deep.
 * Recurse until we hit an actual resource (a folder with a manifest).
 */
function collectResources(root, resources = [], depth = 0) {
  if (depth > 6) return resources;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return resources;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (isResourceDir(full)) {
      resources.push({ name: entry.name, path: full, manifest: manifestPath(full) });
    } else {
      collectResources(full, resources, depth + 1);
    }
  }
  return resources;
}

/**
 * Does this look like a real FiveM `resources/` directory?
 *
 * A bare folder named `resources` is not enough evidence — `C:\Windows\resources`
 * exists on every Windows machine. Require either a sibling server.cfg or at least
 * one actual resource (a folder containing an fxmanifest) inside it.
 */
function looksLikeServerRoot(dir) {
  const res = path.join(dir, 'resources');
  if (!fs.existsSync(res)) return false;
  try {
    if (!fs.statSync(res).isDirectory()) return false;
  } catch {
    return false;
  }
  const hasCfg = ['server.cfg', 'server.cnf'].some((c) => fs.existsSync(path.join(dir, c)));
  if (hasCfg) return true;
  return collectResources(res, [], 0).length > 0;
}

/** Find the server root by walking up from `start`. */
function findServerRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (looksLikeServerRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readCfg(serverRoot) {
  const candidates = ['server.cfg', 'server.cnf', path.join('..', 'server.cfg')];
  for (const c of candidates) {
    const p = path.join(serverRoot, c);
    if (fs.existsSync(p)) {
      try {
        return { path: p, text: fs.readFileSync(p, 'utf8') };
      } catch {
        /* unreadable, keep looking */
      }
    }
  }
  return null;
}

/**
 * Parse ensure/start/stop lines in load order.
 * NOTE: FiveM's cfg parser splits a line on `;` — anything after a semicolon
 * becomes a SEPARATE command, it is not a comment. Comments are `#`.
 */
function parseCfg(text) {
  const started = [];
  const stopped = [];
  const semicolonLines = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const noComment = raw.split('#')[0];
    if (!noComment.trim()) return;
    if (noComment.includes(';')) semicolonLines.push({ line: idx + 1, text: raw.trim() });
    for (const segment of noComment.split(';')) {
      const m = segment.trim().match(/^(ensure|start|stop)\s+([\w\-.\[\]]+)/i);
      if (!m) continue;
      const verb = m[1].toLowerCase();
      const name = m[2];
      if (verb === 'stop') stopped.push(name);
      else started.push(name);
    }
  });
  return { started, stopped, semicolonLines };
}

/** Pull `dependency`/`dependencies` out of an fxmanifest. */
function parseManifestDeps(manifestFile) {
  let text;
  try {
    text = fs.readFileSync(manifestFile, 'utf8');
  } catch {
    return [];
  }
  const deps = new Set();
  const single = text.matchAll(/^\s*dependency\s+['"]([^'"]+)['"]/gm);
  for (const m of single) deps.add(m[1]);
  const blocks = text.matchAll(/dependencies\s*\{([\s\S]*?)\}/g);
  for (const b of blocks) {
    for (const m of b[1].matchAll(/['"]([^'"]+)['"]/g)) deps.add(m[1]);
  }
  // `@ox_lib/init.lua` style shared_scripts imply a dependency too.
  for (const m of text.matchAll(/@([\w\-.]+)\//g)) deps.add(m[1]);
  return [...deps];
}

function detectCategory(list, present) {
  const found = list.filter((s) => present.has(s.resource.toLowerCase()));
  return {
    primary: found.length ? found[0].name : null,
    label: found.length ? found[0].label : null,
    all: found.map((f) => f.name),
  };
}

/**
 * Analyse a FiveM server folder.
 * @param {string} [startFrom] path to search from; defaults to cwd
 * @returns {object} result object — `found: false` with an `error` when no server is located
 */
export function detectStack(startFrom = process.cwd()) {
  startFrom = path.resolve(startFrom);
  const serverRoot = findServerRoot(startFrom);

  if (!serverRoot) {
    return {
      found: false,
      searchedFrom: startFrom,
      error:
        'No FiveM server folder found. Expected a directory containing `resources/`. Pass the server path explicitly, e.g. "D:/FXServer/server-data".',
    };
  }

  const resourcesDir = path.join(serverRoot, 'resources');
  const resources = collectResources(resourcesDir);
  const present = new Set(resources.map((r) => r.name.toLowerCase()));

  const cfg = readCfg(serverRoot);
  const cfgParsed = cfg ? parseCfg(cfg.text) : { started: [], stopped: [], semicolonLines: [] };

  const startedSet = new Set(cfgParsed.started.map((s) => s.toLowerCase()));
  const onDiskNotStarted = resources
    .map((r) => r.name)
    .filter((n) => !startedSet.has(n.toLowerCase()));
  const startedNotOnDisk = cfgParsed.started.filter((n) => !present.has(n.toLowerCase()));

  const stack = {
    framework: detectCategory(SIGNATURES.framework, present),
    mysql: detectCategory(SIGNATURES.mysql, present),
    inventory: detectCategory(SIGNATURES.inventory, present),
    target: detectCategory(SIGNATURES.target, present),
    lib: detectCategory(SIGNATURES.lib, present),
  };

  // Dialect: what patterns should generated/audited code use?
  let dialect = 'ox';
  if (stack.framework.primary === 'esx') dialect = 'esx';
  else if (stack.framework.primary === 'qb-core') dialect = 'qbcore';
  else if (stack.framework.primary === 'qbx_core') dialect = 'qbox';
  else if (stack.framework.primary === 'ox_core') dialect = 'ox';
  else if (present.has('ox_lib')) dialect = 'ox';
  else dialect = 'standalone';

  const mixed = stack.framework.all.length > 1;

  const result = {
    found: true,
    serverRoot,
    resourcesDir,
    serverCfg: cfg ? cfg.path : null,
    dialect,
    mixedFrameworks: mixed,
    stack,
    counts: {
      resources: resources.length,
      startedInCfg: cfgParsed.started.length,
    },
    resources: resources.map((r) => ({
      name: r.name,
      path: r.path,
      relPath: path.relative(serverRoot, r.path),
      dependencies: r.manifest ? parseManifestDeps(r.manifest) : [],
      started: startedSet.has(r.name.toLowerCase()),
    })),
    loadOrder: cfgParsed.started,
    warnings: {
      onDiskNotStarted,
      startedNotOnDisk,
      semicolonLinesInCfg: cfgParsed.semicolonLines,
    },
  };

  return result;
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const quiet = argv.includes('--quiet');
  const positional = argv.filter((a) => !a.startsWith('--'));

  const result = detectStack(positional[0] ?? process.cwd());

  if (!result.found) {
    if (json) console.log(JSON.stringify(result, null, 2));
    else if (!quiet) console.error(result.error);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { stack, warnings } = result;
  const line = (k, v) => console.log(`  ${k.padEnd(12)} ${v}`);
  console.log(`\nFiveM server: ${result.serverRoot}`);
  console.log(`Dialect:      ${result.dialect}${result.mixedFrameworks ? '  (MIXED FRAMEWORKS DETECTED)' : ''}\n`);
  line('framework', stack.framework.label ?? 'none detected (standalone)');
  line('lib', stack.lib.label ?? '—');
  line('mysql', stack.mysql.label ?? '—');
  line('inventory', stack.inventory.label ?? '—');
  line('target', stack.target.label ?? '—');
  console.log(`\n  ${result.counts.resources} resources on disk, ${result.counts.startedInCfg} started in cfg`);
  if (warnings.startedNotOnDisk.length) {
    console.log(`\n  ⚠ started in cfg but missing on disk: ${warnings.startedNotOnDisk.join(', ')}`);
  }
  if (warnings.semicolonLinesInCfg.length) {
    console.log(`\n  ⚠ ${warnings.semicolonLinesInCfg.length} cfg line(s) contain ';' — FiveM splits on it, it is NOT a comment`);
  }
  console.log('');
}

// only run the CLI when executed directly, not when imported
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
