/**
 * Tests for the release gate.
 *
 * This is the check that decides whether something gets published to a registry that does not
 * allow unpublishing after 72 hours. A gate that silently passes when it should fail is worse
 * than no gate, so every failure mode gets an explicit test.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkRelease } from '../../scripts/check-release.mjs';

/** A throwaway repo with the three manifests and a changelog. */
function repo({ plugin = '0.2.0', marketplace = '0.2.0', pkg = '0.2.0', changelog = '## [0.2.0]\n' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-rel-'));
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true });

  const write = (rel, obj) => fs.writeFileSync(path.join(dir, rel), JSON.stringify(obj, null, 2));
  if (plugin !== null) write('.claude-plugin/plugin.json', { name: 'fivem', version: plugin });
  if (marketplace !== null) write('.claude-plugin/marketplace.json', { plugins: [{ name: 'fivem', version: marketplace }] });
  if (pkg !== null) write('mcp/package.json', { name: 'fivem-mcp', version: pkg });
  if (changelog !== null) fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n${changelog}`);
  return dir;
}

describe('the real repository passes its own gate', () => {
  test('manifests agree and the changelog documents the version', () => {
    const r = checkRelease();
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
  });
});

describe('version consistency', () => {
  test('passes when all three agree', () => {
    const r = checkRelease({ root: repo() });
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(r.version, '0.2.0');
  });

  test('fails when the npm package lags the plugin', () => {
    // The nastiest real failure: the marketplace advertises a version npm does not serve.
    const r = checkRelease({ root: repo({ pkg: '0.1.0' }) });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('disagree')), r.errors.join('; '));
  });

  test('fails when the marketplace entry is stale', () => {
    const r = checkRelease({ root: repo({ marketplace: '0.1.0' }) });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('disagree')));
  });

  test('rejects a version that is not semver', () => {
    const r = checkRelease({ root: repo({ plugin: 'v0.2', marketplace: 'v0.2', pkg: 'v0.2' }) });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('not valid semver')));
  });

  test('a missing manifest is an error, not a crash', () => {
    const r = checkRelease({ root: repo({ pkg: null }) });
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].includes('could not read'));
  });
});

describe('the tag must match the code', () => {
  test('accepts a tag that matches, with or without the v', () => {
    for (const tag of ['0.2.0', 'v0.2.0']) {
      assert.equal(checkRelease({ root: repo(), expect: tag }).ok, true, `tag ${tag}`);
    }
  });

  test('refuses a tag that disagrees with the manifests', () => {
    const r = checkRelease({ root: repo(), expect: 'v0.3.0' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('tag says 0.3.0')), r.errors.join('; '));
  });
});

describe('the changelog gate', () => {
  test('accepts both the bracketed and bare heading styles', () => {
    for (const heading of ['## [0.2.0] — 2026-08-10\n', '## 0.2.0\n']) {
      assert.equal(checkRelease({ root: repo({ changelog: heading }) }).ok, true, heading);
    }
  });

  test('refuses to release a version the changelog never mentions', () => {
    const r = checkRelease({ root: repo({ changelog: '## [0.1.0]\n' }) });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('no section for 0.2.0')));
  });

  test('a missing changelog fails rather than being skipped', () => {
    const r = checkRelease({ root: repo({ changelog: null }) });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('CHANGELOG.md is missing')));
  });

  test('a heading for a different version does not satisfy a prefix match', () => {
    // Found by this test: the optional `]` let the version match as a prefix, so a changelog
    // documenting only 0.2.01 or 0.2.0-beta waved through a 0.2.0 release.
    for (const heading of ['## [0.2.01]\n', '## 0.2.0-beta\n', '## [0.2.0.1]\n']) {
      const r = checkRelease({ root: repo({ changelog: heading }) });
      assert.equal(r.ok, false, `"${heading.trim()}" must not satisfy 0.2.0`);
    }
  });
});
