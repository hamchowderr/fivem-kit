# QBCore and Qbox reference

Verified against `qb-core` and `qbx_core` sources. Resource folders: `qb-core`, `qbx_core`.

---

# QBCore

## Getting the object

```lua
local QBCore = exports['qb-core']:GetCoreObject()

-- optionally filtered, for a smaller object
local QBCore = exports['qb-core']:GetCoreObject({ 'Players', 'Config' })
```

Shared data has dedicated exports too: `GetSharedItems`, `GetSharedVehicles`,
`GetSharedWeapons`, `GetSharedJobs`, `GetSharedGangs`.

## Server — player

```lua
local Player = QBCore.Functions.GetPlayer(source)
if not Player then return end

Player.PlayerData                  -- the whole table
Player.PlayerData.citizenid        -- stable identifier
Player.PlayerData.job              -- { name, label, grade = { level, name }, onduty, ... }
Player.PlayerData.gang
Player.PlayerData.metadata
Player.PlayerData.charinfo
```

Methods live under `Player.Functions`:

```lua
Player.Functions.SetJob(job, grade)
Player.Functions.SetGang(gang, grade)
Player.Functions.SetJobDuty(onDuty)

Player.Functions.AddMoney(moneytype, amount, reason)      -- 'cash' | 'bank' | 'crypto'
Player.Functions.RemoveMoney(moneytype, amount, reason)
Player.Functions.SetMoney(moneytype, amount, reason)
Player.Functions.GetMoney(moneytype)

Player.Functions.HasItem(items, amount)
Player.Functions.GetName()
Player.Functions.SetMetaData(key, value)
Player.Functions.GetMetaData(key)
Player.Functions.AddRep(rep, amount) / RemoveRep / GetRep
Player.Functions.SetPlayerData(key, val)
Player.Functions.UpdatePlayerData()
```

`AddMoney` / `RemoveMoney` return a boolean. **Check it** — `RemoveMoney` returns false
when the player cannot afford it, and ignoring that is how QB shops give away free items.

## Callbacks

```lua
-- server
QBCore.Functions.CreateCallback('myresource:getSomething', function(source, cb, arg)
    cb(result)
end)

-- client
QBCore.Functions.TriggerCallback('myresource:getSomething', function(result)
end, arg)
```

## Client

```lua
local PlayerData = QBCore.Functions.GetPlayerData()
QBCore.Functions.Notify('message', 'success', 5000)
QBCore.Functions.Progressbar(name, label, duration, useWhileDead, canCancel, disableControls, animation, prop, propTwo, onFinish, onCancel)
QBCore.Functions.SpawnVehicle(model, cb, coords, isnetworked)
QBCore.Functions.GetClosestPlayer()
QBCore.Functions.GetVehicleProperties(vehicle)
```

## Events

| Event | Fires |
|---|---|
| `QBCore:Server:OnPlayerLoaded` | player finished loading |
| `QBCore:Client:OnPlayerLoaded` | client side of the same |
| `QBCore:Server:OnPlayerUnload` | logout |
| `QBCore:Client:OnJobUpdate` | job changed |
| `QBCore:Client:OnGangUpdate` | gang changed |

## QBCore traps

- **`job.grade` is a table** — `job.grade.level` is the number. `if job.grade >= 2` is
  always comparing a table and silently wrong.
- **`PlayerData` on the client is a cached copy.** It goes stale; never authorise from it.
- **`HasItem` on the client is display-only.** Re-check server-side.
- Money types are strings; a typo (`'Bank'`, `'money'`) fails silently in some builds
  rather than erroring.

---

# Qbox (qbx_core)

A modernised QBCore fork. The key difference: **Qbox is built on ox_lib and ox_target**,
so `lib.callback`, `lib.notify`, `lib.progressBar` and `ox_target` are the idiomatic
choice there — not the QBCore equivalents.

## Server exports

Called directly on the resource, no core object:

```lua
local player = exports.qbx_core:GetPlayer(source)
exports.qbx_core:GetPlayerByCitizenId(citizenid)
exports.qbx_core:GetPlayerByUserId(userId)
exports.qbx_core:GetPlayerByPhone(phone)
exports.qbx_core:GetQBPlayers()
exports.qbx_core:GetSource(identifier)
exports.qbx_core:GetUserId(source)

exports.qbx_core:GetDutyCountJob(job)
exports.qbx_core:GetDutyCountType(type)

exports.qbx_core:CreateUseableItem(item, cb)
exports.qbx_core:CanUseItem(item)

exports.qbx_core:IsWhitelisted(source)
exports.qbx_core:AddPermission(source, permission)
exports.qbx_core:RemovePermission(source, permission)
exports.qbx_core:HasPermission(source, permission)
```

Routing buckets are first-class in Qbox:

```lua
exports.qbx_core:SetPlayerBucket(source, bucket)
exports.qbx_core:SetEntityBucket(entity, bucket)
exports.qbx_core:GetPlayersInBucket(bucket)
exports.qbx_core:GetEntitiesInBucket(bucket)
exports.qbx_core:GetBucketObjects()
```

The returned player object keeps the QBCore shape — `player.PlayerData`,
`player.Functions.SetJob(...)` — so QBCore knowledge mostly transfers.

## Writing for Qbox

- Use `lib.callback` rather than `QBCore.Functions.CreateCallback`.
- Use `lib.notify` / `lib.progressBar` rather than the QB equivalents.
- Use `ox_target`, not `qb-target`.
- Keep `exports.qbx_core:` for player, permission and bucket operations.

This is why Qbox code reads as a hybrid — that is the intended style, not a mistake to
"fix".
