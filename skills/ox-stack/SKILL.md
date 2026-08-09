---
name: ox-stack
description: Build FiveM resources on the Overextended (ox) stack — ox_lib, ox_core, ox_target, ox_inventory, oxmysql. Use when writing or reviewing FiveM Lua that uses lib.callback, lib.zones, lib.progressBar, lib.registerContext, lib.notify, Ox.GetPlayer, exports.ox_target, exports.ox_inventory, or oxmysql; when scaffolding a new ox resource; or when deciding which ox API replaces a raw FiveM native. Real verified APIs, not guessed ones.
---

# The ox (Overextended) stack

ox is a layered replacement for hand-rolled FiveM boilerplate. Write against ox APIs
rather than raw natives wherever an ox equivalent exists — they handle timeouts,
cleanup, and edge cases that hand-written versions almost always miss.

```
Layer 3: your resource
   ↓ uses
Layer 2: ox_lib · ox_core · ox_target · ox_inventory   (oxmysql for SQL)
   ↓ wraps
Layer 1: raw FiveM runtime (Citizen.*, events, natives)
```

## Dependency order

`ox_lib` has no dependencies and is the foundation. Everything else needs it:

| Resource | Depends on |
|---|---|
| `ox_lib` | — |
| `ox_core` | ox_lib |
| `ox_target` | ox_lib |
| `ox_inventory` | ox_lib, oxmysql |
| your resource | ox_lib + whichever ox_* you use |

Load order in `server.cfg` must follow this. `ox_lib` and `oxmysql` start first.

## Standard resource bootstrap

```lua
-- fxmanifest.lua
fx_version 'cerulean'
game 'gta5'
lua54 'yes'

shared_scripts { '@ox_lib/init.lua' }
client_scripts { 'client/*.lua' }
server_scripts { 'server/*.lua' }
```

`@ox_lib/init.lua` in `shared_scripts` is what makes the global `lib` exist. Without
it, every `lib.*` call is a nil index. If the resource also uses ox_core, add
`lib.load('@ox_core.lib.init')` at the top of each script file that needs the global `Ox`.

## Which ox API replaces which raw call

Reach for the right-hand column by default.

| Raw FiveM | ox equivalent | Why |
|---|---|---|
| paired `TriggerServerEvent` + `RegisterNetEvent` for a request/response | `lib.callback` / `lib.callback.await` | auto response routing, built-in timeout |
| coordinate distance checks in a loop | `lib.zones.sphere/box/poly` | grid-optimised, enter/exit/inside callbacks |
| `DrawMarker` per frame | `lib.marker.new` + `:draw()` | named types, sane defaults |
| `RequestModel` + poll loop | `lib.requestModel` | auto timeout and error |
| `RequestAnimDict` + `TaskPlayAnim` | `lib.playAnim` | loads the dict for you |
| `RegisterCommand` + `RegisterKeyMapping` | `lib.addKeybind` (client) | press/release, disable, state |
| `RegisterCommand` (server) | `lib.addCommand` | typed + validated params, ACE perms |
| manual timer/poll loops | `lib.waitFor` | timeout with an error message |
| `StartShapeTestLosProbe` | `lib.raycast.fromCoords` / `.fromCamera` | clean API, waits for you |
| `SendNUIMessage` + custom NUI | `lib.registerContext`, `lib.inputDialog`, `lib.notify`, `lib.progressBar`, `lib.showTextUI` | a whole UI framework, already styled |

## Non-negotiables

- **Never trust a client.** `RegisterNetEvent` handlers run on data the player controls.
  Re-fetch price, ownership, distance and job server-side. See the `fivem-security` skill.
- **Never `while true do` without `Citizen.Wait`.** It freezes the client's game.
- **Use `cache.ped` / `cache.playerId` / `cache.vehicle`** (ox_lib globals) instead of
  calling `PlayerPedId()` every tick.
- **oxmysql only.** `MySQL.Async.*` and `exports.ghmattimysql` are legacy; use
  `MySQL.query.await`, `MySQL.single.await`, `MySQL.scalar.await`, `MySQL.insert.await`,
  `MySQL.update.await`, and always with `?` placeholders — never string concatenation.

## Reference files

Load the one you need; they are detailed and self-contained.

| File | Covers |
|---|---|
| `references/ox-lib.md` | callbacks, zones, markers, asset loading, keybinds, commands, locale, raycast, controls, and the full UI component set |
| `references/ox-core.md` | player, vehicle, account and group APIs (client + server) |
| `references/ox-target.md` | zone/entity/model/global targets and the option schema |
| `references/ox-inventory.md` | item, slot, stash, shop, drop and hook exports |
| `references/patterns.md` | complete worked resources — job centre, shop with callback, lockpick with progress + skill check |

> The APIs above were verified against ox_lib 3.30.x, ox_core 1.5.x, ox_inventory 2.44.x
> and ox_target 1.17.x. ox ships fast — ox_lib is past 3.38 and ox_inventory past 2.47 at
> time of writing — and `ox_core` is still pre-1.0 in spirit. The shapes here are stable,
> but check the `version` line in the installed resource's `fxmanifest.lua` before relying
> on anything recently added, and read the resource source when in doubt: it is the only
> authority that is never out of date.
