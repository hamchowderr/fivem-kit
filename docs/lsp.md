# Language server support

`/fivem:lsp` wires [lua-language-server](https://luals.github.io/) up to FiveM, so Lua edits
are checked against the real signatures of every native rather than against regexes.

This file exists because the design is not the obvious one, and `.lsp.json` is JSON and cannot
explain itself.

## The three moving parts

| Part | Where | Installed by |
|---|---|---|
| `lua-language-server` | your PATH | you — the plugin cannot install a binary |
| FiveM type definitions | `<data dir>/fivem-kit/lua-addons/fivem-lls-addon` | `/fivem:lsp` |
| `.luarc.json` | your project root | `/fivem:lsp` |

`node scripts/fivem-lsp.mjs status` reports all three. `ready` is true only when every one is
satisfied.

The definitions are [overextended/fivem-lls-addon](https://github.com/overextended/fivem-lls-addon),
MIT-licensed, cloned rather than vendored so they track upstream.

## Why the plugin's `.lsp.json` carries no settings

The obvious design is to put everything in `.lsp.json`:

```json
{
  "cfxlua": {
    "command": "lua-language-server",
    "extensionToLanguage": { ".lua": "lua" },
    "settings": {
      "Lua.workspace.userThirdParty": ["${CLAUDE_PLUGIN_DATA}/lua-addons"]
    }
  }
}
```

**That does not work, and it fails silently.**

Verified with a probe LSP server that logged every message Claude Code sent it: `command` and
`args` have `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` expanded before the server
starts, but `settings` are forwarded **verbatim** over `workspace/didChangeConfiguration`. The
language server receives the literal string `"${CLAUDE_PLUGIN_DATA}/lua-addons"`, looks for a
directory of that name, does not find one, and reports nothing at all. You get an LSP that
starts cleanly, logs no error, and knows no FiveM natives.

So every path lives in `.luarc.json`, written with real absolute paths. That file is also what
your own editor reads, so VS Code gets the same intelligence without a second configuration.

`.lsp.json` therefore holds only what needs no interpolation: the command and the extension
mapping. One owner for the settings means the two can never disagree.

## Why `checkThirdParty` is `Disable`

lua-language-server has an addon system: point `Lua.workspace.userThirdParty` at a directory,
and when it detects a matching project — the FiveM addon declares `files: ["fxmanifest.lua"]` —
it offers to apply that addon's settings.

*Offers.* The default `Ask` raises a prompt, and an agent session has nobody to answer it.

So the definitions are loaded outright through `Lua.workspace.library` instead, and detection
is switched off. Deterministic, and needs no answer. Upstream's own settings are not lost —
`setup` reads them out of the addon's `config.json` and merges them into `.luarc.json`, so a
change upstream still reaches you.

The most important of those settings is `Lua.runtime.nonstandardSymbol`. CfxLua accepts `+=`,
backtick strings and `/* */` comments, none of which are Lua. Without them declared, the server
reports syntax errors on perfectly valid FiveM code.

## Why manifests are excluded from analysis

`.luarc.json` adds `**/fxmanifest.lua` and `**/__resource.lua` to `Lua.workspace.ignoreDir`.

A manifest is Lua syntax but not Lua — the server evaluates it in its own global environment,
so `fx_version`, `game` and `client_script` all read as undefined globals. That is three
warnings on a file every single resource has, which is how diagnostics end up switched off
entirely.

The obvious fix — listing the directives in `Lua.diagnostics.globals` — cannot work. A manifest
may declare **arbitrary** metadata keys, readable at runtime through `GetResourceMetadata`.
Scanning 76 real manifests across ox, the frameworks and qb-scripts turned up `legacyversion`,
`chat_theme`, `my_data` and `pizza_topping` sitting alongside the real directives. Any
enumerated list is incomplete by construction, and would flag someone's own metadata as an
error.

Nothing is lost. Manifests are already validated by this plugin against the actual manifest
rules: a `PreToolUse` hook checks one before it is written, and `fivem-manifest-doctor` audits
them. See [hooks.md](hooks.md).

Note that the merge into `ignoreDir` is a merge, not a replacement — upstream excludes `web`,
which is where every ox resource keeps its NUI build.

## Verifying it works

```lua
local ped = PlayerPedId()
SetEntityCoords(ped, 1.0, 2.0, 3.0, false, false, false, false)
SetEntityCoodrs(ped, 1.0, 2.0, 3.0)
```

The third line should produce `Undefined global 'SetEntityCoodrs'`. The first two should
produce nothing — if they are also flagged, the definitions are not loading.

You can check without an editor at all:

```bash
lua-language-server --check <project> --checklevel=Information
```

## If nothing appears

1. `node scripts/fivem-lsp.mjs status` — all three parts must be satisfied, and `.luarc.json`
   must read `wired` rather than `present`.
2. The session must have been restarted, or `/reload-plugins` run, since setup. The language
   server is started on the first `.lua` **edit**; a read will not start it.
3. `.luarc.json` must be in the folder Claude Code opened, not a subfolder of it.

## Notes

- `.luarc.json` contains absolute paths from one machine. Upstream's advice is to gitignore it
  and commit a `.luarc.default.json` for other contributors.
- Re-running `/fivem:lsp` is safe: it advances the definitions to the current upstream commit
  and rewrites `.luarc.json`.
- The definitions live outside the plugin directory because a plugin update replaces that
  directory. `FIVEM_LUA_ADDONS` overrides the location.
