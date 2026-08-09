# ox_target reference

Verified against ox_target v1.17.2. Client-side. Replaces proximity text prompts with a
targeting cursor: the player holds a key, then clicks entities or zones.

## Zone targets

```lua
exports.ox_target:addSphereZone({
    coords = vec3(100.0, 200.0, 30.0),
    radius = 2.0,
    debug = true,
    drawSprite = true,
    options = {
        {
            name = 'atm_withdraw',
            label = 'Withdraw Cash',
            icon = 'fas fa-money-bill',
            distance = 2.0,
            canInteract = function(entity, distance, coords, name, bone)
                return true            -- false hides the option
            end,
            onSelect = function(data) end,
            groups = { ['police'] = 0 },   -- group -> minimum grade
            items  = 'phone',              -- required item, string or table
        },
    },
})

exports.ox_target:addBoxZone({
    coords = vec3(100.0, 200.0, 30.0),
    size = vec3(2.0, 2.0, 2.0),
    rotation = 45,
    options = { --[[ ... ]] },
})

exports.ox_target:addPolyZone({
    points = { vec3(--[[...]]), vec3(--[[...]]) },
    thickness = 4,
    options = { --[[ ... ]] },
})

exports.ox_target:removeZone(zoneId)
exports.ox_target:zoneExists(zoneId)
```

## Entity and model targets

```lua
exports.ox_target:addModel('prop_atm_01', {
    { name = 'use_atm', label = 'Use ATM', icon = 'fas fa-credit-card',
      onSelect = function(data) --[[ data.entity ]] end },
})
exports.ox_target:removeModel('prop_atm_01')

exports.ox_target:addEntity(entityHandle, { --[[ options ]] })
exports.ox_target:removeEntity(entityHandle)

-- only visible to this client
exports.ox_target:addLocalEntity(entityOrNetId, { --[[ options ]] })
exports.ox_target:removeLocalEntity(entityOrNetId)
```

## Global targets

Apply to every entity of a kind. Use sparingly — they run for everything.

```lua
exports.ox_target:addGlobalPed({ --[[ options ]] })
exports.ox_target:addGlobalVehicle({ --[[ options ]] })
exports.ox_target:addGlobalObject({ --[[ options ]] })
exports.ox_target:addGlobalPlayer({ --[[ options ]] })
exports.ox_target:addGlobalOption({ --[[ options ]] })

-- each has a remove counterpart, taking the option name(s) to remove
exports.ox_target:removeGlobalPed('talk_ped')
exports.ox_target:removeGlobalVehicle('check_vehicle')
exports.ox_target:removeGlobalObject('inspect')
exports.ox_target:removeGlobalPlayer('search')
exports.ox_target:removeGlobalOption('my_option')
```

Always remove what you add on `onResourceStop`, or the options survive a resource restart
and stack up as duplicates.

## Utilities

```lua
exports.ox_target:disableTargeting(true)
exports.ox_target:isActive()
exports.ox_target:getTargetOptions(entity)
```

## Option schema

| Field | Type | Meaning |
|---|---|---|
| `name` | string | unique option id |
| `label` | string | display text |
| `icon` | string | FontAwesome class |
| `distance` | number | max interaction distance |
| `onSelect` | function | called on select, receives a data table |
| `canInteract` | function | return false to hide the option |
| `groups` | table | `{ ['police'] = minGrade }` |
| `items` | string/table | required inventory item(s) |

> `groups`, `items`, `canInteract` and `distance` are **client-side display filters**.
> They stop the option from being *shown*; they do not stop the underlying event from
> being triggered by a modified client. Re-check job, items, and distance in the server
> handler that `onSelect` calls.
