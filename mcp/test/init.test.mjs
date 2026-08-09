/**
 * Tests for `/fivem:init`'s write path and the config resolution layer.
 *
 * The init script is the only thing that writes `.claude/fivem.local.md`, so what it produces
 * must survive the hardened reader. Anything else silently disables every hook.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { init, configFromDetection, gitignoreCovers } from '../../scripts/fivem-init.mjs';
import { readConfig, resolveConfig, readUserOptions, DEFAULTS } from '../../scripts/fivem-config.mjs';

/** A directory that detect-stack will recognise as an ox server. */
function oxServer({ framework = 'ox_core', lib = 'ox_lib' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-init-'));
  const res = path.join(dir, 'resources');
  for (const name of [framework, lib].filter(Boolean)) {
    fs.mkdirSync(path.join(res, name), { recursive: true });
    fs.writeFileSync(
      path.join(res, name, 'fxmanifest.lua'),
      "fx_version 'cerulean'\ngame 'gta5'\n"
    );
  }
  fs.writeFileSync(
    path.join(dir, 'server.cfg'),
    `ensure ${lib}\nensure ${framework}\n`
  );
  return dir;
}

/** A directory that only receives the written config. */
function emptyProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-proj-'));
}

describe('init writes a config the hardened reader accepts', () => {
  test('detects an ox server and round-trips through readConfig', () => {
    const server = oxServer();
    const proj = emptyProject();

    const r = init({ serverPath: server, projectDir: proj });
    assert.equal(r.status, 'written', JSON.stringify(r));
    assert.equal(r.config.dialect, 'ox');
    assert.equal(r.config.framework, 'ox_core');
    assert.equal(r.config.lib, 'ox_lib');
    assert.equal(r.config.serverPath, path.resolve(server));

    // Independently re-read: the round-trip inside init() must not be the only proof.
    const back = readConfig(proj);
    assert.equal(back.ok, true);
    assert.equal(back.config.dialect, 'ox');
    assert.deepEqual(back.warnings, [], 'a file we wrote must produce no warnings');
  });

  test('detects a QBCore server as the qbcore dialect', () => {
    const server = oxServer({ framework: 'qb-core', lib: null });
    const r = init({ serverPath: server, projectDir: emptyProject() });
    assert.equal(r.status, 'written');
    assert.equal(r.config.dialect, 'qbcore');
    assert.equal(r.config.framework, 'qb-core');
  });

  test('reports not-found rather than writing a guess', () => {
    const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-none-'));
    const proj = emptyProject();
    const r = init({ serverPath: nowhere, projectDir: proj });
    assert.equal(r.status, 'not-found');
    assert.equal(fs.existsSync(path.join(proj, '.claude', 'fivem.local.md')), false);
  });
});

describe('init does not clobber', () => {
  test('refuses to overwrite an existing config', () => {
    const server = oxServer();
    const proj = emptyProject();
    init({ serverPath: server, projectDir: proj });

    const again = init({ serverPath: server, projectDir: proj });
    assert.equal(again.status, 'exists');
    assert.ok(again.hint.includes('--force'));
  });

  test('--force overwrites', () => {
    const server = oxServer();
    const proj = emptyProject();
    init({ serverPath: server, projectDir: proj });
    const forced = init({ serverPath: server, projectDir: proj, force: true });
    assert.equal(forced.status, 'written');
  });

  test('--dry-run touches nothing', () => {
    const server = oxServer();
    const proj = emptyProject();
    const r = init({ serverPath: server, projectDir: proj, dryRun: true });
    assert.equal(r.status, 'dry-run');
    assert.ok(r.contents.includes("dialect: 'ox'"));
    assert.equal(fs.existsSync(path.join(proj, '.claude')), false);
  });
});

describe('gitignore handling', () => {
  test('recognises patterns that already cover the file', () => {
    assert.equal(gitignoreCovers('node_modules/\n.claude/*.local.md\n'), true);
    assert.equal(gitignoreCovers('*.local.md'), true);
    assert.equal(gitignoreCovers('.claude/'), true);
    assert.equal(gitignoreCovers('node_modules/\n*.log\n'), false);
  });

  test('appends once to an existing .gitignore', () => {
    const server = oxServer();
    const proj = emptyProject();
    fs.writeFileSync(path.join(proj, '.gitignore'), 'node_modules/\n');

    const first = init({ serverPath: server, projectDir: proj });
    assert.equal(first.gitignore.status, 'added');

    const second = init({ serverPath: server, projectDir: proj, force: true });
    assert.equal(second.gitignore.status, 'already-ignored');

    const text = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8');
    assert.equal(text.match(/\.claude\/\*\.local\.md/g).length, 1, 'must not duplicate');
    assert.ok(text.startsWith('node_modules/'), 'must not rewrite what was there');
  });

  test('never creates a .gitignore that does not exist', () => {
    const server = oxServer();
    const proj = emptyProject();
    const r = init({ serverPath: server, projectDir: proj });
    assert.equal(r.gitignore.status, 'absent');
    assert.equal(fs.existsSync(path.join(proj, '.gitignore')), false);
  });
});

describe('configFromDetection', () => {
  test('omits a framework that was not detected', () => {
    const v = configFromDetection({ serverRoot: '/x', dialect: 'standalone', stack: {} });
    assert.equal(v.framework, null);
    assert.equal(v.lib, null);
  });
});

describe('resolveConfig layers user options under the project file', () => {
  const serverA = oxServer();
  const serverB = oxServer();

  test('user options fill gaps the project file leaves', () => {
    const proj = emptyProject();
    fs.mkdirSync(path.join(proj, '.claude'));
    fs.writeFileSync(path.join(proj, '.claude', 'fivem.local.md'), '---\nenabled: true\n---\n');

    const r = resolveConfig({
      projectDir: proj,
      env: {
        CLAUDE_PLUGIN_OPTION_DEFAULT_DIALECT: 'qbox',
        CLAUDE_PLUGIN_OPTION_DEFAULT_SERVER_PATH: serverA,
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.config.dialect, 'qbox');
    assert.equal(r.config.serverPath, path.resolve(serverA));
    assert.deepEqual(r.sources.user.sort(), ['dialect', 'serverPath']);
  });

  test('the project file wins where it sets a value', () => {
    const proj = emptyProject();
    init({ serverPath: serverB, projectDir: proj });

    const r = resolveConfig({
      projectDir: proj,
      env: {
        CLAUDE_PLUGIN_OPTION_DEFAULT_DIALECT: 'esx',
        CLAUDE_PLUGIN_OPTION_DEFAULT_SERVER_PATH: serverA,
      },
    });
    assert.equal(r.config.dialect, 'ox', 'project file describes THIS server');
    assert.equal(r.config.serverPath, path.resolve(serverB));
  });

  test('a user option can supply a value but never activates the plugin', () => {
    const proj = emptyProject(); // no .claude/fivem.local.md at all
    const r = resolveConfig({
      projectDir: proj,
      env: { CLAUDE_PLUGIN_OPTION_DEFAULT_DIALECT: 'ox' },
    });
    assert.equal(r.ok, false, 'an unrelated repo must not start paying for hooks');
    assert.equal(r.found, false);
  });

  test('enabled: false survives the layering', () => {
    const proj = emptyProject();
    fs.mkdirSync(path.join(proj, '.claude'));
    fs.writeFileSync(path.join(proj, '.claude', 'fivem.local.md'), '---\nenabled: false\n---\n');
    const r = resolveConfig({
      projectDir: proj,
      env: { CLAUDE_PLUGIN_OPTION_DEFAULT_DIALECT: 'ox' },
    });
    assert.equal(r.ok, false);
    assert.equal(r.config.enabled, false);
  });

  test('an invalid user option degrades to the default instead of propagating', () => {
    const { options, warnings } = readUserOptions({
      CLAUDE_PLUGIN_OPTION_DEFAULT_DIALECT: 'evil; rm -rf /',
      CLAUDE_PLUGIN_OPTION_DEFAULT_SERVER_PATH: '/tmp/x$(whoami)',
    });
    assert.equal(options.dialect, undefined);
    assert.equal(options.serverPath, undefined);
    assert.ok(warnings.length >= 2);
  });

  test('with no sources at all, every value is the documented default', () => {
    const r = resolveConfig({ projectDir: emptyProject(), env: {} });
    assert.deepEqual(r.config, { ...DEFAULTS });
  });
});
