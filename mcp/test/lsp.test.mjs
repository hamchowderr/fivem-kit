/**
 * Tests for the language-server wiring.
 *
 * The thing under test is a CONFIG GENERATOR, and a wrong config here fails the worst way
 * available: lua-language-server starts, reports no error, and simply knows nothing. There is
 * no exception to catch and no red tick. So these assert the shape of what gets written,
 * including the two mistakes that were actually made on the way to it —
 *
 *   1. putting `${CLAUDE_PLUGIN_DATA}` in `.lsp.json` settings, which Claude Code passes
 *      through verbatim (verified with a probe LSP server), so the server received the literal
 *      string and silently resolved no definitions;
 *   2. overwriting upstream's `Lua.workspace.ignoreDir` instead of merging into it, which
 *      drops `web` — the folder every ox resource keeps its NUI build in.
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

  test("merges into upstream's ignoreDir instead of replacing it", async () => {
    const addons = tmp('ignoredir');
    fakeAddon(addons);
    const { luarc } = await load(addons);
    const ignore = luarc()['Lua.workspace.ignoreDir'];

    assert.ok(ignore.includes('web'), "upstream's own exclusions must survive");
    assert.ok(ignore.includes('node_modules'));
    // Manifests are excluded rather than declared: a manifest may define arbitrary metadata
    // keys, so no list of known globals can ever be complete.
    assert.ok(ignore.includes('**/fxmanifest.lua'));
    assert.ok(ignore.includes('**/__resource.lua'));
  });

  test('points the library at the installed definitions with a real absolute path', async () => {
    const addons = tmp('library');
    const addon = fakeAddon(addons);
    const { luarc } = await load(addons);
    const lib = luarc()['Lua.workspace.library'];

    assert.ok(lib.length >= 1);
    assert.equal(lib[0], path.join(addon, 'library').replace(/\\/g, '/'));
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
