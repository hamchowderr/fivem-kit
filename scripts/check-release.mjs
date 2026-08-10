#!/usr/bin/env node
/**
 * Release gate — the checks that must hold before anything is published.
 *
 * This is a script rather than inline CI steps so the same gate runs locally. A check you can
 * only run by pushing is a check you skip.
 *
 * Three versions have to agree, because they are three files that all claim to describe the
 * same release:
 *   - `.claude-plugin/plugin.json`      what Claude Code installs
 *   - `.claude-plugin/marketplace.json` what the marketplace advertises
 *   - `mcp/package.json`                what npm publishes
 *
 * A mismatch is silent and nasty: the marketplace offers 0.2.0, npm serves 0.1.0, and nobody
 * notices until someone reports a missing feature.
 *
 * Usage:
 *   node scripts/check-release.mjs                  verify internal consistency
 *   node scripts/check-release.mjs --expect 0.2.0   also require this exact version (CI, from the tag)
 *   node scripts/check-release.mjs --json
 *
 * Exit 0 when every check passes, 1 otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.]+)?$/;

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

/**
 * Run every check and collect failures rather than throwing on the first.
 * Seeing all three problems at once beats fixing them one push at a time.
 */
export function checkRelease({ expect = null, root = ROOT } = {}) {
  const errors = [];
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

  let versions;
  try {
    versions = {
      'plugin.json': read('.claude-plugin/plugin.json').version,
      'marketplace.json': read('.claude-plugin/marketplace.json').plugins[0].version,
      'mcp/package.json': read('mcp/package.json').version,
    };
  } catch (e) {
    return { ok: false, errors: [`could not read a manifest: ${e.message}`], versions: null, version: null };
  }

  for (const [file, v] of Object.entries(versions)) {
    if (!v) errors.push(`${file} has no version`);
    else if (!SEMVER.test(v)) errors.push(`${file} version "${v}" is not valid semver`);
  }

  const distinct = [...new Set(Object.values(versions))];
  if (distinct.length > 1) {
    errors.push(
      `versions disagree — ${Object.entries(versions)
        .map(([f, v]) => `${f}=${v}`)
        .join(', ')}`
    );
  }

  const version = distinct.length === 1 ? distinct[0] : null;

  if (expect) {
    const wanted = String(expect).replace(/^v/, '');
    if (version && version !== wanted) {
      errors.push(`tag says ${wanted} but the manifests say ${version}`);
    }
  }

  // The changelog gate: a release nobody documented is a release nobody can evaluate.
  const target = expect ? String(expect).replace(/^v/, '') : version;
  if (target) {
    let changelog = '';
    try {
      changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    } catch {
      errors.push('CHANGELOG.md is missing');
    }
    if (changelog) {
      // Accept "## [0.2.0]" and "## 0.2.0" — the link-reference style is conventional but
      // not universal, and rejecting a valid changelog over brackets helps nobody.
      //
      // The trailing lookahead is load-bearing: without it the optional `]` lets the version
      // match as a PREFIX, so a heading for 0.2.01 (or 0.2.0-beta) would satisfy a check for
      // 0.2.0 and wave through a release nobody documented.
      const heading = new RegExp(`^##\\s*\\[?${target.replace(/\./g, '\\.')}\\]?(?![\\w.-])`, 'm');
      if (!heading.test(changelog)) {
        errors.push(`CHANGELOG.md has no section for ${target}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, versions, version };
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--expect');
  const expect = i === -1 ? null : argv[i + 1];
  const result = checkRelease({ expect });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`Release gate passed — version ${result.version}`);
    for (const [f, v] of Object.entries(result.versions)) console.log(`  ${f.padEnd(24)} ${v}`);
  } else {
    console.error('Release gate FAILED:');
    for (const e of result.errors) console.error(`  - ${e}`);
  }

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
