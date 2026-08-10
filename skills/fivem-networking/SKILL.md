---
name: fivem-networking
description: FiveM multiplayer state — entity ownership and control requests, network IDs, state bags, routing buckets, OneSync scoping and culling, and server-created entities. Use when something works for the player who spawned it but not for anyone else, when a vehicle or ped will not respond to a native on another client, when syncing data about an entity between clients, when instancing players so they cannot see each other, or when an entity vanishes at range. Not for writing client/server events themselves (fivem-core) or for securing an event handler (fivem-security).
---

# FiveM networking

Almost every "works for me, not for other players" bug is one of three things: you acted on
an entity you do not **own**, you replicated data the wrong direction, or the entity was
never in the other player's **scope** to begin with. Those are three different mechanisms
with three different fixes, and this skill is about telling them apart.

## Ownership — the one rule that explains most desync

GTA V is client-authoritative per entity. Every networked entity has exactly **one owner** at
a time: a single client whose game is simulating it. Everyone else has a copy that mirrors
what the owner reports.

**A native that changes an entity only takes effect if you own that entity.** Calling
`SetEntityCoords` on a vehicle owned by another player does nothing lasting — your client
moves its local copy, the owner's next update overwrites it, and the car snaps back. Nothing
errors. That silence is why this bug survives so long.

```lua
-- client
local function withControl(entity)
    if NetworkHasControlOfEntity(entity) then return true end

    for _ = 1, 100 do                       -- ~2s at 20ms
        NetworkRequestControlOfEntity(entity)
        if NetworkHasControlOfEntity(entity) then return true end
        Wait(20)
    end

    return false
end

if withControl(veh) then
    SetEntityCoords(veh, x, y, z)
end
```

`NetworkRequestControlOfEntity` is a **request**. It returns immediately and may not have
been granted yet, which is why the loop re-checks rather than trusting the return value. It
can also fail permanently — the owner may be mid-migration, or migration may be disabled:

```lua
SetNetworkIdCanMigrate(netId, false)   -- pin ownership; no one else may take control
```

Ownership migrates on its own as players move, so **never cache the result** of a control
check across frames. Check it at the moment you act.

| Native | Side | Returns |
|---|---|---|
| `NetworkGetEntityOwner(entity)` | client + server | owner's player index |
| `NetworkHasControlOfEntity(entity)` | client | do I own it right now |
| `NetworkRequestControlOfEntity(entity)` | client | request sent (not granted) |
| `SetNetworkIdCanMigrate(netId, toggle)` | client | — |
| `NetworkGetEntityIsNetworked(entity)` | client | is it networked at all |

### Network IDs are the only handle worth sending

Entity handles are **local**. Vehicle `342` on your client is a different entity — or
nothing — on someone else's. Sending a raw handle over an event is a bug that happens to
work in single-player testing.

```lua
-- client → server
local netId = NetworkGetNetworkIdFromEntity(veh)
TriggerServerEvent('myres:lock', netId)

-- server
RegisterNetEvent('myres:lock', function(netId)
    local veh = NetworkGetEntityFromNetworkId(netId)
    if not DoesEntityExist(veh) then return end
    -- …and validate this player is allowed to touch it (see fivem-security)
end)
```

Network IDs **are reused** after an entity is destroyed. A netId held across a despawn can
resolve to a completely different entity later, so re-resolve and re-validate every time
rather than storing one long-term.

Entities created **on the server** (`CreateVehicle`, `CreatePed` server-side) are networked
from birth and return a server-side entity handle directly — no netId round-trip needed
server-side, and no client has to be nearby for them to exist.

## State bags — replicated key/value on an entity

State bags replace the pattern of broadcasting an event to every client every time a
property changes. Set once, read anywhere.

```lua
-- server (replicates to clients by default)
Entity(veh).state.fuel = 42.5
Player(src).state.onDuty = true
GlobalState.weatherLocked = true

-- any client
local fuel = Entity(veh).state.fuel
local locked = GlobalState.weatherLocked
LocalPlayer.state.aiming = true          -- local by default, not replicated
```

**Direction of replication is asymmetric and is the thing people get wrong:** state set on
the **server** replicates to clients; state set on a **client** does not replicate. Override
per-write with the three-argument `set`:

```lua
Entity(veh).state:set('clone', 600, false)     -- server: keep it server-side only
Entity(enemy).state:set('taskAck', 'guard', true)  -- client: do replicate this one
```

### The shallow-set trap

Getters and setters are naive. Every get deserializes the whole bag; only a **direct** set
serializes back.

```lua
Entity(veh).state.meta.locked = true    -- does NOT replicate. Silently.
Entity(veh).state['meta:locked'] = true -- flat keys replicate
```

Nested mutation looks like it worked locally and never leaves the machine. Keep bag values
flat, or set the whole table at once.

### Reacting to changes

```lua
AddStateBagChangeHandler('fuel', nil, function(bagName, key, value, _reserved, replicated)
    local netId = tonumber(bagName:match('entity:(%d+)'))
    if not netId then return end
    local entity = NetworkGetEntityFromNetworkId(netId)
    -- …
end)
```

`bagName` is `player:<source>`, `entity:<netId>` or `localEntity:<handle>` — parse it, do not
assume. The second argument filters by bag name; `nil` means every bag, which on a busy
server means this handler runs a lot. Filter by key (first argument) at minimum.

Default write policy: players may write their own player state, an entity's owner may write
its state, only the server writes global state. Tighten it server-wide with:

```cfg
setr sv_stateBagStrictMode true   # only the server may modify any state bag
```

## Routing buckets — separate worlds on one server

A player only sees entities and players in **their own bucket**. Each bucket gets its own
world grid, so population behaves normally inside each one.

```lua
-- server only
SetPlayerRoutingBucket(source, 1)
SetEntityRoutingBucket(entity, 1)
SetRoutingBucketPopulationEnabled(1, false)      -- no ambient traffic/peds in this bucket
SetRoutingBucketEntityLockdownMode(1, 'strict')  -- 'strict' | 'relaxed' | 'inactive'
```

Lockdown modes: `strict` blocks all client-created entities, `relaxed` blocks only
script-owned client-created entities, `inactive` allows everything (the default).
`strict` on a gameplay bucket is a strong anti-spawn-cheat measure — but it also blocks
legitimate client-side spawning, so resources must create entities server-side.

Buckets **require OneSync `on`** — not `legacy`.

Good uses: character-selection screens, party/session systems, separate minigames, an
apartment per player. **Not interiors** — GTA V interiors look outward, so an instanced
interior in its own bucket shows an empty world through the windows. Use the conceal natives
for those instead.

## OneSync scope and culling

With OneSync Infinity, clients only have entities within roughly a **424-unit focus zone**
created locally, and players outside that zone are not created client-side at all.

The direct consequence: **iterating players must happen server-side.** `GetActivePlayers`
on a client returns only the players currently in scope, which is why a client-side "count
everyone online" is wrong on a busy server and right on an empty test server. Use `GetPlayers()`
on the server.

An entity nobody is near may not exist client-side at all. If a script needs an entity to
survive that, create it server-side and let the server own its lifetime:

```lua
-- server. 0 = DeleteWhenNotRelevant (default), 1 = DeleteOnOwnerDisconnect, 2 = KeepEntity
SetEntityOrphanMode(entity, 2)
```

`KeepEntity` stops the **server** deleting the entity during relevancy checks. It does not
stop a client deleting it, so it is persistence against cleanup, not against interference.

Culling natives such as `SetEntityDistanceCullingRadius` exist but are **deprecated with
known unfixable issues** — reach for server-side creation and orphan modes instead of
widening cull radii.

## Diagnosing "works for me, not for others"

| Symptom | Likely cause | Fix |
|---|---|---|
| Change snaps back after a moment | you don't own the entity | request control, then act |
| Nothing happens at all on other clients | you sent a local entity handle | send a netId |
| Works near the player, fails far away | entity out of scope / culled | create server-side |
| State bag value never arrives | nested set, or set client-side | flat key, or `set(..., true)` |
| Only some players see each other | different routing buckets | check `GetPlayerRoutingBucket` |
| Entity vanishes when its spawner leaves | default orphan mode | `SetEntityOrphanMode` |
| Client-side player count is too low | OneSync culling | count on the server |

## Boundaries

- Writing the events themselves, threads, callbacks → `fivem-core`.
- Trusting what a client sends over one of these events → `fivem-security`. Ownership is a
  *sync* mechanism, never a permission one: a client that owns an entity can lie about it.
- ox_lib's `lib.callback` and points/zones → `ox-stack`.
