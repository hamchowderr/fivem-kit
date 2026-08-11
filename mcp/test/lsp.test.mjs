/**
 * Tests for the language-server wiring.
 *
 * The thing under test is a CONFIG GENERATOR, and a wrong config here fails the worst way
 * available: lua-language-server starts, reports no error, and simply knows nothing. There is
 * no exception to catch and no red tick. So these assert the shape of what gets written,
 * including the mistakes actually made on the way to it —
 *
 *   1. putting `${CLAUDE_PLUGIN_DATA}` in `.lsp.json` settings, which Claude Code passes
 *      through verbatim (verified with a probe LSP server), so the server received the literal
 *      string and silently resolved no definitions;
 *   2. excluding `fxmanifest.lua` from analysis to silence its warnings, which also silences
 *      a typo'd `client_scirpts` — a directive that does not error, it just means the script
 *      never loads;
 *   3. pointing a library path into the version-pinned plugin directory, which stops existing
 *      on the next release without lua-language-server ever saying so.
 *
 * `.lsp.json` is covered here because `claude plugin validate` does NOT check it — verified by
 * feeding it a command with spaces and an unknown key and watching validation pass clean.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'fivem-lsp.mjs');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `fivem-lsp-${name}-`));

/** Run the CLI with the addon directory pinned, so a real install on the machine is ignored. */
function run(addons, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, FIVEM_LUA_ADDONS: addons },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Import fresh with FIVEM_LUA_ADDONS applied, since addonsDir() reads it at call time. */
async function load(addons) {
  process.env.FIVEM_LUA_ADDONS = addons;
  return import(`${new URL('../../scripts/fivem-lsp.mjs', import.meta.url).href}?t=${addons}`);
}

/** A stand-in for a cloned fivem-lls-addon, carrying upstream's real settings. */
function fakeAddon(dir) {
  const addon = path.join(dir, 'fivem-lls-addon');
  fs.mkdirSync(path.join(addon, 'library'), { recursive: true });
  fs.writeFileSync(
    path.join(addon, 'config.json'),
    JSON.stringify({
      name: 'CfxLua',
      files: ['fxmanifest.lua'],
      settings: {
        'Lua.runtime.version': 'Lua 5.4',
        'Lua.runtime.nonstandardSymbol': ['/**/', '`', '+='],
        'Lua.workspace.ignoreDir': ['.vscode', '.git', 'node_modules', 'web'],
      },
    })
  );
  return addon;
}

describe('the generated .luarc.json', () => {
  test("carries upstream's settings rather than a copy of them", async () => {
    const addons = tmp('upstream');
    fakeAddon(addons);
    const { luarc } = await load(addons);
    const cfg = luarc();

    // nonstandardSymbol is the one that matters most: CfxLua allows `+=` and backtick
    // strings, and without it the server reports syntax errors on valid FiveM code.
    assert.equal(cfg['Lua.runtime.version'], 'Lua 5.4');
    assert.ok(cfg['Lua.runtime.nonstandardSymbol'].includes('+='));
  });

  test("passes upstream's ignoreDir through, and does NOT exclude manifests", async () => {
    const addons = tmp('ignoredir');
    fakeAddon(addons);
    const { luarc } = await load(addons);
    const ignore = luarc()['Lua.workspace.ignoreDir'];

    assert.ok(ignore.includes('web'), "upstream's own exclusions must survive");
    assert.ok(ignore.includes('node_modules'));

    // Excluding fxmanifest.lua silences the undefined-global warnings on every manifest, and
    // throws away the most valuable check available on that file: a typo'd `client_scripts`
    // does not error, it just means the script never loads. lua/fxmanifest.lua declares the
    // directives instead, so the typo is caught.
    assert.ok(
      !ignore.some((p) => String(p).includes('fxmanifest')),
      'manifests must be analysed, not excluded'
    );
  });

  test('points the library at the installed definitions with a real absolute path', async () => {
    const addons = tmp('library');
    const addon = fakeAddon(addons);
    const { luarc, KIT_LIB } = await load(addons);
    const lib = luarc()['Lua.workspace.library'];

    assert.ok(lib.length >= 2);
    assert.equal(lib[0], path.join(addon, 'library').replace(/\\/g, '/'));
    // Our own manifest definitions, copied OUT of the plugin: the plugin directory is
    // version-pinned, so referencing it in place leaves a dead path after the next release —
    // and lua-language-server ignores a missing library path without complaining.
    assert.equal(lib[1], path.join(addons, KIT_LIB).replace(/\\/g, '/'));
    // The whole reason this file exists rather than .lsp.json settings.
    assert.ok(
      !JSON.stringify(luarc()).includes('${'),
      'no unexpanded variable may reach the config — the language server would take it literally'
    );
  });

  test('loads the definitions directly rather than via addon detection', async () => {
    const addons = tmp('thirdparty');
    fakeAddon(addons);
    const { luarc } = await load(addons);
    // Detection ends in a prompt asking whether to apply the addon, and an agent session has
    // nobody to answer it.
    assert.equal(luarc()['Lua.workspace.checkThirdParty'], 'Disable');
  });

  test('adds ox_lib and ox_core when a server path is given', async () => {
    const addons = tmp('oxlibs');
    fakeAddon(addons);
    const server = tmp('server');
    fs.mkdirSync(path.join(server, 'resources', '[core]', 'ox_lib'), { recursive: true });
    fs.mkdirSync(path.join(server, 'resources', '[core]', 'ox_core'), { recursive: true });
    fs.mkdirSync(path.join(server, 'resources', 'some_other_resource'), { recursive: true });

    const { luarc } = await load(addons);
    const lib = luarc(server)['Lua.workspace.library'].join('\n');

    assert.match(lib, /ox_lib/);
    assert.match(lib, /ox_core/);
    assert.doesNotMatch(lib, /some_other_resource/, 'only definition-bearing resources belong');
  });
});

describe('.lsp.json', () => {
  /**
   * `claude plugin validate` does NOT check this file. Verified by putting a command with
   * spaces and an unknown key in it — both of which Claude Code's own schema rejects — and
   * watching validation pass clean. So the only thing standing between a typo here and a
   * silent runtime failure ("Failed to load LSP server configuration", printed where nobody
   * is looking) is this test.
   *
   * The rules are the real ones, read out of the Claude Code binary's zod schema:
   *
   *   strictObject({ command: string().min(1).refine(no spaces unless absolute),
   *                  args?, extensionToLanguage: record (>=1), transport?: 'stdio'|'socket',
   *                  env?, initializationOptions?, settings?, workspaceFolder?,
   *                  startupTimeout?, shutdownTimeout?, restartOnCrash?, maxRestarts?,
   *                  diagnostics? })
   */
  const KNOWN_KEYS = new Set([
    'command', 'args', 'extensionToLanguage', 'transport', 'env', 'initializationOptions',
    'settings', 'workspaceFolder', 'startupTimeout', 'shutdownTimeout', 'restartOnCrash',
    'maxRestarts', 'diagnostics',
  ]);

  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.lsp.json'), 'utf8'));

  test('declares at least one server, each with the two required fields', () => {
    const names = Object.keys(config);
    assert.ok(names.length > 0);
    for (const name of names) {
      assert.equal(typeof config[name].command, 'string');
      assert.ok(config[name].command.length > 0, `${name}: command is required`);
      const map = config[name].extensionToLanguage;
      assert.ok(map && Object.keys(map).length > 0, `${name}: extensionToLanguage needs an entry`);
    }
  });

  test('uses no key the schema would reject', () => {
    // The schema is a strictObject, so one unknown key rejects the whole file and the LSP
    // never starts — for every server in it, not just the one with the typo.
    for (const [name, server] of Object.entries(config)) {
      for (const key of Object.keys(server)) {
        assert.ok(KNOWN_KEYS.has(key), `${name}: "${key}" is not in the schema`);
      }
    }
  });

  test('has no spaces in any command', () => {
    for (const [name, server] of Object.entries(config)) {
      assert.ok(
        !server.command.includes(' ') || server.command.startsWith('/'),
        `${name}: put arguments in args[], not in the command`
      );
    }
  });

  test('carries no settings, because settings are not interpolated', () => {
    // The finding that shaped this whole design: `command` and `args` have
    // ${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_DATA} expanded, `settings` are forwarded verbatim.
    // A path here would reach lua-language-server as a literal "${...}" string and resolve
    // nothing, with no error anywhere. Paths belong in .luarc.json.
    for (const [name, server] of Object.entries(config)) {
      assert.equal(server.settings, undefined, `${name}: paths belong in .luarc.json`);
    }
  });
});

describe('the manifest definitions', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lua', 'fxmanifest.lua'), 'utf8');
  const declared = new Set([...src.matchAll(/^function\s+([a-z_][a-z_0-9]*)\s*\(/gm)].map((m) => m[1]));

  test('declare the directives real manifests actually use', () => {
    // Every one of these was observed across 75 real fxmanifest.lua files in the ox stack,
    // ESX, QBCore, Qbox and qb-scripts. The plural script forms are the ones that matter most
    // and appear NOWHERE in the official reference — client_scripts is in 58 of the 75, so
    // deriving this list from the docs alone would warn on almost every manifest in existence.
    for (const d of [
      'fx_version', 'game', 'lua54',
      'client_script', 'client_scripts',
      'server_script', 'server_scripts',
      'shared_script', 'shared_scripts',
      'files', 'file', 'ui_page', 'dependency', 'dependencies',
      'export', 'exports', 'server_export', 'server_exports',
      'data_file', 'provide', 'escrow_ignore',
      'name', 'version', 'author', 'description', 'repository', 'license',
      'legacyversion', 'ox_libs',
    ]) {
      assert.ok(declared.has(d), `${d} must be declared or every manifest using it warns`);
    }
  });

  test('are a ---@meta file, so they define types without becoming a runtime dependency', () => {
    assert.match(src, /^---@meta/m);
  });
});

describe('status', () => {
  test('reports not-ready when nothing is installed, and does not throw', () => {
    const addons = tmp('empty');
    const project = tmp('project');
    const r = run(addons, 'status', '--project', project, '--json');
    assert.equal(r.status, 0, 'status must never fail — /fivem:doctor calls it');

    const s = JSON.parse(r.out);
    assert.equal(s.addon.installed, false);
    assert.equal(s.luarc.state, 'missing');
    assert.equal(s.ready, false);
  });

  test('distinguishes a .luarc.json that exists from one that is actually wired', () => {
    const addons = tmp('unwired');
    const project = tmp('unwired-project');
    // Someone's own Lua config, nothing to do with FiveM.
    fs.writeFileSync(
      path.join(project, '.luarc.json'),
      JSON.stringify({ 'Lua.workspace.library': ['/somewhere/else'] })
    );

    const s = JSON.parse(run(addons, 'status', '--project', project, '--json').out);
    assert.equal(s.luarc.state, 'present', 'present but not pointing at the definitions');
    assert.equal(s.ready, false);
  });

  test('survives a corrupt .luarc.json rather than crashing the doctor', () => {
    const addons = tmp('corrupt');
    const project = tmp('corrupt-project');
    fs.writeFileSync(path.join(project, '.luarc.json'), '{ not json');

    const r = run(addons, 'status', '--project', project, '--json');
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.out).luarc.state, 'unreadable');
  });
});
