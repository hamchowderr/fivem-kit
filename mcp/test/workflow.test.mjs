/**
 * Contract tests for the workflow scripts.
 *
 * A workflow runs a fleet of agents, so "just run it and see" is not a cheap check — and the
 * ways it can be wrong are mostly static: a `meta` the loader rejects, a runtime API the
 * sandbox does not have, a silent cap that makes a partial audit look complete. All of those
 * are readable from the source.
 *
 * The rules come from the Workflow tool's own contract:
 *   - the file must begin with `export const meta = {...}` and meta must be a PURE literal
 *     (no variables, calls, spreads or interpolation)
 *   - the script is plain JavaScript, not TypeScript
 *   - Date.now(), Math.random() and argless `new Date()` throw — they would break resume
 *   - there is no filesystem or Node API access
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'workflows');

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.js'))
  : [];

describe('workflows/', () => {
  test('exists and holds at least one .js workflow', () => {
    // The extension matters: the plugin loader's schema names ".js file paths" and never
    // mentions .mjs, and a workflow that is never discovered fails by simply not being there.
    assert.ok(files.length > 0, 'no .js files in workflows/ — nothing would be discovered');
  });

  for (const file of files) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');

    describe(file, () => {
      test('is valid JavaScript', () => {
        const r = spawnSync(process.execPath, ['--check', path.join(DIR, file)], {
          encoding: 'utf8',
          timeout: 30_000,
        });
        assert.equal(r.status, 0, r.stderr);
      });

      test('starts with a meta block that is a pure literal', () => {
        assert.match(src, /^export const meta = \{/, 'meta must be first and named exactly');

        const block = src.slice(src.indexOf('export const meta'), src.indexOf('\n};') + 3);
        assert.ok(!/\.\.\./.test(block), 'no spreads — meta must be a pure literal');
        assert.ok(!/`\$\{/.test(block), 'no template interpolation in meta');
        assert.ok(!/\w+\(/.test(block.replace(/\/\/.*$/gm, '')), 'no function calls in meta');
      });

      test('declares name, description and phases', () => {
        assert.match(src, /name:\s*'[^']+'/);
        assert.match(src, /description:\s*\n?\s*'[^']+'/);
        assert.match(src, /phases:\s*\[/);
      });

      test('every phase() call has a matching meta entry', () => {
        // Titles are matched exactly; a mismatch silently gets its own progress group rather
        // than erroring, so nothing would tell you the display had drifted.
        const declared = new Set(
          [...src.matchAll(/\{\s*title:\s*'([^']+)'/g)].map((m) => m[1])
        );
        const used = new Set([
          ...[...src.matchAll(/(?:^|\W)phase\('([^']+)'\)/g)].map((m) => m[1]),
          ...[...src.matchAll(/phase:\s*'([^']+)'/g)].map((m) => m[1]),
        ]);
        for (const title of used) {
          assert.ok(declared.has(title), `phase "${title}" is used but not declared in meta`);
        }
      });

      test('uses no runtime the workflow sandbox refuses', () => {
        // These throw inside a workflow — they would make a resumed run diverge from the
        // original, so the sandbox removes them rather than letting resume quietly lie.
        assert.ok(!/Date\.now\(/.test(src), 'Date.now() throws in a workflow');
        assert.ok(!/Math\.random\(/.test(src), 'Math.random() throws in a workflow');
        assert.ok(!/new Date\(\s*\)/.test(src), 'argless new Date() throws in a workflow');
        assert.ok(!/\brequire\(/.test(src), 'no Node API access in a workflow');
        assert.ok(!/from\s+'node:/.test(src), 'no Node API access in a workflow');
      });

      test('never caps coverage silently', () => {
        // The failure mode this guards: an audit that quietly examined half a server reads
        // exactly like one that examined all of it. Any bound must reach the user.
        if (/MAX_|slice\(|\.length >/.test(src)) {
          assert.match(src, /log\(/, 'a script that bounds work must log what it bounded');
        }
      });
    });
  }
});

describe('audit-server', () => {
  const src = fs.readFileSync(path.join(DIR, 'audit-server.js'), 'utf8');

  test('excludes framework and library resources from the audit', () => {
    // Their exports look like vulnerabilities because exposing mutation IS their API, and
    // nobody auditing their own server is going to patch es_extended.
    for (const r of ['ox_inventory', 'es_extended', 'qb-core', 'oxmysql']) {
      assert.ok(src.includes(`'${r}'`), `${r} must be excluded`);
    }
  });

  test('keeps an unverified CRITICAL rather than dropping it', () => {
    // If verification did not run for a finding, the safe direction is to report it as
    // unverified. Silently discarding it is the worst available failure for a security tool.
    assert.match(src, /verified:\s*Boolean\(verdict\)/);
  });

  test('reports batches that returned nothing instead of counting them clean', () => {
    assert.match(src, /were NOT audited/);
  });
});
