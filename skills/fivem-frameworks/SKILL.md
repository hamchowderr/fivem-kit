---
name: fivem-frameworks
description: Work with any FiveM framework — ox_core, ESX Legacy, QBCore, or Qbox — and migrate between them. Use when a server runs es_extended, qb-core or qbx_core, when code references ESX.GetPlayerFromId, QBCore.Functions.GetPlayer, xPlayer, PlayerData, or exports.qbx_core, when mixing frameworks, or when converting a resource from ESX/QBCore to ox.
---

# FiveM frameworks

Four frameworks matter. Identify which one the server runs **before** writing anything —
the same feature looks completely different in each, and code written for the wrong one
fails at the first call.

Detect with the plugin's script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" <serverPath>
```

Or by hand — look for these resource folders:

| Resource folder present | Framework | Dialect |
|---|---|---|
| `ox_core` | Overextended | ox |
| `es_extended` | ESX Legacy | esx |
| `qb-core` | QBCore | qbcore |
| `qbx_core` | Qbox (modern QB fork) | qbox |
| none, but `ox_lib` present | standalone on ox_lib | ox |

## Entry points — the one line each framework starts with

```lua
-- ox_core
lib.load('@ox_core.lib.init')            -- global Ox

-- ESX Legacy
ESX = exports['es_extended']:getSharedObject()

-- QBCore
local QBCore = exports['qb-core']:GetCoreObject()

-- Qbox — uses ox_lib, and exports directly
local player = exports.qbx_core:GetPlayer(source)
```

Qbox is the important nuance: it is a QBCore fork that **runs on ox_lib and ox_target**,
so `lib.*` is available and idiomatic there. Qbox code looks like a hybrid, and that is
correct rather than a mistake.

## The same operation, four ways

| Task | ox | ESX | QBCore | Qbox |
|---|---|---|---|---|
| get player (server) | `Ox.GetPlayer(src)` | `ESX.GetPlayerFromId(src)` | `QBCore.Functions.GetPlayer(src)` | `exports.qbx_core:GetPlayer(src)` |
| job / group | `player:getGroup('police')` | `xPlayer.getJob()` | `Player.PlayerData.job` | `player.PlayerData.job` |
| set job | `player:set('job', name)` | `xPlayer.setJob(name, grade)` | `Player.Functions.SetJob(name, grade)` | `player.Functions.SetJob(name, grade)` |
| money | `player:getAccount()` | `xPlayer.getMoney()` / `addMoney` | `Player.Functions.GetMoney(type)` / `AddMoney` | same as QBCore |
| identifier | `player.identifier` | `xPlayer.getIdentifier()` | `Player.PlayerData.citizenid` | `player.PlayerData.citizenid` |
| callback | `lib.callback` | `ESX.RegisterServerCallback` | `QBCore.Functions.CreateCallback` | `lib.callback` |
| notify | `lib.notify` | `ESX.ShowNotification` | `QBCore.Functions.Notify` | `lib.notify` |

Details: `references/esx.md`, `references/qbcore.md` (covers Qbox differences).

## Writing for an unknown or mixed server

- **Greenfield with no framework detected → write ox.** It is the cleanest target and
  needs only `ox_lib`.
- **Framework detected → match it.** Do not introduce a second framework into a working
  server; mixed `es_extended` + `qb-core` is a real failure mode that produces duplicate
  player state and money desync.
- **Mixed frameworks already present** — say so plainly and ask which one is authoritative
  before writing. Guessing here corrupts data.
- **Bridge resources** (`qbx_core/bridge`, various `esx-qb` shims) let a resource target
  one framework on a server running another. They are a compatibility layer, not a merge —
  check the bridge actually covers the calls you need.

## Migrating to ox

`references/migration-map.md` is a line-by-line translation table (ESX → ox, QBCore → ox),
plus the traps: money accounts vs. ox accounts, job grades vs. groups, item metadata,
and inventory API differences.

Migration order that works:

1. `oxmysql` first — it is framework-independent and unblocks everything else.
2. `ox_lib` next — swap callbacks, notifications, menus, progress bars.
3. `ox_target` — replace `qb-target` / `qtarget`; the option schema is close.
4. `ox_inventory` — the big one, because item definitions and metadata change shape.
5. `ox_core` last, and only if you really want to leave the framework behind.

Steps 1–3 are safe and reversible on a live server. Steps 4–5 are data migrations — take a
database backup first, and never run them straight onto production.
