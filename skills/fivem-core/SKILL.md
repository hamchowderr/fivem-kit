---
name: fivem-core
description: Core FiveM scripting — the Lua runtime (events, threads, callbacks, NUI, vectors, HTTP), fxmanifest.lua structure, and the GTA V natives you actually use. Use when writing any FiveM Lua, creating or fixing an fxmanifest, wiring client/server events, working with NUI, or looking up a native for peds, vehicles, blips, controls, or animations.
---

# FiveM core scripting

A FiveM resource runs in two places at once. Getting this boundary right is most of the
job.

| | Client | Server |
|---|---|---|
| runs on | each player's game | the host |
| sees | the game world, natives, NUI | players, database, HTTP |
| trust | none — fully player-controlled | authoritative |

Cross the boundary with `TriggerServerEvent` / `TriggerClientEvent`, or better, with
`lib.callback` if ox_lib is present (see the `ox-stack` skill).

## Event flow, the three shapes

```lua
-- client → server
TriggerServerEvent('myEvent', a, b)                    -- CLIENT
RegisterNetEvent('myEvent', function(a, b)             -- SERVER
    local src = source                                 -- capture immediately
end)

-- server → client
TriggerClientEvent('myEvent', targetPlayerId, a)       -- SERVER (-1 = everyone)
RegisterNetEvent('myEvent', function(a) end)           -- CLIENT

-- local, same side only
TriggerEvent('myLocalEvent', a)
AddEventHandler('myLocalEvent', function(a) end)
```

Three rules that prevent most bugs:

1. **`local src = source` on the first line** of every server net handler. `source` is
   only reliable at entry; after any yield it may be another player or nil.
2. **Only call `RegisterNetEvent` on events you genuinely want clients to fire.**
   Registering an internal event exposes it to every player.
3. **Namespace event names** — `resourceName:action`. `GetCurrentResourceName()` helps.
   Bare names like `openMenu` collide across resources.

## Threads

```lua
CreateThread(function()
    while true do
        Wait(0)          -- MANDATORY
        -- per-frame work
    end
end)

SetTimeout(5000, function() end)     -- fire once, non-blocking
```

`while true do` without a `Wait` **freezes the player's game**. `Wait(0)` yields until the
next frame. Avoid `Wait(5)`/`Wait(10)` — they behave inconsistently across refresh rates;
use `Wait(0)` for per-frame work and a real interval (250ms+) for anything else.

## Skill map

| File | Covers |
|---|---|
| `references/lua-runtime.md` | full runtime API — events, threads, NUI, vectors, identifiers, HTTP |
| `references/fxmanifest.md` | every manifest directive, load order, NUI files, dependencies, escrow |
| `references/natives.md` | the natives that actually come up, by category, with the ox wrapper to prefer |

Related skills: `ox-stack` (build on ox), `fivem-frameworks` (ESX/QBCore/QBox dialects),
`fivem-security` (audit rules), `fivem-server-ops` (server.cfg, artifacts, debugging).

## Default to ox when it exists

If the server has `ox_lib`, prefer `lib.*` over hand-rolled equivalents — it removes the
wait loops, timeouts and cleanup that hand-written versions get wrong. Natives remain the
answer for GTA world manipulation ox does not wrap: blips, NPC tasks, sounds, clothing,
vehicle handling.
