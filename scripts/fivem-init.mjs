#!/usr/bin/env node
/**
 * `/fivem:init` — detect the server stack once and write it to `.claude/fivem.local.md`.
 *
 * The write path lives here, in code, rather than in the skill's prose, for two reasons:
 * it is testable, and it round-trips its own output through the hardened reader before
 * declaring success. If a file this script writes would not survive `readConfig()`, that is
 * a bug in the writer, and it should fail loudly here rather than silently disable every
 * hook later.
 *
 * Usage:
 *   node scripts/fivem-init.mjs [serverPath] [options]
 *
 *   --project-dir <dir>  where to write `.claude/fivem.local.md`  (default: cwd)
 *   --force              overwrite an existing config
 *   --dry-run            print what would be written, touch nothing
 *   --no-gitignore       do not append `.claude/*.local.md` to an existing .gitignore
 *   --json               machine-readable output
 *
 * Exit codes: 0 written (or already correct), 1 nothing detected / write failed,
 *             3 a config already exists and --force was not given.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectStack } from './detect-stack.mjs';
import { configPath, readConfig, renderConfig, CONFIG_DIR } from './fivem-config.mjs';

const GITIGNORE_PATTERN = '.claude/*.local.md';

/** Map a `detectStack()` result onto the config file's fields. */
export function configFromDetection(detected) {
  const stack = detected.stack ?? {};
  return {
    enabled: true,
    server_path: detected.serverRoot,
    dialect: detected.dialect,
    framework: stack.framework?.primary ?? null,
    lib: stack.lib?.primary ?? null,
  };
}

/**
 * Does this .gitignore already cover the config file?
 * Deliberately loose — `.claude/`, `*.local.md` and the exact pattern all count, because the
 * point is to avoid a duplicate entry, not to police how the user wrote theirs.
 */
export function gitignoreCovers(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l === GITIGNORE_PATTERN || l === '*.local.md' || l === '.claude/' || l === '.claude');
}

/** Append the ignore pattern to an existing .gitignore. Never creates one. */
function ensureGitignore(projectDir) {
  const file = path.join(projectDir, '.gitignore');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { status: 'absent', file };
  }
  if (gitignoreCovers(text)) return { status: 'already-ignored', file };

  const prefix = text.endsWith('\n') || text === '' ? '' : '\n';
  fs.appendFileSync(
    file,
    `${prefix}\n# fivem-kit — describes this machine, not the project\n${GITIGNORE_PATTERN}\n`
  );
  return { status: 'added', file };
}

/**
 * Detect, render, write, and verify.
 * @returns {{status: string, [key: string]: any}} `status` is one of
 *   `written` | `unchanged` | `dry-run` | `exists` | `not-found` | `invalid`
 */
export function init({
  serverPath,
  projectDir = process.cwd(),
  force = false,
  dryRun = false,
  gitignore = true,
} = {}) {
  const detected = detectStack(serverPath ?? projectDir);
  if (!detected.found) {
    return { status: 'not-found', error: detected.error, searchedFrom: detected.searchedFrom };
  }

  const file = configPath(projectDir);
  const values = configFromDetection(detected);
  const contents = renderConfig(values);

  const existing = fs.existsSync(file);
  if (existing && !force) {
    const current = readConfig(projectDir);
    return {
      status: 'exists',
      path: file,
      detected: values,
      current: current.config,
      hint: 'Re-run with --force to overwrite.',
    };
  }

  if (dryRun) return { status: 'dry-run', path: file, detected: values, contents };

  fs.mkdirSync(path.join(projectDir, CONFIG_DIR), { recursive: true });
  fs.writeFileSync(file, contents);

  // Round-trip through the hardened reader. A file we wrote that the reader rejects would
  // silently disable every hook, so treat it as a hard failure here instead.
  const verify = readConfig(projectDir);
  if (!verify.ok) {
    return { status: 'invalid', path: file, warnings: verify.warnings, contents };
  }

  return {
    status: 'written',
    path: file,
    config: verify.config,
    warnings: verify.warnings,
    detection: {
      serverRoot: detected.serverRoot,
      serverCfg: detected.serverCfg,
      dialect: detected.dialect,
      mixedFrameworks: detected.mixedFrameworks,
      counts: detected.counts,
      stack: detected.stack,
    },
    gitignore: gitignore ? ensureGitignore(projectDir) : { status: 'skipped' },
  };
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const projectDir = flagValue(argv, '--project-dir') ?? process.cwd();
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--project-dir');

  const result = init({
    serverPath: positional[0],
    projectDir: path.resolve(projectDir),
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
    gitignore: !argv.includes('--no-gitignore'),
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    report(result);
  }

  if (result.status === 'not-found' || result.status === 'invalid') process.exit(1);
  if (result.status === 'exists') process.exit(3);
}

function report(r) {
  if (r.status === 'not-found') {
    console.error(r.error);
    return;
  }
  if (r.status === 'exists') {
    console.log(`Config already exists: ${r.path}`);
    console.log(`Detected now: dialect=${r.detected.dialect} server=${r.detected.server_path}`);
    console.log(r.hint);
    return;
  }
  if (r.status === 'dry-run') {
    console.log(`Would write ${r.path}:\n`);
    console.log(r.contents);
    return;
  }
  if (r.status === 'invalid') {
    console.error(`Wrote ${r.path} but it failed validation:`);
    for (const w of r.warnings) console.error(`  - ${w}`);
    return;
  }

  const d = r.detection;
  console.log(`\nWrote ${r.path}\n`);
  console.log(`  server       ${d.serverRoot}`);
  console.log(`  dialect      ${d.dialect}${d.mixedFrameworks ? '   (MIXED FRAMEWORKS)' : ''}`);
  console.log(`  framework    ${d.stack.framework.label ?? 'none (standalone)'}`);
  console.log(`  lib          ${d.stack.lib.label ?? '—'}`);
  console.log(`  resources    ${d.counts.resources} on disk, ${d.counts.startedInCfg} started in cfg`);
  if (r.gitignore.status === 'added') console.log(`\n  Added ${GITIGNORE_PATTERN} to .gitignore`);
  if (r.gitignore.status === 'absent') {
    console.log(`\n  No .gitignore here — add ${GITIGNORE_PATTERN} to yours.`);
  }
  for (const w of r.warnings ?? []) console.log(`  ! ${w}`);
}

// only run the CLI when executed directly, not when imported
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
