# ESX Legacy reference

Every symbol here was read out of `es_extended` source, not recalled. ESX uses **dot syntax**
on the player object throughout — `xPlayer.getMoney()`, never `xPlayer:getMoney()` — which is
the single most common mistake when coming from ox or QBCore.

---

## Getting the object

```lua
-- server and client, current recommended form
ESX = exports['es_extended']:getSharedObject()
```

Older tutorials use a `esx:getSharedObject` event with a callback, or
`TriggerEvent('esx:getSharedObject', function(obj) ESX = obj end)`. Both still appear in the
wild; the export is the current form and is synchronous.

---

## Server — finding players

```lua
ESX.GetPlayerFromId(source)                  -- xPlayer, or nil
ESX.GetPlayerFromIdentifier(identifier)      -- by licence/steam identifier
ESX.GetPlayerIdFromIdentifier(identifier)    -- server id from an identifier
ESX.GetExtendedPlayers(key, val)             -- every xPlayer, optionally filtered
ESX.GetPlayers()                             -- server ids only
ESX.GetNumPlayers()
ESX.IsPlayerLoaded(source)                   -- character selected and spawned?
ESX.GetIdentifier(source)
```

`GetExtendedPlayers('job', 'police')` is how you reach every on-duty officer without looping
`GetPlayers()` and resolving each one.

---

## xPlayer — the player object

The full method set, grouped by what you'd reach for.

### Money and accounts

```lua
xPlayer.getMoney()                           -- cash
xPlayer.setMoney(amount)
xPlayer.addMoney(amount, reason)
xPlayer.removeMoney(amount, reason)

xPlayer.getAccount(name)                     -- 'money' | 'bank' | 'black_money'
xPlayer.getAccounts(minimal)
xPlayer.addAccountMoney(account, amount, reason)
xPlayer.removeAccountMoney(account, amount, reason)
xPlayer.setAccountMoney(account, amount, reason)
```

**`removeAccountMoney` does not stop you going negative on its own** — check the balance
first, in the same server-side handler, and never trust an amount that arrived from a client.

### Inventory and weapons

```lua
xPlayer.getInventory(minimal)
xPlayer.getInventoryItem(name)
xPlayer.addInventoryItem(name, count)
xPlayer.removeInventoryItem(name, count)
xPlayer.setInventoryItem(name, count)
xPlayer.hasItem(item)
xPlayer.canCarryItem(name, count)            -- ALWAYS check before adding
xPlayer.canSwapItem(firstItem, firstCount, testItem, testCount)
xPlayer.getWeight() / xPlayer.getMaxWeight() / xPlayer.setMaxWeight(w)

xPlayer.addWeapon(name, ammo)
xPlayer.removeWeapon(name)
xPlayer.hasWeapon(name)
xPlayer.getWeapon(name)
xPlayer.addWeaponAmmo(name, ammo) / removeWeaponAmmo / updateWeaponAmmo
xPlayer.addWeaponComponent(name, component) / removeWeaponComponent / hasWeaponComponent
xPlayer.getLoadout(minimal)
xPlayer.getWeaponTint(name) / setWeaponTint(name, tint)
```

`canCarryItem` before `addInventoryItem`, every time — skipping it is how items vanish
silently when a player is at capacity.

### Job, group and identity

```lua
xPlayer.getJob()                             -- { name, grade, grade_name, grade_label, ... }
xPlayer.setJob(name, grade)
xPlayer.getGroup() / xPlayer.setGroup(group) -- admin group, NOT the job
xPlayer.isAdmin()
xPlayer.getIdentifier()
xPlayer.getName() / xPlayer.setName(name)
xPlayer.getSSN()
xPlayer.getPlayTime()
xPlayer.getSource()
```

**`getJob()` and `getGroup()` are different things.** The job is employment; the group is the
permission tier. Checking `getJob().name == 'admin'` is a common and wrong way to gate a
command — use `getGroup()` or `isAdmin()`.

`getJob().grade` is a **number** in ESX. (QBCore makes it a table — see `qbcore.md`.)

### Position and metadata

```lua
xPlayer.getCoords(vector, heading)
xPlayer.setCoords(coords)
xPlayer.getMeta(key, subKey) / setMeta / clearMeta
xPlayer.get(key) / xPlayer.set(key, value)   -- arbitrary runtime data, not persisted
```

### Notifications and control

```lua
xPlayer.showNotification(msg, ...)
xPlayer.showAdvancedNotification(sender, subject, msg, icon, iconType, ...)
xPlayer.showHelpNotification(msg, ...)
xPlayer.triggerEvent(name, ...)              -- TriggerClientEvent for this player
xPlayer.kick(reason)
xPlayer.executeCommand(command)
xPlayer.togglePaycheck(enabled) / isPaycheckEnabled()
```

---

## Server — items, jobs and commands

```lua
ESX.RegisterUsableItem(item, cb)             -- cb(source)
ESX.UseItem(source, item, ...)
ESX.GetUsableItems()
ESX.GetItems() / ESX.GetItemLabel(item)

ESX.GetJobs() / ESX.DoesJobExist(job, grade) / ESX.RefreshJobs()

ESX.RegisterCommand(name, group, cb, allowConsole, suggestion)
```

**`ESX.RegisterCommand` takes the permission group as its second argument**, so the gate is
declared rather than hand-written. A command registered this way is already restricted; a raw
`RegisterCommand` is not, and that is SEC-7.

```lua
ESX.RegisterCommand('setjob', 'admin', function(xPlayer, args, showError)
    args.playerId.setJob(args.job, args.grade)
end, true, { help = 'Set a job', validate = true, arguments = {
    { name = 'playerId', help = 'Player id', type = 'player' },
    { name = 'job',      help = 'Job name',  type = 'string' },
    { name = 'grade',    help = 'Grade',     type = 'number' },
}})
```

With `validate = true` and typed `arguments`, the handler receives validated values — a
`type = 'player'` argument arrives as an xPlayer, not a raw id.

---

## Callbacks

```lua
-- SERVER
ESX.RegisterServerCallback('myresource:getStock', function(source, cb, item)
    cb(Stock[item])                          -- you MUST call cb
end)

-- CLIENT
ESX.TriggerServerCallback('myresource:getStock', function(stock)
    print(stock)
end, 'bread')
```

ESX callbacks are **callback-style, not return-style**: the server handler calls `cb(...)`
rather than returning. Forgetting `cb` leaves the client waiting forever. (ox's
`lib.callback` returns instead — see the migration map.)

---

## Client

```lua
ESX.GetPlayerData()                          -- the cached PlayerData table
ESX.SetPlayerData(key, val)
ESX.IsPlayerLoaded()
ESX.PlayerData / ESX.PlayerLoaded

ESX.ShowNotification(msg)
ESX.ShowAdvancedNotification(sender, subject, msg, icon, iconType)
ESX.ShowHelpNotification(msg, thisFrame, beep, duration)
ESX.ShowFloatingHelpNotification(msg, coords)
ESX.TextUI(message, type) / ESX.HideUI()

ESX.Progressbar(label, duration, options)
ESX.CancelProgressbar()

ESX.OpenContext(position, elements, onSelect, onClose)
ESX.CloseContext() / ESX.RefreshContext() / ESX.PreviewContext()

ESX.ShowInventory() / ESX.SearchInventory()
ESX.RegisterInput(command, label, inputGroup, key, onPress, onRelease)
ESX.SpawnPlayer(model, coords, cb)
ESX.Game.*                                   -- entity and vehicle helpers
ESX.SecureNetEvent(name, cb)                 -- see below
```

**`ESX.SecureNetEvent`** registers a net event that verifies the source before running the
handler. Prefer it over a bare `RegisterNetEvent` for anything sensitive.

---

## Events

```lua
'esx:playerLoaded'          -- (playerId, xPlayer, isNew) server · (xPlayer, isNew) client
'esx:playerDropped'
'esx:setJob'                -- job changed
'esx:updatePlayerData'      -- any PlayerData field changed, client
'esx:setAccountMoney'
'esx:addInventoryItem' / 'esx:removeInventoryItem'
'esx:addWeapon' / 'esx:removeWeapon' / 'esx:setWeaponAmmo'
'esx:showNotification' / 'esx:showAdvancedNotification' / 'esx:showHelpNotification'
'esx:jobCreated'
```

---

## ESX traps

**Dot, not colon.** `xPlayer.getMoney()`. A colon passes the object as an implicit first
argument and the method silently misbehaves.

**`getJob().grade` is a number.** Code ported from QBCore that reads `job.grade.level` will
be nil here.

**Job is not permission.** `getJob()` is employment, `getGroup()` / `isAdmin()` is authority.

**`cb` is mandatory in a server callback.** No `cb`, no response, and the client hangs.

**`canCarryItem` before adding.** Otherwise items disappear at capacity with no error.

**Money can go negative.** Nothing stops `removeAccountMoney` below zero — check first, in the
same handler, server-side.

**The shared object is not instant on client start.** Guard on `ESX.IsPlayerLoaded()` or wait
for `esx:playerLoaded` before touching `PlayerData`.
