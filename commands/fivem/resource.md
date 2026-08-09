---
description: Scaffold a new FiveM resource matched to the server's actual framework
argument-hint: <resource name> [what it should do]
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

Scaffold a new FiveM resource: **$ARGUMENTS**

## 1. Detect the target stack first

Run the detector before writing anything:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" --json
```

If it reports no server, ask where the server folder is (the one containing `resources/`)
rather than guessing. If it reports `mixedFrameworks: true`, ask which framework is
authoritative before continuing.

Write for the reported `dialect`:

| dialect | write |
|---|---|
| `ox` | ox_lib + ox_core, `exports.ox_target`, `exports.ox_inventory` |
| `esx` | `ESX = exports['es_extended']:getSharedObject()`, `xPlayer.*` (dot syntax) |
| `qbcore` | `exports['qb-core']:GetCoreObject()`, `Player.Functions.*` |
| `qbox` | `exports.qbx_core:GetPlayer()` for players, ox_lib + ox_target for everything else |
| `standalone` | plain FiveM, ox_lib if present |

Load the matching skill for the API details — `ox-stack` or `fivem-frameworks`.

## 2. Create the resource

Place it under `resources/[local]/<name>/` unless the server has an obvious convention —
match the sibling folders you can see.

Structure:

```
<name>/
├── fxmanifest.lua
├── config.lua          (if it has any tunable values)
├── client/main.lua
├── server/main.lua
└── locales/en.json     (only if using lib.locale)
```

Rules for the manifest:

- `fx_version 'cerulean'`, `game 'gta5'`, `lua54 'yes'`, plus `name`/`author`/`version`/`description`
- `shared_script '@ox_lib/init.lua'` when ox_lib is present
- `'@oxmysql/lib/MySQL.lua'` **first** in `server_scripts` when the resource uses SQL
- declare every dependency in `dependencies { ... }`
- list every NUI asset in `files { ... }`
- config listed before the scripts that read it

## 3. Write the code to the standard, not to the tutorial

Every server-side handler must:

- capture `local src = source` on the first line
- validate every parameter against server-side config — never trust a name, id, price,
  amount or position from the client
- look prices and rewards up server-side; the client names *what*, never *how much*
- distance-check location-bound actions
- re-check job/group and item requirements server-side even when the UI already gated them
- use `?` placeholders in every SQL query

Client-side: no `while true do` without a `Wait`, use `cache.*` over per-tick natives, and
prefer ox_lib wrappers where they exist.

The `ox-stack` skill's `references/patterns.md` has complete worked examples in this style —
follow them rather than inventing a shape.

## 4. Finish

- If the resource needs SQL, write the `.sql` file and say so explicitly; do not run it.
- Print the exact `ensure <name>` line to add to `server.cfg`, and where it must sit in the
  load order relative to its dependencies.
- Run `/fivem:audit <path>` over what you just wrote and fix anything it finds.
- Do not start, restart, or deploy anything to a live server.
