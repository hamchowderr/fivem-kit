# ox_doorlock — `1.22.1`

Locks, and the permissions on them. Doors are configured in-game (`/doorlock`) and stored in
the database; the exports are for scripting around them, not for defining them.

### Server

```lua
exports.ox_doorlock:getDoor(id)                  -- door data by id
exports.ox_doorlock:getDoorFromName(name)        -- door data by its configured name
exports.ox_doorlock:getAllDoors()                -- every door
exports.ox_doorlock:setDoorState(id, state)      -- 0 = unlocked, 1 = locked
exports.ox_doorlock:editDoor(id, data)           -- change a door's configuration
exports.ox_doorlock:registerHook(name, cb)       -- gate an action; see below
exports.ox_doorlock:removeResourceHook(name)     -- drop hooks this resource registered
```

### Client

```lua
exports.ox_doorlock:getClosestDoor()             -- the door data nearest the player
exports.ox_doorlock:getClosestDoorId()           -- just the id
exports.ox_doorlock:getDoorIdFromEntity(entity)  -- resolve a door entity to its id
exports.ox_doorlock:useClosestDoor()             -- attempt to toggle the nearest door
exports.ox_doorlock:pickClosestDoor()            -- lockpick attempt on the nearest door
```

### Events

```lua
AddEventHandler('ox_doorlock:loaded', function(doors) end)          -- doors are ready
AddEventHandler('ox_doorlock:stateChanged', function(source, doorId, state, usedLockpick) end)
```

`stateChanged` is the hook point for logging, alarms and dispatch. Note it fires for
**every** door change including lockpicks — the fourth argument is how you tell them apart.

### Security note

`setDoorState` is a server export that changes world state, so anything reachable from a
client must re-check permission. Use `registerHook` to gate an action centrally rather than
scattering checks: a hook returning `false` denies the interaction, which is far harder to
get wrong than re-implementing the check in each caller.
