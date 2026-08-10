# QBCore and Qbox reference

Every symbol here was read out of `qb-core` and `qbx_core` source, not recalled.

---

# QBCore

## Getting the object

```lua
QBCore = exports['qb-core']:GetCoreObject()
```

Some older resources use `TriggerEvent('QBCore:GetObject', function(obj) QBCore = obj end)`.
The export is current and synchronous.

---

## Server — finding players

```lua
QBCore.Functions.GetPlayer(source)              -- Player object, or nil
QBCore.Functions.GetPlayerByCitizenId(cid)
QBCore.Functions.GetPlayerByLicense(license)
QBCore.Functions.GetPlayerByPhone(number)
QBCore.Functions.GetPlayerByAccount(account)
QBCore.Functions.GetPlayerByCharInfo(property, value)
QBCore.Functions.GetOfflinePlayerByCitizenId(cid)

QBCore.Functions.GetPlayers()                   -- server ids
QBCore.Functions.GetQBPlayers()                 -- id -> Player map
QBCore.Functions.GetPlayersByJob(job)
QBCore.Functions.GetPlayersOnDuty(job)
QBCore.Functions.GetDutyCount(job)
QBCore.Functions.GetIdentifier(source, type)
QBCore.Functions.GetSource(identifier)
```

`GetPlayersOnDuty` and `GetDutyCount` are the right way to reach active police or EMS — duty
state is separate from having the job.

---

## The Player object

Data lives on `Player.PlayerData`; actions live on `Player.Functions`.

### PlayerData

```lua
Player.PlayerData.citizenid      -- the stable identity; use this for database keys
Player.PlayerData.license
Player.PlayerData.source
Player.PlayerData.cid
Player.PlayerData.name
Player.PlayerData.charinfo       -- { firstname, lastname, birthdate, gender, phone, ... }
Player.PlayerData.job            -- see the warning below
Player.PlayerData.gang
Player.PlayerData.money          -- { cash, bank, crypto }
Player.PlayerData.items
Player.PlayerData.metadata
Player.PlayerData.position
```

> **`job.grade` is a TABLE, not a number.**
>
> ```lua
> Player.PlayerData.job.grade        -- { name = 'sergeant', level = 3 }
> Player.PlayerData.job.grade.level  -- 3   ← what you almost always want
> ```
>
> `if job.grade >= 3` compares a table to a number and is always false. This is the single
> most common QBCore bug in AI-written code, and it fails silently rather than erroring.
>
> Also on the job table: `job.name`, `job.label`, `job.onduty`, `job.isboss`,
> `job.payment`. **`onduty` matters** — having the police job is not the same as being on duty.

### Player methods

> **QBCore restructured this.** Methods are now defined on a `Player` class and called with a
> **colon**: `Player:AddMoney(...)`. The old `Player.Functions.AddMoney(...)` still works — the
> core builds a `.Functions` table that wraps each method — but it is a compatibility shim, not
> the current API. Most tutorials and most existing resources still use `.Functions`.
>
> Write the colon form in new code. Expect the dot form everywhere else.

```lua
Player:AddMoney(moneytype, amount, reason)      -- 'cash' | 'bank' | 'crypto'
Player:RemoveMoney(moneytype, amount, reason)   -- returns FALSE if unaffordable
Player:SetMoney(moneytype, amount, reason)
Player:GetMoney(moneytype)

Player:SetJob(job, grade)
Player:SetGang(gang, grade)
Player:SetJobDuty(onDuty)

Player:GetMetaData(key) / Player:SetMetaData(key, value)
Player:GetRep(type) / Player:AddRep(type, amount) / Player:RemoveRep(type, amount)
Player:HasItem(items, amount)
Player:GetName()

Player:SetPlayerData(key, val)
Player:UpdateClient()
Player:AddField(name, data) / Player:AddMethod(name, method)
Player:Save()
Player:Logout()
Player:Notify(text, type, length)
```

Every one of those is also reachable as `Player.Functions.<Name>(...)` without the receiver —
the shim binds the player for you, which is why the dot form takes no `self`.

**`RemoveMoney` returns a boolean.** It returns `false` when the player can't afford it and
takes nothing — so calling it without checking the return is how a shop gives away goods for
free.

```lua
if not Player:RemoveMoney('bank', price, 'shop-purchase') then
    return -- they could not pay; do NOT hand over the item
end
```

---

## Server — items, permissions and vehicles

```lua
QBCore.Functions.CreateUseableItem(item, cb)     -- cb(source, item)
QBCore.Functions.CanUseItem(item)
QBCore.Functions.UseItem(source, item)
QBCore.Functions.HasItem(source, items, amount)

QBCore.Functions.AddPermission(source, permission)
QBCore.Functions.RemovePermission(source, permission)
QBCore.Functions.HasPermission(source, permission)
QBCore.Functions.GetPermission(source)
QBCore.Functions.IsWhitelisted(source)
QBCore.Functions.IsPlayerBanned(source)
QBCore.Functions.IsLicenseInUse(license)

QBCore.Functions.CreateVehicle(source, model, coords, warp)
QBCore.Functions.CreateAutomobile(source, model, coords, warp)
QBCore.Functions.SpawnVehicle(source, model, coords, warp)
QBCore.Functions.DeleteVehicle(vehicle)          -- client

QBCore.Functions.SetPlayerBucket(source, bucket)
QBCore.Functions.SetEntityBucket(entity, bucket)
QBCore.Functions.GetPlayersInBucket(bucket)
QBCore.Functions.GetEntitiesInBucket(bucket)

QBCore.Functions.Kick(source, reason, setKickReason, deferrals)
QBCore.Functions.Notify(source, text, type, length)
```

**Permission is `HasPermission`, not the job.** Gating an admin command on
`job.name == 'police'` is authority-by-employment and is SEC-7 territory.

---

## Callbacks

```lua
-- SERVER
QBCore.Functions.CreateCallback('myresource:getStock', function(source, cb, item)
    cb(Stock[item])                              -- you MUST call cb
end)

-- CLIENT
QBCore.Functions.TriggerCallback('myresource:getStock', function(stock)
    print(stock)
end, 'bread')
```

Like ESX, QBCore callbacks are **callback-style**: the handler calls `cb(...)` rather than
returning. There is also `CreateClientCallback` / `TriggerClientCallback` for the reverse
direction.

---

## Client

```lua
QBCore.Functions.GetPlayerData()                 -- cached PlayerData
QBCore.Functions.Notify(text, type, length)
QBCore.Functions.Progressbar(name, label, duration, useWhileDead, canCancel, disableControls, animation, prop, propTwo, onFinish, onCancel)
QBCore.Functions.TriggerCallback(name, cb, ...)

QBCore.Functions.GetClosestPlayer(coords)        -- returns player, distance
QBCore.Functions.GetClosestVehicle(coords)
QBCore.Functions.GetClosestPed(coords, ignoreList)
QBCore.Functions.GetClosestObject(coords)
QBCore.Functions.GetClosestBone(entity, list)
QBCore.Functions.GetBoneDistance(entity, boneType, bone)

QBCore.Functions.GetVehicleProperties(vehicle)
QBCore.Functions.SetVehicleProperties(vehicle, props)
QBCore.Functions.GetPlate(vehicle) / GetVehicleLabel(vehicle)
QBCore.Functions.SpawnVehicle(model, cb, coords, isnetworked, teleport)
QBCore.Functions.DeleteVehicle(vehicle)

QBCore.Functions.LoadModel(model) / LoadAnimSet(set) / RequestAnimDict(dict)
QBCore.Functions.PlayAnim(animDict, animName, upperbodyOnly, duration)
QBCore.Functions.AttachProp(...) / LookAtEntity(...)
QBCore.Functions.StartParticleAtCoord(...) / StartParticleOnEntity(...)
QBCore.Functions.DrawText(x, y, width, height, scale, r, g, b, a, text)
QBCore.Functions.GetStreetNametAtCoords(coords)  -- note the typo, it is in the API
QBCore.Functions.GetZoneAtCoords(coords)
QBCore.Functions.GetCardinalDirection()
QBCore.Functions.GetCurrentTime()
```

`GetStreetNametAtCoords` is misspelled **in QBCore itself**. Spelling it correctly gives you
a nil function.

---

## Events

```lua
'QBCore:Server:OnPlayerLoaded'
'QBCore:Client:OnPlayerLoaded'
'QBCore:Server:OnPlayerUnload' / 'QBCore:Client:OnPlayerUnload'
'QBCore:Server:UpdateObject' / 'QBCore:Client:UpdateObject'
'QBCore:Player:SetPlayerData'
'QBCore:Client:OnJobUpdate' / 'QBCore:Client:OnGangUpdate'
'QBCore:Notify'
```

---

## QBCore traps

**`job.grade` is a table.** `job.grade.level` is the number. This is the big one.

**`RemoveMoney` returns a boolean.** Ignoring it gives away goods for free.

**Duty is not employment.** `job.onduty` gates active work; `job.name` only says who employs
them.

**Permission is not the job.** Use `HasPermission`, not a job-name comparison.

**`citizenid` is the stable key.** `source` changes every session; `license` is per-account.
Database rows key on `citizenid`.

**`GetStreetNametAtCoords` is misspelled upstream.** Copy the typo.

---

# Qbox (qbx_core)

Qbox is a **hybrid**: `qbx_core` for players and jobs, but ox_lib, ox_target and often
ox_inventory for everything else. Writing pure QBCore for a Qbox server misses half the stack;
writing pure ox misses the player layer.

## Server

```lua
exports.qbx_core:GetPlayer(source)
exports.qbx_core:GetPlayerByCitizenId(citizenid)
exports.qbx_core:GetPlayers()
exports.qbx_core:GetQBPlayers()
exports.qbx_core:CreateUseableItem(item, cb)
exports.qbx_core:AddMoney(source, moneytype, amount, reason)
exports.qbx_core:RemoveMoney(source, moneytype, amount, reason)
```

The player object keeps QBCore's shape — `PlayerData.job.grade` is still a table with
`.level` — so the QBCore traps above apply unchanged.

## Everything else is ox

```lua
lib.callback.register('resource:getThing', function(source, arg) return value end)  -- returns!
lib.notify({ description = 'text' })
lib.progressBar({ duration = 5000, label = 'Working' })
exports.ox_target:addBoxZone({ ... })
exports.ox_inventory:AddItem(source, item, count)
```

**ox callbacks return; QBCore callbacks call `cb`.** On a Qbox server you will write both
styles in the same resource — `lib.callback.register` returns a value, while anything still
going through `qbx_core` may not.

## Writing for Qbox

Detect it properly: `qbx_core` present means Qbox, even though `qb-core` compatibility shims
may also be installed. Use `qbx_core` exports for players and money, ox_lib for callbacks,
notifications and UI, and ox_target for interaction. See `ox-stack/` for the ox half.
