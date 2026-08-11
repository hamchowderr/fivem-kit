/**
 * Exit-code tests for the ox documentation verifier.
 *
 * This script is a CI gate, so its exit code IS its contract. It previously printed
 * "All documented ox APIs verified present" and exited 0 after checking zero symbols, which
 * meant a clone that produced empty directories showed a green tick on a check that never
 * ran. A green that means nothing is worse than a red, because nobody investigates green.
 *
 * The success path needs real ox checkouts and is covered by CI itself; what is pinned here
 * is every way the check can fail to actually check anything.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-docs.mjs');

/**
 * Run the verifier with BOTH source roots controlled.
 *
 * The framework root has to be pinned too, or these tests read whatever ox/ESX/QBCore
 * checkouts happen to exist on the machine — which is exactly what broke when framework
 * targets were added: "four empty ox checkouts" stopped meaning "nothing was verified"
 * because the developer's real es_extended and qb-core were still being found.
 */
function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      FRAMEWORK_RESOURCES: path.join(os.tmpdir(), 'fivem-kit-no-frameworks-here'),
    },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `ox-${name}-`));

describe('the verifier refuses to pass without verifying', () => {
  test('a missing sources directory exits 2', () => {
    const r = run(path.join(os.tmpdir(), 'definitely-not-here-ox'));
    assert.equal(r.status, 2);
    assert.match(r.out, /sources not found/i);
  });

  test('an empty sources directory exits 1, not 0', () => {
    // The regression: this used to print "All documented ox APIs verified present" and exit 0.
    const r = run(tmp('empty'));
    assert.equal(r.status, 1, 'verifying nothing must not be success');
    assert.match(r.out, /Verified NOTHING/);
    assert.ok(!/All documented ox APIs verified present\./.test(r.out), 'must not claim success');
  });

  test('present but empty resource directories exit 1', () => {
    const dir = tmp('skeleton');
    for (const r of ['ox_lib', 'ox_core', 'ox_target', 'ox_inventory']) {
      fs.mkdirSync(path.join(dir, r), { recursive: true });
    }
    const r = run(dir);
    assert.equal(r.status, 1, 'four empty checkouts verify nothing');
    assert.match(r.out, /0 documented symbols checked/);
  });

  test('the natives target declares its dependency instead of guessing', () => {
    // The natives check tells a native from a framework method by delegating: anything the
    // ox/framework targets already verified is not a native. With no sources loaded there is
    // nothing to delegate to, and every `ESX.GetExtendedPlayers` shorthand in prose would be
    // reported as an invented native — a wall of false alarms that would get the whole check
    // switched off. It must skip and say so, not guess.
    const r = run(tmp('natives-nodeps'));
    assert.match(r.out, /natives target unavailable/);
    assert.match(r.out, /natives\s+SKIPPED/);
    assert.equal(r.status, 1);
  });

  test('--strict is accepted and does not change the no-sources verdict', () => {
    const r = run(tmp('empty-strict'), '--strict');
    assert.equal(r.status, 1);
  });

  test('the flag is not mistaken for the sources path', () => {
    // `--strict` must be parsed as a flag; treating it as the directory would make the
    // script report "sources not found" for a path the user never passed.
    const r = run('--strict');
    assert.notEqual(r.out.includes("'--strict'"), true, 'the flag must not be read as a path');
  });
});

describe('coverage and its escape hatch', () => {
  test('docs/ is scanned, not just skills/', () => {
    // docs/hooks.md and docs/lsp.md name real APIs, and being the files nobody re-reads is
    // exactly what lets them rot quietly.
    const script = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(script, /path\.join\(REPO, 'docs'\)/);
  });

  test('a deliberate counter-example can be exempted by name, but never a whole file', () => {
    const script = fs.readFileSync(SCRIPT, 'utf8');
    // The marker is per-symbol. A whole-file opt-out would leave every OTHER API in that file
    // unverified, which is the failure this script exists to prevent.
    assert.ok(script.includes('verify-docs:'), 'the per-symbol allow marker must be honoured');
    assert.ok(!/verify-docs:\s*skip/.test(script), 'no whole-file skip may exist');

    // docs/lsp.md relies on it: it shows a misspelled native as the thing a working language
    // server catches. If that exemption stops being honoured the docs cannot show failure.
    const lsp = fs.readFileSync(path.join(ROOT, 'docs', 'lsp.md'), 'utf8');
    assert.match(lsp, /<!--\s*verify-docs:\s*allow\s+SetEntityCoodrs\s*-->/);
  });
});
