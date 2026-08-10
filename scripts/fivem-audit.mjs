#!/usr/bin/env node
/**
 * Audit CLI — the single entry point for running the deterministic analyser over real files.
 *
 * `mcp/src/audit.mjs` holds the rules and audits one buffer. Everything that needs to audit a
 * *resource* or a *server* goes through here: the security-auditor subagent, the write-time
 * hook, and the beads sync. One walker, one severity filter, one output shape — so a finding
 * reported by the hook is the same finding, with the same key, that the auditor reports.
 *
 * Usage:
 *   node scripts/fivem-audit.mjs <path> [options]      path = a .lua file, a resource, or a server
 *
 *   --json                   machine-readable output
 *   --min-severity <level>   critical | high | medium | low   (default: low)
 *   --fail-on <level>        exit 2 when a finding at or above this severity exists
 *   --include-framework      audit ox_*, qb-core, es_extended … too (skipped by default)
 *   --quiet                  findings only, no summary
 *
 * Exit codes: 0 completed, 1 nothing to audit, 2 the --fail-on threshold was met.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditLua } from '../mcp/src/audit.mjs';

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * Resources whose findings are noise: they are the framework, they are audited upstream, and
 * nobody running an audit is planning to patch ox_inventory. Skipping them is what keeps a
 * whole-server report about the server owner's own code.
 */
const FRAMEWORK_RESOURCES = new Set([
  'ox_core', 'ox_lib', 'ox_inventory', 'ox_target', 'ox_doorlock', 'ox_fuel', 'ox_mdt',
  'oxmysql', 'es_extended', 'esx_menu_default', 'esx_menu_dialog', 'esx_menu_list',
  'qb-core', 'qbx_core', 'mysql-async', 'ghmattimysql', 'screenshot-basic',
  'spawnmanager', 'sessionmanager', 'mapmanager', 'chat', 'hardcap', 'rconlog', 'yarn',
  'webpack', 'monitor', 'basic-gamemode', 'fivem-map-skater', 'fivem-map-hipster',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'web', 'html', 'ui', 'nui']);

/** Collect .lua files under a path, skipping build output and NUI bundles. */
export function collectLua(target, out = [], depth = 0) {
  if (depth > 8) return out;
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    if (target.endsWith('.lua')) out.push(target);
    return out;
  }
  if (!stat.isDirectory()) return out;

  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      collectLua(full, out, depth + 1);
    } else if (entry.name.endsWith('.lua')) {
      out.push(full);
    }
  }
  return out;
}

/** Is this path inside a framework resource we deliberately do not audit? */
export function isFrameworkPath(file) {
  return file
    .split(/[\\/]/)
    .some((segment) => FRAMEWORK_RESOURCES.has(segment.toLowerCase()));
}

/**
 * A stable identity for a finding: rule + path relative to the audit root + line.
 *
 * This is what makes re-auditing idempotent. It must not contain an absolute path, or the
 * same finding would get a different key on another machine and file a duplicate issue.
 *
 * The root must be a *directory* that contains the file, not the file itself. Auditing a
 * single file with the file as its own root yields an empty relative path, and every file
 * then collapses to the same key — which silently deduplicates findings across unrelated
 * files. Callers auditing one file should pass the project or server directory as `root`.
 */
export function findingKey(finding, root) {
  let rel = path.relative(root, finding.file).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) rel = path.basename(finding.file);
  return `${finding.rule}:${rel}:${finding.line}`;
}

/**
 * Audit a file, a resource directory, or a whole server folder.
 *
 * @param {string} target what to audit
 * @param {{minSeverity?: string, includeFramework?: boolean, root?: string}} opts
 *   `root` is the directory finding keys are made relative to. It defaults to the target,
 *   which is correct for a directory but wrong for a single file — pass the project or
 *   server directory when auditing one file, so its key matches the one a full run produces.
 * @returns {{root: string, files: number, findings: object[], reviewRequired: object[],
 *            counts: object, skipped: string[]}}
 */
export function audit(target, { minSeverity = 'low', includeFramework = false, root: rootOpt } = {}) {
  const target_ = path.resolve(target);
  const root = rootOpt ? path.resolve(rootOpt) : target_;
  const threshold = SEVERITY_ORDER[String(minSeverity).toUpperCase()] ?? SEVERITY_ORDER.LOW;

  const all = collectLua(target_);
  const skipped = [];
  const files = includeFramework
    ? all
    : all.filter((f) => {
        if (isFrameworkPath(f)) {
          skipped.push(f);
          return false;
        }
        return true;
      });

  const findings = [];
  const reviewRequired = [];
  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // unreadable file is not a finding
    }
    const result = auditLua(source, file);
    for (const f of result.findings) {
      if (SEVERITY_ORDER[f.severity] > threshold) continue;
      findings.push({ ...f, key: findingKey(f, root), side: result.side });
    }
    for (const r of result.reviewRequired ?? []) {
      reviewRequired.push({ ...r, file });
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line
  );

  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) counts[f.severity]++;

  return { root, files: files.length, findings, reviewRequired, counts, skipped };
}

function flagValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const quiet = argv.includes('--quiet');
  const minSeverity = flagValue(argv, '--min-severity', 'low');
  const failOn = flagValue(argv, '--fail-on', null);
  const flagged = new Set(['--min-severity', '--fail-on']);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !flagged.has(argv[i - 1]));

  const target = positional[0] ?? process.cwd();
  if (!fs.existsSync(target)) {
    console.error(`No such path: ${target}`);
    process.exit(1);
  }

  const result = audit(target, {
    minSeverity,
    includeFramework: argv.includes('--include-framework'),
  });

  if (result.files === 0) {
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.error(`No Lua files to audit under ${result.root}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const rel = path.relative(result.root, f.file).split(path.sep).join('/') || path.basename(f.file);
      console.log(`[${f.rule} · ${f.severity}] ${rel}:${f.line}`);
      console.log(`  ${f.message}`);
      console.log(`  fix: ${f.fix}\n`);
    }
    if (!quiet) {
      const c = result.counts;
      console.log(
        `${result.files} file(s) audited — ` +
          `${c.CRITICAL} critical, ${c.HIGH} high, ${c.MEDIUM} medium, ${c.LOW} low` +
          (result.skipped.length ? `  (${result.skipped.length} framework file(s) skipped)` : '')
      );
      if (result.reviewRequired.length) {
        console.log(`${result.reviewRequired.length} handler(s) need a human read — see --json`);
      }
    }
  }

  if (failOn) {
    const limit = SEVERITY_ORDER[String(failOn).toUpperCase()];
    if (limit !== undefined && result.findings.some((f) => SEVERITY_ORDER[f.severity] <= limit)) {
      process.exit(2);
    }
  }
}

// only run the CLI when executed directly, not when imported
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
