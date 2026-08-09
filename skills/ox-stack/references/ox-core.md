# ox_core reference

Verified against ox_core v1.5.1. ox_core is TypeScript internally and exposes a Lua API
through the global `Ox`.

## Loading

```lua
-- after '@ox_lib/init.lua' is in shared_scripts
lib.load('@ox_core.lib.init')
-- global `Ox` now exists in this file
```

`lib.load` is per-file. Every client or server script that touches `Ox` needs its own call.

---

## Player — client

```lua
local player = Ox.GetPlayer()

player.userId     -- unique user id
player.charId     -- active character id
player.stateId    -- state identifier
player.state      -- LocalPlayer.state statebag

player:getCoords()                 -- vec3
player:getGroup('police')          -- grade (number) or nil
player:getGroupByType('job')       -- groupName, grade
player:get('firstName')            -- arbitrary data field

player:on('job', function(data)
    print('job changed to', data)
end)
```

## Player — server

```lua
local player = Ox.GetPlayer(source)

player.source       -- server id
player.userId
player.identifier   -- primary identifier
player.username
player.ped

player:getCoords()
player:getState()                  -- Player(source).state statebag
player:getGroup('police')          -- grade or nil
player:getGroupByType('job')       -- groupName, grade
player:getAccount()                -- OxAccount for the active character
```

Lookups:

```lua
Ox.GetPlayer(playerId)
Ox.GetPlayerFromUserId(userId)
Ox.GetPlayerFromCharId(charId)     -- by character id
Ox.GetPlayers(filter)              -- all, optional filter table
Ox.GetPlayerFromFilter(filter)     -- first match
```

`Ox.GetPlayer(source)` returns nil when the player has dropped or has no character
loaded. **Always guard**: `if not player then return end`. Skipping this is the single
most common crash in ox server code.

---

## Vehicle — server

```lua
local vehicle = Ox.GetVehicle(entityId)

vehicle.entity
vehicle:getCoords()
vehicle:getState()                 -- Entity(entity).state statebag

Ox.GetVehicle(entityId)
Ox.GetVehicleFromEntity(entityId)   -- by entity handle
Ox.GetVehicleFromNetId(netId)
Ox.GetVehicleFromVin(vin)
Ox.GetVehicleFromFilter(filter)     -- first match
Ox.GetVehicles(filter)              -- all, optional filter table

Ox.CreateVehicle(data, coords, heading)   -- new vehicle
Ox.SpawnVehicle(dbId, coords, heading)    -- existing, from the database
```

---

## Account — server

```lua
local account = Ox.GetAccount(accountId)
account.accountId

Ox.GetAccount(accountId)
Ox.GetCharacterAccount(charId)     -- a character's default account
Ox.GetGroupAccount(groupName)      -- faction/group account
Ox.CreateAccount(owner, label)
```

Account methods are loaded dynamically from ox_core exports (`:withdraw(amount)`,
balance access, etc.). Treat every balance mutation as security-critical: read the
balance server-side immediately before the withdrawal, and never accept an amount that
originated on a client without bounds-checking it.

---

## Group

```lua
local groupData = Ox.GetGroup('police')   -- GlobalState data for the group
```

Group membership is the ox equivalent of a "job". Authorisation checks belong on the
server: `player:getGroup('police')` returning a grade, not a client claiming it has one.
