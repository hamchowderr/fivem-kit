# GTA V natives that actually come up

Ranked by real usage in live ox resources. Full reference: https://docs.fivem.net/natives/

Where an ox wrapper exists, prefer it — the "prefer" notes say which.

---

## Entity — position and state

| Native | Side | Does |
|---|---|---|
| `GetEntityCoords(entity)` | both | XYZ position |
| `SetEntityCoords(entity, x, y, z)` | both | teleport |
| `GetEntityHeading(entity)` / `SetEntityHeading(entity, h)` | both | rotation 0–360 |
| `GetEntityModel(entity)` | both | model hash |
| `GetEntityType(entity)` | both | 1 ped, 2 vehicle, 3 object |
| `DoesEntityExist(entity)` | both | guard before touching an entity |
| `DeleteEntity(entity)` | both | remove from world |
| `SetEntityAsMissionEntity(entity, true)` | client | required before deleting a networked entity |
| `FreezeEntityPosition(entity, toggle)` | both | lock in place |
| `SetEntityInvincible(entity, toggle)` | both | immune to damage |
| `GetOffsetFromEntityInWorldCoords(entity, x, y, z)` | client | world pos relative to entity — `(0,2,0)` is 2m in front |
| `NetworkGetNetworkIdFromEntity(entity)` | client | net id for server sync |
| `NetworkGetEntityFromNetworkId(netId)` | both | entity from net id |
| `GetEntityBoneIndexByName(entity, name)` | client | e.g. `"SKEL_R_Hand"` for attachments |
| `SetEntityDrawOutline(entity, toggle)` | client | highlight interactables |

## Player and ped

| Native | Side | Does |
|---|---|---|
| `PlayerPedId()` | client | local player's ped — the most-called native |
| `PlayerId()` | client | local client-side player handle |
| `GetPlayerPed(playerId)` | both | ped from player id; server: `GetPlayerPed(source)` |
| `GetPlayerServerId(player)` | client | server id from client handle |
| `IsPedInAnyVehicle(ped, atGetIn)` | client | in a vehicle? |
| `GetVehiclePedIsIn(ped, lastVehicle)` | client | the vehicle they're in |
| `ClearPedTasks(ped)` | client | stop animations/tasks |
| `SetPedConfigFlag(ped, flag, value)` | client | e.g. flag 35 = no idle anims |
| `IsPedCuffed(ped)` | client | handcuff state |

> Prefer ox_lib's `cache.ped`, `cache.playerId`, `cache.vehicle`, `cache.seat` over calling
> these every frame. Prefer `Ox.GetPlayer(source)` server-side for the full player object.

## Ped appearance

| Native | Does |
|---|---|
| `SetPedComponentVariation(ped, component, drawable, texture, palette)` | clothing piece |
| `SetPedPropIndex(ped, propType, index, texture, attach)` | hat/glasses/earpiece |
| `SetPedFaceFeature(ped, index, scale)` | face shape |
| `SetPedHeadOverlay(ped, overlayId, index, opacity)` | facial hair, makeup, aging |
| `GetPedDrawableVariation(ped, componentId)` | read current component |
| `ClearPedProp(ped, propIndex)` | remove a prop |

**Component ids:** 0 head · 1 mask · 2 hair · 3 torso · 4 legs · 5 bags · 6 shoes ·
7 accessories · 8 undershirt · 9 armor · 10 decals · 11 tops
**Prop ids:** 0 hats · 1 glasses · 2 ears · 6 watch · 7 bracelet

## Animations

| Native | Does |
|---|---|
| `TaskPlayAnim(ped, dict, name, blendIn, blendOut, duration, flag, rate, ...)` | play |
| `IsEntityPlayingAnim(entity, dict, name, taskType)` | check (taskType 3 is usual) |
| `ClearPedTasks(ped)` | cancel |

**Flags:** 0 normal · 1 loop · 2 stop on last frame · 16 upper body only · 32 controllable ·
**49** loop+upper+controllable (the usual job animation)

> Prefer `lib.playAnim()` — it requests the dict and cleans up.

## Vehicles

| Native | Side | Does |
|---|---|---|
| `CreateVehicle(hash, x, y, z, heading, isNetwork, netMissionEntity)` | both | spawn |
| `GetVehicleNumberPlateText(vehicle)` | both | plate |
| `GetVehicleClass(vehicle)` | both | 0 compacts … 22 open wheel |
| `GetVehicleMod(vehicle, modType)` / `SetVehicleMod(vehicle, modType, index, customTires)` | client | mods |
| `GetVehicleDoorLockStatus(vehicle)` | both | 0 unlocked, 2 locked |
| `SetVehicleHandlingFloat(vehicle, class, field, value)` | client | handling tuning |
| `GetPedInVehicleSeat(vehicle, seat)` | client | −1 driver, 0 front passenger |

**Mod types:** 0 spoiler · 1 front bumper · 2 rear bumper · 3 side skirt · 4 exhaust ·
5 frame · 6 grille · 7 hood · 8 fender · 10 roof · 11 engine · 12 brakes ·
13 transmission · 14 horns · 15 suspension · 16 armor

> Prefer `Ox.CreateVehicle()` / `Ox.SpawnVehicle()` for vehicles that must persist.

## Input and controls

| Native | Does |
|---|---|
| `DisableControlAction(inputGroup, control, disable)` | block a key this frame |
| `IsControlPressed(group, control)` | held now |
| `IsControlJustPressed(group, control)` | pressed this frame |
| `IsControlJustReleased(group, control)` | released this frame |
| `IsDisabledControlJustPressed(group, control)` | same, for disabled controls |
| `DisablePlayerFiring(player, toggle)` | block weapon fire |

**Control ids:** 24 attack · 25 aim · 37 select weapon · 38 E (pickup) · 44 Q · 47 G ·
51 E (context) · 73 X · 75 F (enter vehicle) · 140/142 R melee · 176 enter ·
200 ESC · 245 T (chat) · 249 N (push-to-talk)

> Prefer `lib.addKeybind()` (rebindable) and `lib.disableControls:Add()` (stackable).

## World and objects

| Native | Does |
|---|---|
| `GetHashKey(string)` | string → hash |
| `GetClosestObjectOfType(x, y, z, radius, hash, ...)` | nearest object |
| `CreateObject(hash, x, y, z, isNetwork, netMissionEntity, doorFlag)` | spawn a prop |
| `GetGamePool(type)` | all entities of a type, e.g. `'CVehicle'` |
| `GetGameTimer()` | ms since start — use for cooldowns |

## UI and map

| Native | Does |
|---|---|
| `SetNuiFocus(hasFocus, hasCursor)` | NUI input capture — always restore to `(false,false)` |
| `AddBlipForCoord(x, y, z)` | map blip |
| `SetBlipSprite(blip, id)` / `SetBlipColour(blip, c)` / `SetBlipScale(blip, s)` / `SetBlipDisplay(blip, d)` | blip setup |
| `RemoveBlip(blip)` | cleanup |
| `SetNewWaypoint(x, y)` | GPS waypoint |
| `DrawMarker(type, x, y, z, ...)` | per-frame marker |
| `DrawSprite(dict, name, x, y, w, h, heading, r, g, b, a)` | 2D HUD image |
| `PlaySoundFrontend(soundId, name, ref, p3)` | UI sound |

Blip name requires the text-command dance:

```lua
BeginTextCommandSetBlipName('STRING')
AddTextComponentSubstringPlayerName('Job Center')
EndTextCommandSetBlipName(blip)
```

**Blip colours:** 0 white · 1 red · 2 green · 3 blue · 5 yellow · 17 orange ·
38 dark blue · 40 dark yellow · 47 pink

> Prefer `lib.marker.new()` over raw `DrawMarker`. Blips have no ox wrapper.

## Asset loading

| Native | Does |
|---|---|
| `RequestModel(hash)` / `HasModelLoaded(hash)` | load a model, then poll |
| `SetModelAsNoLongerNeeded(hash)` | free it — always, after spawning |
| `RequestAnimDict(dict)` / `RemoveAnimDict(dict)` | animation dictionaries |
| `RequestScaleformMovie(name)` | scaleform UI |

> Prefer `lib.requestModel()` / `lib.requestAnimDict()` — they handle the wait and time out
> instead of looping forever on a bad model name.

## NPC tasks

| Native | Does |
|---|---|
| `TaskGoToCoordAnyMeans(ped, x, y, z, speed, ...)` | walk/run to a point |
| `TaskStartScenarioInPlace(ped, scenario, 0, true)` | ambient behaviour |
| `TaskTurnPedToFaceEntity(ped, entity, duration)` | face the player |
| `TaskWanderStandard(ped, p1, p2)` | wander |
| `TaskEnterVehicle(ped, vehicle, timeout, seat, speed, ...)` | −1 = driver |
| `ClearPedTasksImmediately(ped)` | hard stop, no blend |

**Scenarios:** `WORLD_HUMAN_CLIPBOARD`, `WORLD_HUMAN_COP_IDLES`, `WORLD_HUMAN_GUARD_STAND`,
`WORLD_HUMAN_JANITOR`, `WORLD_HUMAN_SMOKING`, `WORLD_HUMAN_DRINKING`, `WORLD_HUMAN_WELDING`,
`WORLD_HUMAN_HAMMERING`, `WORLD_HUMAN_STAND_MOBILE`, `WORLD_HUMAN_AA_COFFEE`

## Server-side identification

| Native | Does |
|---|---|
| `GetPlayerIdentifierByType(source, type)` | one identifier, e.g. `'discord'` |
| `GetPlayerName(playerId)` | display name |
| `GetCurrentResourceName()` | this resource — use for event namespacing |
| `GetResourceState(name)` | `'started'`, `'stopped'`, `'missing'` … |

---

## Native or ox?

| Task | Native | ox |
|---|---|---|
| player position | `GetEntityCoords(PlayerPedId())` | `player:getCoords()` |
| spawn a vehicle | `CreateVehicle(...)` | `Ox.CreateVehicle(data)` — persists |
| play an animation | `RequestAnimDict` + `TaskPlayAnim` | `lib.playAnim(...)` |
| load a model | `RequestModel` + poll | `lib.requestModel(...)` |
| a zone | per-frame distance loop | `lib.zones.sphere({...})` |
| interaction | raycast + key check | `ox_target` |
| block controls | `DisableControlAction` per frame | `lib.disableControls:Add(...)` |
| keybind | `IsControlJustPressed` per frame | `lib.addKeybind(...)` |
| blips · NPC tasks · sounds · waypoints · clothing | native | no ox wrapper — use the native |

Rule of thumb: ox wraps the things that are easy to get wrong (waiting, cleanup,
timeouts). It does not wrap raw GTA world manipulation.
