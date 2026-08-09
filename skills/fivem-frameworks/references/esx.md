# ESX Legacy reference

Verified against the `esx_core` sources. Resource folder: `es_extended`.

## Getting the object

```lua
ESX = exports['es_extended']:getSharedObject()
```

Older code uses an event-based handshake — still supported but not preferred:

```lua
TriggerEvent('esx:getSharedObject', function(obj) ESX = obj end)
```

ESX also ships `@es_extended/imports.lua`, which does the export call for you:

```lua
-- fxmanifest.lua
shared_script '@es_extended/imports.lua'
```

## Server — player lookup

```lua
local xPlayer = ESX.GetPlayerFromId(source)
local xPlayer = ESX.GetPlayerFromIdentifier(identifier)
local xPlayers = ESX.GetExtendedPlayers()
```

Guard it: `if not xPlayer then return end`.

## xPlayer methods

Note ESX uses **dot** call syntax (`xPlayer.getMoney()`), not colon.

```lua
xPlayer.getIdentifier()
xPlayer.getName() / xPlayer.setName(name)
xPlayer.getCoords(vector, heading) / xPlayer.setCoords(coords)

xPlayer.getMoney()                       -- cash
xPlayer.setMoney(amount)
xPlayer.addMoney(amount, reason)
xPlayer.removeMoney(amount, reason)
xPlayer.getAccount(name)                 -- 'bank', 'black_money', 'money'
xPlayer.getAccounts(minimal)

xPlayer.getJob()                         -- { name, grade, grade_label, label, ... }
xPlayer.setJob(name, grade)

xPlayer.getGroup() / xPlayer.setGroup(group)   -- admin group, not job
xPlayer.isAdmin()

xPlayer.getInventory(minimal)
xPlayer.getLoadout(minimal)

xPlayer.get(key) / xPlayer.set(key, value)
xPlayer.getSSN()
xPlayer.getPlayTime()
xPlayer.triggerEvent(eventName, ...)
xPlayer.kick(reason)
xPlayer.togglePaycheck(toggle) / xPlayer.isPaycheckEnabled()
```

## Callbacks

```lua
-- server
ESX.RegisterServerCallback('myresource:getSomething', function(source, cb, arg)
    cb(result)
end)

-- client
ESX.TriggerServerCallback('myresource:getSomething', function(result)
end, arg)
```

Same warning as everywhere: `source` in the server callback is trustworthy, `arg` is not.

## Client

```lua
local playerData = ESX.GetPlayerData()
ESX.ShowNotification('message')
ESX.ShowAdvancedNotification(title, subject, msg, icon, iconType)
ESX.ShowHelpNotification('message')
ESX.Game.SpawnVehicle(model, coords, heading, cb)
ESX.Game.GetClosestPlayer()
ESX.Game.GetVehicleProperties(vehicle)
ESX.Game.SetVehicleProperties(vehicle, props)
```

## Events worth knowing

| Event | Fires |
|---|---|
| `esx:playerLoaded` | client + server, when a player finishes loading |
| `esx:playerDropped` | server, on disconnect |
| `esx:setJob` | job changed |
| `esx:setAccountMoney` | account balance changed |
| `esx:getSharedObject` | legacy object handshake |

## ESX traps

- **Dot, not colon.** `xPlayer:getMoney()` is a runtime error.
- **Accounts are not cash.** `getMoney()` is cash only; bank is
  `getAccount('bank').money`. Mixing them up is the classic ESX money bug.
- **`removeMoney` does not check the balance for you** in all versions — verify first, or
  you can drive a player negative.
- **`getJob().grade` is a number, `grade_name` is the string.** Comparing the wrong one
  silently fails every permission check.
- Legacy addons may still call `ESX.GetPlayerFromId` before ESX is ready; wait for
  `esx:playerLoaded` rather than assuming availability at resource start.
