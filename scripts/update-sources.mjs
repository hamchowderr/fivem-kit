#!/usr/bin/env node
/**
 * Clone or update every upstream source the documentation is verified against.
 *
 * Documentation here is written by reading real source, so a stale checkout means a stale
 * first draft. That is not hypothetical: the local `qb-core` was seven months behind when the
 * QBCore reference was written, so it documented `Player.Functions.*` and `PrepForSQL` — one
 * now a legacy shim, the other deleted upstream. CI caught it against fresh clones, but only
 * after the whole reference had been written the wrong way round.
 *
 * Run this before writing or correcting any reference. CI runs it too, so the same list
 * produces the same checkouts in both places.
 *
 * Usage:
 *   node scripts/update-sources.mjs [--root <dir>] [--no-docs] [--json]
 *
 *   --root      where to put ox/, frameworks/ and docs/  (default: ../fivem-resources)
 *   --no-docs   skip the prose documentation repos. They are large, and CI only verifies
 *               API symbols against code — it never reads them.
 *
 * Exit codes: 0 everything present and current, 1 one or more sources failed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  OX_SOURCES,
  FRAMEWORK_SOURCES,
  DOC_SOURCES,
  oxRepo,
  frameworkRepo,
  docRepo,
  DEFAULT_ROOT,
} from './sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** git, with an argv array and no shell. */
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 180_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

const head = (dir) => git(['rev-parse', '--short', 'HEAD'], dir).out || '?';

/**
 * Clone if absent, advance if present.
 *
 * Exported because `fivem-lsp.mjs` installs the FiveM type definitions the same way, and a
 * second hand-written copy of this would be a second place for the shallow-clone bug below
 * to reappear.
 *
 * @returns {{name: string, action: 'cloned'|'updated'|'current'|'failed', from?: string, to?: string, error?: string}}
 */
export function sync(name, url, dest) {
  if (!fs.existsSync(dest)) {
    const r = git(['clone', '--depth', '1', '--quiet', url, dest]);
    return r.ok
      ? { name, action: 'cloned', to: head(dest) }
      : { name, action: 'failed', error: r.out.split('\n').slice(-1)[0] };
  }

  const before = head(dest);

  // These are shallow clones, and `git pull` on one fails once upstream has moved past the
  // shallow boundary — "refusing to merge unrelated histories", because the depth-1 fetch
  // shares no ancestry with the local tip. Fetch then hard-reset instead, which is how a
  // shallow checkout is advanced. These are read-only reference clones with nothing local
  // worth keeping, so discarding the old tip is exactly what we want.
  const branch =
    git(['symbolic-ref', '--short', 'HEAD'], dest).out ||
    git(['rev-parse', '--abbrev-ref', 'origin/HEAD'], dest).out.replace(/^origin\//, '') ||
    'main';

  const fetched = git(['fetch', '--depth', '1', '--quiet', 'origin', branch], dest);
  if (!fetched.ok) {
    return { name, action: 'failed', from: before, error: fetched.out.split('\n').slice(-1)[0] };
  }
  const reset = git(['reset', '--hard', '--quiet', 'FETCH_HEAD'], dest);
  if (!reset.ok) {
    return { name, action: 'failed', from: before, error: reset.out.split('\n').slice(-1)[0] };
  }

  const after = head(dest);
  return after === before
    ? { name, action: 'current', to: after }
    : { name, action: 'updated', from: before, to: after };
}

function main() {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf('--root');
  const root =
    rootFlag === -1 ? path.resolve(REPO, ...DEFAULT_ROOT) : path.resolve(argv[rootFlag + 1]);

  const withDocs = !argv.includes('--no-docs');

  const oxDir = path.join(root, 'ox');
  const fwDir = path.join(root, 'frameworks');
  const docDir = path.join(root, 'docs');
  fs.mkdirSync(oxDir, { recursive: true });
  fs.mkdirSync(fwDir, { recursive: true });
  if (withDocs) fs.mkdirSync(docDir, { recursive: true });

  const results = [
    ...OX_SOURCES.map((n) => sync(n, oxRepo(n), path.join(oxDir, n))),
    ...FRAMEWORK_SOURCES.map((f) => sync(f.name, frameworkRepo(f), path.join(fwDir, f.name))),
    ...(withDocs
      ? DOC_SOURCES.map((d) => sync(d.name, docRepo(d), path.join(docDir, d.name)))
      : []),
  ];

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ root, results }, null, 2));
  } else {
    console.log(`Sources under ${root}\n`);
    if (!withDocs) {
      console.log(`  skipped  ${DOC_SOURCES.length} prose docs repo(s) (--no-docs)\n`);
    }
    for (const r of results) {
      const detail =
        r.action === 'updated'
          ? `${r.from} -> ${r.to}`
          : r.action === 'failed'
            ? r.error
            : (r.to ?? '');
      console.log(`  ${r.action.padEnd(8)} ${r.name.padEnd(14)} ${detail}`);
    }
    const changed = results.filter((r) => r.action === 'updated' || r.action === 'cloned');
    const broken = results.filter((r) => r.action === 'failed');
    // Never claim everything is current while something failed — that was the first version's
    // behaviour and it is precisely the kind of reassuring-but-false summary this project
    // keeps finding and removing.
    console.log(
      changed.length
        ? `\n${changed.length} source(s) changed — re-read anything you documented from them.`
        : broken.length
          ? `\n${results.length - broken.length} source(s) current, ${broken.length} could not be updated.`
          : '\nEverything was already current.'
    );
  }

  const failed = results.filter((r) => r.action === 'failed');
  if (failed.length) {
    console.error(`\n${failed.length} source(s) failed: ${failed.map((f) => f.name).join(', ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
