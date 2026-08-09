# ox_lib reference

Verified against ox_lib v3.30.6. `lib` is global once `@ox_lib/init.lua` is in
`shared_scripts`. Modules auto-import on first access — no manual require.

Useful globals ox_lib also provides on the client: `cache.ped`, `cache.playerId`,
`cache.serverId`, `cache.vehicle`, `cache.seat`, `cache.weapon`. Prefer these over
calling `PlayerPedId()` / `GetVehiclePedIsIn()` every tick.

---

## lib.callback — request/response

Replaces paired events. The response is routed back automatically and times out on
its own (`ox:callbackTimeout` convar).

### Client → server

```lua
-- SERVER: register
lib.callback.register('getPlayerMoney', function(source)
    local player = Ox.GetPlayer(source)
    return player:getAccount().balance
end)

-- CLIENT: async
lib.callback('getPlayerMoney', false, function(money)
    print('I have $' .. money)
end)

-- CLIENT: await (yields this thread)
local money = lib.callback.await('getPlayerMoney', false)
```

### Server → client

```lua
-- CLIENT: register
lib.callback.register('getVehicleModel', function()
    local vehicle = GetVehiclePedIsIn(cache.ped, false)
    return GetEntityModel(vehicle)
end)

-- SERVER
lib.callback('getVehicleModel', playerId, function(model) end)
local model = lib.callback.await('getVehicleModel', playerId)
```

Second argument is **delay** on the client and **playerId** on the server. `source` is
available inside server handlers automatically.

> Security: a callback is still a client-triggered entry point. Validate everything
> inside the handler; never accept a price, amount, or target from the caller unchecked.

---

## lib.zones — spatial zones (client)

```lua
local zone = lib.zones.sphere({
    coords = vec3(100.0, 200.0, 30.0),
    radius = 5.0,
    debug = true,               -- render the zone while developing
    onEnter = function(self) print('entered', self.id) end,
    onExit  = function(self) end,
    inside  = function(self) end,   -- ~every 300ms while inside
})

zone:remove()
```

```lua
lib.zones.box({
    coords = vec3(100.0, 200.0, 30.0),
    size = vec3(4.0, 6.0, 3.0),     -- width, length, height
    rotation = 45,                   -- degrees about Z
    debug = true,
    onEnter = function(self) end,
})

lib.zones.poly({
    points = { vec3(100.0,200.0,30.0), vec3(105.0,200.0,30.0), vec3(105.0,205.0,30.0) },
    thickness = 4,
    onEnter = function(self) end,
})
```

Utilities: `lib.zones.getAllZones()`, `lib.zones.getCurrentZones()`,
`lib.zones.getNearbyZones()`, `zone:contains(coords)`, `zone:setDebug(true, vec4(r,g,b,a))`.

---

## lib.marker — 3D markers (client)

```lua
local marker = lib.marker.new({
    type = 'VerticalCylinder',      -- or numeric id 0-43
    coords = vec3(100.0, 200.0, 30.0),
    width = 2.0, height = 1.0,
    color = { r = 255, g = 0, b = 0, a = 100 },
    rotation = vec3(0, 0, 0),
    bobUpAndDown = false, faceCamera = true, rotate = false,
})

CreateThread(function()
    while true do
        marker:draw()
        Wait(0)
    end
end)
```

Common types: `UpsideDownCone` (0), `VerticalCylinder` (1), `ThickChevronUp` (2),
`ThinChevronUp` (3), `CheckeredFlagRect` (4), `CheckeredFlagCircle` (5),
`VerticleCircle` (6), `PlaneModel` (7), `ChevronUpx1/2/3` (20/21/22),
`HorizontalCircleFat` (23), `HorizontalCircleSkinny` (25), `DebugSphere` (28),
`DollarSign` (29), `QuestionMark` (32).

---

## lib.waitFor — yield until a condition

```lua
-- default 1000ms timeout; errors with the given message
local ped = lib.waitFor(function()
    if IsPedInAnyVehicle(cache.ped) then return cache.ped end
end, 'player not in vehicle')

local r = lib.waitFor(fn, 'condition never met', 5000)  -- custom timeout
local r = lib.waitFor(fn, nil, false)                   -- wait forever
```

---

## Asset loading (client)

```lua
local model = lib.requestModel('prop_bench_01a')          -- default 10000ms timeout
local model = lib.requestModel('prop_bench_01a', 5000)
local dict  = lib.requestAnimDict('anim@heists@box_carry@')

lib.playAnim(cache.ped, 'anim@heists@box_carry@', 'idle',
    8.0,    -- blendIn
   -8.0,    -- blendOut
   -1,      -- duration, -1 = loop
    1,      -- flags
    0.0     -- startPhase
)
```

Animation flags: `0` default, `1` looping, `2` hold last frame, `8` not interruptable,
`16` upper body, `32` secondary, `128` abort on ped movement, `1048576` hide weapon.
`49` = looping + upper body + secondary, the usual choice for a task animation.

`lib.streamingRequest` is the generic loader the above are built on.

---

## lib.addKeybind — keybinds (client)

```lua
local keybind = lib.addKeybind({
    name = 'open_menu',
    description = 'Open the main menu',
    defaultMapper = 'keyboard',     -- keyboard | mouse | pad_digitalbuttonany
    defaultKey = 'F5',
    onPressed  = function(self) openMyMenu() end,
    onReleased = function(self) end,
})

keybind:isControlPressed()
keybind:getCurrentKey()
keybind:disable(true)
```

---

## lib.addCommand — typed commands (server)

```lua
lib.addCommand('givemoney', {
    help = 'Give money to a player',
    params = {
        { name = 'target', type = 'playerId', help = 'Target player' },
        { name = 'amount', type = 'number',   help = 'Amount to give' },
        { name = 'reason', type = 'longString', help = 'Reason', optional = true },
    },
    restricted = 'group.admin',     -- false | string | { 'group.admin', 'group.mod' }
}, function(source, args, raw)
    -- args.target and args.amount are already validated
end)
```

Param types: `number`, `playerId` (validates the player exists; `me` = caller),
`string` (rejects numerics), `longString` (captures the rest of the input).

`restricted` is the ACE permission gate — set it on anything administrative. An
unrestricted admin command is one of the most common FiveM vulnerabilities.

---

## lib.locale — localisation

```lua
lib.locale('en')
local text = locale('welcome_message')
local hi   = locale('greeting', playerName)
local other = lib.getLocale('ox_inventory', 'item_not_found')
```

`locales/en.json`:

```json
{ "welcome_message": "Welcome to the server!", "greeting": "Hello, %s!" }
```

---

## lib.raycast (client)

```lua
local hit, entity, endCoords, surfaceNormal, materialHash =
    lib.raycast.fromCoords(startCoords, endCoords, flags, ignore)

local hit, entity, endCoords = lib.raycast.fromCamera(flags, ignore, distance)
-- flags: 1 mover, 2 vehicle, 4 ped, 16 object, 511 all (default)
-- ignore: 4 = no collision (default) · distance default 10
```

---

## lib.disableControls (client)

Stackable — it counts how many callers disabled each control.

```lua
lib.disableControls:Add(24, 25, 37)     -- attack, aim, weapon select
lib.disableControls:Add({ 24, 25, 37 })
lib.disableControls:Remove(24)
lib.disableControls:Clear(24, 25)       -- force, ignores the count

CreateThread(function()
    while disabling do
        lib.disableControls()            -- must run every frame
        Wait(0)
    end
end)
```

---

## Proximity helpers

Signatures differ between client and server — check which side you are on.

```lua
-- CLIENT
lib.getClosestPlayer(coords, maxDistance, includePlayer)
lib.getNearbyPlayers(coords, maxDistance, includePlayer)
lib.getClosestPed(coords, maxDistance)
lib.getNearbyPeds(coords, maxDistance)
lib.getClosestVehicle(coords, maxDistance, includePlayerVehicle)
lib.getNearbyVehicles(coords, maxDistance, includePlayerVehicle)
lib.getClosestObject(coords, maxDistance)
lib.getNearbyObjects(coords, maxDistance)

-- SERVER  (note the third parameter changes meaning)
lib.getClosestPlayer(coords, maxDistance, ignorePlayerId)
lib.getNearbyPlayers(coords, maxDistance)
```

`getNearby*` returns `{ { id, ped, coords }, ... }`; `getClosest*` returns the single
nearest plus its distance.

```lua
lib.getRelativeCoords(coords, rotation, offset)   -- offset in an entity's local space
```

## lib.cache and lib.onCache (client)

ox_lib maintains `cache.ped`, `cache.playerId`, `cache.serverId`, `cache.vehicle`,
`cache.seat`, `cache.weapon`. Use these instead of calling the natives per tick.

```lua
lib.onCache('vehicle', function(vehicle)
    -- fires when the player enters or leaves a vehicle; nil on exit
end)

lib.onCache('ped', function(ped) end)
```

This is the correct replacement for a per-frame `IsPedInAnyVehicle` poll.

## Vehicle properties

The standard way to persist and restore a vehicle's full appearance and tuning — the
backbone of any garage script.

```lua
local props = lib.getVehicleProperties(vehicle)          -- client
lib.setVehicleProperties(vehicle, props)                 -- client
lib.setVehicleProperties(vehicle, props, fixVehicle)     -- optionally repair on apply
```

Store `props` as JSON in the database; do not try to reconstruct mods field by field.

## ACE permissions (server)

Relevant to command security — see the `fivem-security` skill, rule SEC-7.

```lua
lib.addAce(principal, ace, allow)
lib.removeAce(principal, ace, allow)
lib.addPrincipal(child, parent)
lib.removePrincipal(child, parent)
```

These write the same permission state as `add_ace` / `add_principal` in `server.cfg`, but
at runtime — useful for permissions derived from the database rather than hardcoded.

## lib.points — point-based proximity (client)

A lighter alternative to `lib.zones` when you only need distance from a coordinate.

```lua
local point = lib.points.new({
    coords = vec3(100.0, 200.0, 30.0),
    distance = 10.0,
    onEnter = function(self) end,
    onExit  = function(self) end,
    nearby  = function(self) end,   -- runs while within `distance`
})

point:remove()

lib.points.getAllPoints()
lib.points.getClosestPoint()
lib.points.getNearbyPoints()
```

Use `lib.points` for "is the player near this spot"; use `lib.zones` when you need real
volumes (box, sphere, polygon) with enter/exit semantics.

## Entity creation helpers

Load the model, create the entity, and clean up — replacing the usual
`RequestModel` + poll + `CreateVehicle` + `SetModelAsNoLongerNeeded` boilerplate.

```lua
lib.ped.create(model, x, y, z, heading)
lib.ped.create(model, x, y, z, heading, isNetworked, bScriptHostPed)
lib.prop.create(model, x, y, z, heading, dynamic)
lib.vehicle.create(model, x, y, z, heading, isNetworked, netMissionEntity)
```

## More asset loaders (client)

Same contract as `lib.requestModel` — await with a timeout instead of looping forever.

```lua
lib.requestAnimSet(animSet)
lib.requestAudioBank(audioBank)
lib.requestNamedPtfxAsset(ptfxName)
lib.requestScaleformMovie(scaleformName)
lib.requestStreamedTextureDict(textureDict)
lib.requestWeaponAsset(weaponType)
```

## lib.cron — scheduled jobs (server)

```lua
lib.cron.new('*/5 * * * *', function(task, date)
    -- every five minutes
end, { debug = true })
```

Standard cron expressions. The right tool for payday, cleanup, and persistence flushes —
better than a `SetTimeout` chain, which drifts.

## lib.print — levelled logging

```lua
lib.print.error(...)
lib.print.warn(...)
lib.print.info(...)
lib.print.debug(...)     -- only shown when the resource's debug convar is set
lib.print.verbose(...)
```

Qbox uses this throughout. Prefer it over bare `print` — the level prefix and resource
name make server console output readable.

## lib.triggerClientEvent (server)

```lua
lib.triggerClientEvent(eventName, targetIds, ...)   -- targetIds: a table of server ids
```

Send to a specific set of players in one call. Reach for this instead of
`TriggerClientEvent(..., -1, ...)` when only some players need the event — see SEC-12.

## lib.checkDependency

```lua
if not lib.checkDependency('ox_inventory', '2.44.0', true) then return end
```

Verifies another resource is present and new enough, printing a clear message when it is
not. Better than discovering the mismatch as a nil export at runtime.

## GameEntity — the statebag interface behind Ped / Player / Prop / Vehicle

`lib.ped`, `lib.player`, `lib.prop` and `lib.vehicle` all inherit from an internal
GameEntity class. Its methods are where entity state actually lives, and they are the
clean alternative to hand-rolled `Entity(e).state` access.

> This page is **absent from the ox docs sidebar and from `llms.txt`** — it appears only
> in `llms-full.txt`. Crawling the navigation misses it entirely, which is why it is
> easily the least-known part of ox_lib.

```lua
entity:set(key, value)     -- write to the entity's statebag (local)
entity:setr(key, value)    -- write REPLICATED — synced to server and relevant players
entity:sets(key, value)    -- write, synced
entity:get(key)            -- read
entity:has(key)            -- boolean
entity:keys()              -- string[]

entity:setHandle(handle)
entity:getCoords()
entity:setCoords(coords)
entity:getModel()
```

`set`/`setr`/`sets` return a boolean: whether the state actually changed.

> **Security.** `setr` values written by a client are validated on the server through the
> hook pipeline below. A statebag is a network surface like any other — a client can write
> to its own entity's replicated state, so never trust a replicated value for
> authorisation. Re-derive it server-side.

## lib.hook — the hook pipeline

Lets other resources add logic to your actions without editing your code, and lets you
reject an action before it happens. This is the general form of the pattern ox_inventory
introduced with `registerHook`.

```lua
local pipeline = lib.hook:new(event, filter)
-- event:  string
-- filter: optional function(hook, payload) -> boolean, to select which hooks run

pipeline:registerHook(function(payload)
    -- inspect, validate, return false to REJECT the operation
    return true
end)
```

Each registered hook can inspect the payload and reject the action; a post-hook runs after
the pipeline for logging or cleanup without affecting the outcome. ox_lib registers its
own hooks for statebag validation — that is the mechanism enforcing the `setr` warning
above. Reference implementations live in `ox_lib/resource/state/server.lua`.

## lib.selector — weighted random selection (shared)

An `OxSelector` holds one or more named sets and picks from them, uniformly or by weight.
The natural fit for loot tables, random spawns and drop chances — better than a hand-rolled
`math.random` ladder, which is where off-by-one probability bugs live.

```lua
local selector = lib.selector:new(sets)
```

Each item in a set is a `{ weight, value }` tuple: `[1]` is the weight (0 or greater),
`[2]` is the value returned when selected.

## lib.versionCheck (server)

```lua
lib.versionCheck('overextended/ox_lib')
```

Compares the running resource's version against the latest GitHub release and prints a
notice when it is behind. Worth calling on resource start for anything you distribute.

## lib.getFilesInDirectory (server)

```lua
local files, fileCount = lib.getFilesInDirectory(path, pattern)
-- path:    relative or absolute directory to list
-- pattern: pattern to match filenames against
```

Useful for auto-loading config or locale files without hardcoding a list in the manifest.

## lib.setClipboard (client)

```lua
lib.setClipboard('text to copy')
```

Two gotchas: it silently fails if another NUI component already holds focus, and a newline
must be written as `\t\n`, not `\n`.

## Utility modules

Available as `lib.<module>`; see the ox_lib docs for full method lists.

| Module | Purpose |
|---|---|
| `lib.array` | array class with map/filter/reduce style helpers |
| `lib.table` | table utilities including `table.wipe`, deep compare, merge |
| `lib.string` | string helpers |
| `lib.math` | numeric helpers including `math.groupdigits` |
| `lib.class` | class/inheritance implementation ox uses internally |
| `lib.set`, `lib.map`, `lib.heap`, `lib.lru`, `lib.ringbuffer` | data structures |
| `lib.timer` | cancellable timers |
| `lib.uuid` | `lib.uuid.generate()` / `lib.uuid.validate(str)` |
| `lib.grid` | spatial grid used by zones/points |
| `lib.dui` | offscreen browser surfaces (render NUI to a texture) |
| `lib.hook` / `lib.registerHook` | intercept events from other resources |
| `lib.logger` | `lib.logger(source, event, message, ...)` structured logging |

---

# UI components (client)

All rendered through ox_lib's own NUI. Do not hand-roll NUI for these.

## Context menu

```lua
lib.registerContext({
    id = 'job_menu',
    title = 'Job Center',
    options = {
        { title = 'Police Officer', description = 'Serve and protect',
          icon = 'fas fa-shield', onSelect = function() TriggerServerEvent('jobs:select', 'police') end },
        { title = 'Mechanic', icon = 'fas fa-wrench',
          arrow = true, menu = 'mechanic_submenu' },
        { title = 'Current Balance', description = '$5,000', readOnly = true },
    },
})

lib.showContext('job_menu')
lib.hideContext()
lib.getOpenContextMenu()
```

## Input dialog

```lua
local input = lib.inputDialog('Character Creation', {
    { type = 'input',    label = 'First Name', required = true },
    { type = 'number',   label = 'Age', min = 18, max = 80 },
    { type = 'select',   label = 'Gender', options = {
        { value = 'male', label = 'Male' }, { value = 'female', label = 'Female' } } },
    { type = 'checkbox', label = 'Accept Terms' },
    { type = 'color',    label = 'Favorite Color' },
    { type = 'date',     label = 'Birth Date' },
    { type = 'textarea', label = 'Backstory' },
    { type = 'slider',   label = 'Strength', min = 0, max = 100, step = 5 },
})

if input then local firstName = input[1] end   -- nil if cancelled
lib.closeInputDialog()
```

Dialog input is **player-supplied text**. Anything sent onward to the server must be
validated there — length, type, and whether the player may set it at all.

## Notifications

```lua
lib.notify({
    title = 'Success',
    description = 'Item purchased successfully',
    type = 'success',              -- success | error | warning | info
    duration = 5000,
    position = 'top-right',
    icon = 'fas fa-check',
})
```

Server-side: `lib.notify(source, { ... })`.

## Progress bar / circle

```lua
local ok = lib.progressBar({
    duration = 5000,
    label = 'Repairing vehicle...',
    useWhileDead = false,
    canCancel = true,
    disable = { move = true, car = true, combat = true },
    anim = { dict = 'mini@repair', clip = 'fixing_a_player', flag = 49 },
    prop = { model = 'prop_tool_wrench', bone = 28422,
             pos = vec3(0.0,0.0,0.0), rot = vec3(0.0,0.0,0.0) },
})
if ok then --[[ finished ]] else --[[ cancelled ]] end

lib.progressCircle({ duration = 3000, label = 'Loading...' })
lib.progressActive()
lib.cancelProgress()
```

A progress bar is a *client-side* delay. It is not a security control — the server must
still verify the action independently.

## Alert dialog

```lua
local result = lib.alertDialog({
    header = 'Confirm Purchase',
    content = 'Buy this item for $500?',
    centered = true,
    cancel = true,
    labels = { confirm = 'Buy', cancel = 'Nevermind' },
})  -- 'confirm' | 'cancel'

lib.closeAlertDialog()
```

## Text UI

```lua
lib.showTextUI('[E] Open Door', { position = 'right-center', icon = 'fas fa-door-open' })
lib.hideTextUI()
lib.isTextUIOpen()
```

## Skill check

```lua
local passed = lib.skillCheck({ 'easy', 'easy', 'medium' }, { 'w', 'a', 's', 'd' })
lib.cancelSkillCheck()
lib.skillCheckActive()
```

## Radial menu

```lua
lib.registerRadial({
    id = 'main_radial',
    items = {
        { label = 'Inventory', icon = 'fas fa-backpack', onSelect = function() end },
        { label = 'Phone', icon = 'fas fa-phone', onSelect = function() end },
    },
})

lib.addRadialItem({ id = 'radio', label = 'Radio', icon = 'fas fa-radio', onSelect = function() end })
lib.removeRadialItem('radio')
lib.clearRadialItems()
lib.hideRadial()
lib.disableRadial(true)
```

## List menu

```lua
lib.registerMenu({
    id = 'vehicle_menu',
    title = 'Vehicle Options',
    position = 'top-left',
    options = {
        { label = 'Engine', icon = 'fas fa-car-engine', values = { 'On', 'Off' } },
        { label = 'Doors',  icon = 'fas fa-door-open' },
    },
}, function(selected, scrollIndex, args) end)

lib.showMenu('vehicle_menu')
lib.hideMenu()
lib.getOpenMenu()
lib.setMenuOptions('vehicle_menu', newOptions, index)
```
