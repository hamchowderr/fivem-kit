#!/usr/bin/env node
/**
 * Wire lua-language-server up to FiveM, so Lua gets REAL diagnostics.
 *
 * The audit rules in this plugin are regexes. They are good at the things regexes are good at
 * — an unvalidated net event, a hardcoded webhook — and structurally incapable of knowing that
 * `SetEntityCoodrs` is a typo or that a native takes four arguments rather than three. A
 * language server knows both, because it has the type definitions.
 *
 * Overextended publish those definitions as `fivem-lls-addon`. This script installs them and
 * writes the project `.luarc.json` that points at them.
 *
 *   node scripts/fivem-lsp.mjs status [--json]
 *   node scripts/fivem-lsp.mjs setup [serverPath] [--project <dir>] [--json]
 *
 * WHY .luarc.json AND NOT .lsp.json
 *
 * The plugin's `.lsp.json` can carry a `settings` block, and the obvious design is to put the
 * addon path there as `${CLAUDE_PLUGIN_DATA}/lua-addons`. That does not work, and it fails
 * silently, which is worse.
 *
 * Verified against a probe LSP server that logged what it actually received: Claude Code
 * expands `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` in `command`/`args`, but passes
 * `settings` through VERBATIM. The server receives the literal string
 * "${CLAUDE_PLUGIN_DATA}/lua-addons" over workspace/didChangeConfiguration. lua-language-server
 * then looks for a directory of that name, does not find one, and says nothing at all — you get
 * an LSP that starts, reports no error, and knows no FiveM natives.
 *
 * So the paths live in `.luarc.json`, written here with real absolute paths. That file is also
 * what the developer's own editor reads, so their VS Code gets the same intelligence for free.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sync as syncRepo } from './update-sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');

/** Our own definitions, copied next to the upstream ones — see KIT_LIB below. */
export const KIT_LIB = 'fivem-kit-defs';

export const ADDON_REPO = 'https://github.com/overextended/fivem-lls-addon';
export const ADDON_NAME = 'fivem-lls-addon';

/**
 * Where the type definitions live.
 *
 * ONE location, resolved identically wherever this script is called from. It deliberately does
 * NOT read `CLAUDE_PLUGIN_DATA`, even though the plugin sets it: that variable is present for
 * hooks but not necessarily for a skill's shell, so honouring it would let `setup` and `status`
 * resolve to different directories and disagree about whether the addon is installed.
 *
 * Outside the plugin directory, because a plugin update replaces that directory and
 * re-cloning ~40MB of definitions on every update is not free.
 */
export function addonsDir() {
  if (process.env.FIVEM_LUA_ADDONS) return path.resolve(process.env.FIVEM_LUA_ADDONS);
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'fivem-kit', 'lua-addons');
}

const addonPath = () => path.join(addonsDir(), ADDON_NAME);

/** Is lua-language-server on PATH, and which version? */
export function lslStatus() {
  const r = spawnSync('lua-language-server', ['--version'], {
    encoding: 'utf8',
    timeout: 20_000,
    shell: false,
  });
  if (r.error || r.status !== 0) return { installed: false };
  return { installed: true, version: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')[0] };
}

/**
 * The addon's own settings, read from its config.json rather than copied into this file.
 *
 * `Lua.runtime.nonstandardSymbol` is the interesting one: CfxLua accepts `+=`, `/**\/` comments
 * and backtick strings, none of which are Lua. Without those declared, the language server
 * reports a syntax error on perfectly valid FiveM code — which is a fast way to make someone
 * turn the whole thing off. Reading them from upstream means a change there reaches users
 * without an edit here.
 */
export function addonSettings(dir = addonPath()) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    return cfg.settings && typeof cfg.settings === 'object' ? cfg.settings : {};
  } catch {
    return {};
  }
}

/** Resource directories worth putting on the library path, if a server was detected. */
function libraryPaths(serverPath) {
  // Upstream's native definitions, then ours for the manifest directives they do not cover.
  const out = [path.join(addonPath(), 'library'), path.join(addonsDir(), KIT_LIB)];
  if (!serverPath) return out;

  const resources = path.join(serverPath, 'resources');
  if (!fs.existsSync(resources)) return out;

  // ox_lib and ox_core ship their own Lua annotations; adding them means `lib.callback` and
  // `Ox.GetPlayer` resolve too, not just natives. Everything else in a server is a consumer
  // rather than a definition, and loading a whole server of resources would make startup
  // crawl for no benefit.
  const wanted = new Set(['ox_lib', 'ox_core']);
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (wanted.has(e.name)) out.push(path.join(dir, e.name));
      else if (e.name.startsWith('[') || depth < 2) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(resources);
  return out;
}

/**
 * Install our own Lua definitions beside the upstream ones.
 *
 * They are COPIED out of the plugin rather than referenced in place, because the plugin
 * directory is version-pinned — `.../plugins/cache/fivem/fivem/0.2.0/lua` becomes `0.3.0` on
 * the next release and the old path stops existing. lua-language-server does not complain
 * about a library path that is not there; it just silently stops loading it, and manifests
 * quietly start warning again weeks later. Copying to the stable data directory means the
 * path in `.luarc.json` keeps resolving.
 */
function installKitDefs() {
  const src = path.join(PLUGIN_ROOT, 'lua');
  const dest = path.join(addonsDir(), KIT_LIB);
  if (!fs.existsSync(src)) return { ok: false, dest };
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f.endsWith('.lua')) fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
  return { ok: true, dest };
}

/** Build the .luarc.json contents. Separated from writing so it can be asserted in tests. */
export function luarc(serverPath) {
  const upstream = addonSettings();
  return {
    $schema: 'https://raw.githubusercontent.com/LuaLS/vscode-lua/master/setting/schema.json',
    // Upstream's settings first, ours second.
    ...upstream,
    // ignoreDir is passed through untouched. It was briefly used to exclude fxmanifest.lua
    // from analysis, which silenced the undefined-global warnings on every manifest and threw
    // away the most valuable check available on that file: a typo'd `client_scripts` does not
    // error, it just means the script never loads. `lua/fxmanifest.lua` declares the
    // directives instead, so the typo is caught and the real ones get hover and completion.
    'Lua.workspace.ignoreDir': upstream['Lua.workspace.ignoreDir'] || [],
    'Lua.workspace.library': libraryPaths(serverPath).map((p) => p.replace(/\\/g, '/')),
    // The definitions are loaded directly through workspace.library above, rather than through
    // lua-language-server's third-party addon DETECTION. Detection would need to match
    // fxmanifest.lua somewhere in the workspace and then ask the user whether to apply it —
    // and there is nobody to answer a prompt in an agent session. Loading the library outright
    // is deterministic and needs no answer.
    'Lua.workspace.checkThirdParty': 'Disable',
  };
}

export function status(projectDir = process.cwd()) {
  const dir = addonPath();
  // Once. Spawning lua-language-server twice to answer one question is a needless ~200ms on
  // a path that /fivem:doctor calls.
  const server = lslStatus();
  const installed = fs.existsSync(path.join(dir, 'config.json'));
  // Checked separately from the addon: these are copied out of the plugin rather than cloned,
  // so they can be absent while the addon is fine — and `ready` claiming true while manifests
  // warn on every resource is the sort of half-truth this project keeps removing.
  const defsInstalled = fs.existsSync(path.join(addonsDir(), KIT_LIB, 'fxmanifest.lua'));
  const luarcPath = path.join(projectDir, '.luarc.json');

  let luarcState = 'missing';
  if (fs.existsSync(luarcPath)) {
    try {
      const current = JSON.parse(fs.readFileSync(luarcPath, 'utf8'));
      const lib = current['Lua.workspace.library'] || current.workspace?.library || [];
      luarcState = lib.some((p) => String(p).includes(ADDON_NAME)) ? 'wired' : 'present';
    } catch {
      luarcState = 'unreadable';
    }
  }

  return {
    server,
    addon: { installed, dir },
    manifestDefs: { installed: defsInstalled, dir: path.join(addonsDir(), KIT_LIB) },
    luarc: { state: luarcState, path: luarcPath },
    ready: server.installed && installed && defsInstalled && luarcState === 'wired',
  };
}

export function setup({ serverPath, projectDir = process.cwd() } = {}) {
  fs.mkdirSync(addonsDir(), { recursive: true });
  const result = syncRepo(ADDON_NAME, ADDON_REPO, addonPath());
  if (result.action === 'failed') {
    return { ok: false, step: 'addon', error: result.error };
  }

  const defs = installKitDefs();
  const config = luarc(serverPath);
  const luarcPath = path.join(projectDir, '.luarc.json');
  fs.writeFileSync(luarcPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return { ok: true, addon: result, defs, luarc: luarcPath, config, server: lslStatus() };
}

/* ------------------------------------------------------------------ cli ---- */

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const cmd = argv.find((a) => !a.startsWith('--')) || 'status';
  const projectFlag = argv.indexOf('--project');
  const projectDir = projectFlag === -1 ? process.cwd() : path.resolve(argv[projectFlag + 1]);
  const positional = argv.filter((a) => !a.startsWith('--'));
  const serverPath = positional[1] ? path.resolve(positional[1]) : undefined;

  if (cmd === 'setup') {
    const r = setup({ serverPath, projectDir });
    if (json) return console.log(JSON.stringify(r, null, 2));

    if (!r.ok) {
      console.error(`Could not install the type definitions: ${r.error}`);
      process.exit(1);
    }
    console.log(`Type definitions  ${r.addon.action}  ${addonPath()}`);
    console.log(
      `Manifest defs     ${r.defs.ok ? 'installed' : 'MISSING from the plugin'}  ${r.defs.dest}`
    );
    console.log(`Wrote             ${r.luarc}`);
    console.log(
      `                  ${(r.config['Lua.workspace.library'] || []).length} library path(s)`
    );
    console.log(
      r.server.installed
        ? `lua-language-server  ${r.server.version}`
        : 'lua-language-server  NOT on PATH — diagnostics stay off until it is installed.\n' +
            '                     https://luals.github.io/#install  (or: winget install LuaLS.lua-language-server)'
    );
    // Nothing else is needed: the plugin's .lsp.json already tells Claude Code to start
    // lua-language-server for .lua files, and it reads .luarc.json from the project root.
    return;
  }

  const s = status(projectDir);
  if (json) return console.log(JSON.stringify(s, null, 2));

  console.log(`lua-language-server  ${s.server.installed ? s.server.version : 'not on PATH'}`);
  console.log(`type definitions     ${s.addon.installed ? s.addon.dir : 'not installed'}`);
  console.log(
    `manifest defs        ${s.manifestDefs.installed ? s.manifestDefs.dir : 'not installed'}`
  );
  console.log(`.luarc.json          ${s.luarc.state}  (${s.luarc.path})`);
  console.log(
    s.ready
      ? '\nLSP is fully wired — Lua edits get real diagnostics.'
      : '\nNot wired yet. Run: node scripts/fivem-lsp.mjs setup <serverPath>'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
