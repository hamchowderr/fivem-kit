---
name: lsp
description: >
  Wire lua-language-server up to FiveM so Lua edits get real diagnostics — undefined natives,
  wrong argument counts, wrong types — instead of regex guesses. Installs Overextended's FiveM
  type definitions and writes a project .luarc.json that your own editor reads too. Use when
  the user says "set up the LSP", "why isn't it catching typos in natives", "enable
  diagnostics", "lua language server", or asks for stronger checking than the audit rules give.
argument-hint: "[server path]"
allowed-tools: Bash, Read
---

Set up FiveM language-server support for: **$ARGUMENTS**

## What this adds

The `/fivem:audit` checks read the text of a file — SQL injection, a hardcoded webhook, an
ungated command. They cannot know that `SetEntityCoodrs` is a typo, or that a native takes four
arguments and got three. A language server knows both,
because it has the type definitions for all ~7,300 natives.

Once this is set up, those diagnostics arrive automatically after every Lua edit — no command
to run.

## 1. Check what is already there

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fivem-lsp.mjs" status --json
```

## 2. lua-language-server must be on PATH

If `status` reports it is not installed, that is the one thing this plugin cannot do for the
user. Give them the command for their platform and stop — everything else here is pointless
without it:

| Platform | Install |
|---|---|
| Windows | `winget install LuaLS.lua-language-server` |
| macOS | `brew install lua-language-server` |
| Arch | `pacman -S lua-language-server` |
| Anything | Release binaries: <https://github.com/LuaLS/lua-language-server/releases> |

Whatever they use, `lua-language-server` has to resolve on PATH — the plugin starts it by
bare name. Confirm with `lua-language-server --version` before continuing.

## 3. Install the definitions and write .luarc.json

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fivem-lsp.mjs" setup <serverPath>
```

`<serverPath>` is the folder containing `resources/` — pass it if known, omit it if not. With
it, `ox_lib` and `ox_core` are added to the library path as well, so `lib.callback` and
`Ox.GetPlayer` resolve too, not just natives.

This clones **overextended/fivem-lls-addon** into a shared directory outside the plugin (so a
plugin update does not throw it away) and writes `.luarc.json` in the project.

## 4. Restart the session

The language server is started from the plugin's `.lsp.json` when a `.lua` file is edited.
A session already running has already made that decision, so tell the user to restart Claude
Code — or run `/reload-plugins` — before expecting diagnostics.

## 5. Suggest gitignoring `.luarc.json`

It contains absolute paths from this machine, so it is not portable. Upstream's own advice is
to gitignore it and commit a `.luarc.default.json` for other contributors.

## What good looks like

Editing a resource Lua file with a misspelled native should now produce a diagnostic naming
the undefined global. If nothing appears:

- `node "${CLAUDE_PLUGIN_ROOT}/scripts/fivem-lsp.mjs" status` — all three lines must be
  satisfied, and `.luarc.json` must read `wired`, not `present`.
- The session must have been restarted since setup.
- `.luarc.json` must be in the folder Claude Code opened, not a subfolder.

## Notes worth knowing

- **The addon's own settings come from upstream**, read out of its `config.json` at setup
  rather than copied into this plugin. That matters most for
  `Lua.runtime.nonstandardSymbol`: CfxLua allows `+=`, backtick strings and `/* */` comments,
  none of which are Lua. Without those declared, the server reports syntax errors on
  perfectly valid FiveM code.
- **`checkThirdParty` is set to `Disable` deliberately.** The definitions are loaded directly
  through `Lua.workspace.library`. The alternative — lua-language-server's addon *detection* —
  ends in a prompt asking whether to apply the addon, and there is nobody to answer a prompt
  in an agent session.
- **Manifests are analysed, not excluded.** `lua/fxmanifest.lua` declares the directives, so a
  typo'd `client_scirpts` — which does not error, it just means the script never loads — is
  caught. A manifest may also declare arbitrary metadata; anything bespoke still warns, and is
  silenced by adding it to `Lua.diagnostics.globals` in `.luarc.json`. See `docs/lsp.md`.
- Re-running `setup` is safe. It advances the definitions to the current upstream commit and
  rewrites `.luarc.json`.
