# Language server support

`/fivem:lsp` wires [lua-language-server](https://luals.github.io/) up to FiveM, so Lua edits
are checked against the real signatures of every native rather than against regexes.

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

The default `Ask` raises a prompt, and an agent session has nobody to answer it.

So the definitions are loaded outright through `Lua.workspace.library` instead, and detection
is switched off. Upstream's own settings are not lost —
`setup` reads them out of the addon's `config.json` and merges them into `.luarc.json`, so a
change upstream still reaches you.

The most important of those settings is `Lua.runtime.nonstandardSymbol`. CfxLua accepts `+=`,
backtick strings and `/* */` comments, none of which are Lua. Without them declared, the server
reports syntax errors on perfectly valid FiveM code.

## Manifests: declared, not excluded

A manifest is Lua syntax but not Lua — the server evaluates `fxmanifest.lua` in its own global
environment, so `fx_version`, `game` and `client_scripts` all read as undefined globals. That is
three or more warnings on a file every single resource has, which is how diagnostics end up
switched off entirely.

The quick fix is to add `**/fxmanifest.lua` to `Lua.workspace.ignoreDir`. It works, and it
throws away the check most worth having on that file:

```lua
client_scirpts { 'client.lua' }   -- typo. No error. The script simply never loads.
```

A misspelled directive is not a syntax error and does not fail the resource — it means the
script is silently not there, and the resource then breaks somewhere else entirely. Catching
that is precisely what this plugin is for, so manifests are **analysed**, and the directives
are declared in `lua/fxmanifest.lua` instead.

The declarations come from two sources, neither of them guesswork:

1. **citizenfx/fivem-docs**, `scripting-reference/resource-manifest` — the documented set.
2. **Every directive observed in 75 real `fxmanifest.lua` files** across the ox stack, ESX,
   QBCore, Qbox and qb-scripts.

The second source is not optional. The plural script forms appear **nowhere** in the official
reference, and `client_scripts` is used by 58 of those 75 manifests — deriving the list from
the docs alone would warn on nearly every manifest in existence. `legacyversion`, an ox
convention used by 33 of them, is undocumented too.

### The residual

A manifest may declare **arbitrary** metadata, readable at runtime via `GetResourceMetadata`.
Anything bespoke and unlisted is still reported as an undefined global. Measured on a manifest
using twelve real directives plus one typo and one bespoke key:

| | |
|---|---|
| 12 real directives, including `legacyversion` | silent |
| `client_scirpts` (typo) | **caught** |
| `pizza_topping` (bespoke metadata) | warns |

To silence one, add it to your `.luarc.json`:

```json
{ "Lua.diagnostics.globals": ["pizza_topping"] }
```

Manifests are *also* validated properly elsewhere, against the real manifest rules rather than
Lua's: a `PreToolUse` hook checks one before it is written, and `fivem-manifest-doctor` audits
them. See [hooks.md](hooks.md).

### Why the definitions are copied

`lua/fxmanifest.lua` is copied into the data directory at setup rather than referenced inside
the plugin. The plugin directory is version-pinned — `.../cache/fivem/fivem/0.2.0/lua` becomes
`0.3.0` on the next release — and lua-language-server does **not** complain about a library
path that has stopped existing. It just quietly stops loading it, and manifests start warning
again weeks later for no visible reason.

## Verifying it works

<!-- verify-docs: allow SetEntityCoodrs -->
The misspelling below is deliberate — it is what the diagnostic is supposed to catch.

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
