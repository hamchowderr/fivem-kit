# Migrating a resource to ox

Line-by-line translations plus the traps that break data. Work in the order given in the
`fivem-frameworks` skill: oxmysql → ox_lib → ox_target → ox_inventory → ox_core.

---

## Database

| From | To |
|---|---|
| `MySQL.Async.fetchAll(q, p, cb)` | `MySQL.query.await(q, p)` |
| `MySQL.Async.fetchScalar(q, p, cb)` | `MySQL.scalar.await(q, p)` |
| `MySQL.Async.fetchSingle` / `MySQL.Sync.fetchSingle` | `MySQL.single.await(q, p)` |
| `MySQL.Async.execute(q, p, cb)` | `MySQL.update.await(q, p)` |
| `MySQL.Async.insert(q, p, cb)` | `MySQL.insert.await(q, p)` |
| `exports.ghmattimysql:execute(...)` | the same `MySQL.*.await` API |
| `MySQL.ready(function() end)` | not needed — oxmysql queues until ready |

Manifest: `server_scripts { '@oxmysql/lib/MySQL.lua', ... }` first, and
`dependency 'oxmysql'`.

The `await` variants yield, so they must run inside a thread, event handler or callback —
not at file top level.

---

## Callbacks

| From | To |
|---|---|
| `ESX.RegisterServerCallback(name, function(source, cb, ...) cb(v) end)` | `lib.callback.register(name, function(source, ...) return v end)` |
| `ESX.TriggerServerCallback(name, function(v) end, ...)` | `lib.callback(name, false, function(v) end, ...)` or `lib.callback.await(name, false, ...)` |
| `QBCore.Functions.CreateCallback(name, function(source, cb, ...) cb(v) end)` | `lib.callback.register(name, function(source, ...) return v end)` |
| `QBCore.Functions.TriggerCallback(name, function(v) end, ...)` | same as above |

The shape change: ox callbacks **return** a value instead of calling `cb(...)`.

---

## UI

| From | To |
|---|---|
| `ESX.ShowNotification(msg)` · `QBCore.Functions.Notify(msg, type)` | `lib.notify({ description = msg, type = 'success' })` |
| `ESX.ShowHelpNotification(msg)` | `lib.showTextUI(msg)` / `lib.hideTextUI()` |
| `QBCore.Functions.Progressbar(...)` | `lib.progressBar({ duration, label, anim, prop, disable })` |
| `qb-menu` `exports['qb-menu']:openMenu(data)` | `lib.registerContext({...})` + `lib.showContext(id)` |
| `qb-input` | `lib.inputDialog(heading, rows)` |
| `esx_menu_default` / `ESX.UI.Menu.Open` | `lib.registerContext` or `lib.registerMenu` |

---

## Targeting

| From | To |
|---|---|
| `exports['qb-target']:AddBoxZone(name, center, l, w, opts, targetOpts)` | `exports.ox_target:addBoxZone({ coords, size, rotation, options })` |
| `exports['qb-target']:AddCircleZone(name, center, radius, opts, targetOpts)` | `exports.ox_target:addSphereZone({ coords, radius, options })` |
| `exports['qb-target']:AddTargetModel(models, opts)` | `exports.ox_target:addModel(models, options)` |
| `exports['qb-target']:AddTargetEntity(entity, opts)` | `exports.ox_target:addEntity(entity, options)` |
| `exports['qb-target']:RemoveZone(name)` | `exports.ox_target:removeZone(zoneId)` |
| `qtarget` / `bt-target` | same as qb-target — ox_target is their successor |

Option-field renames: `event`/`action` → `onSelect` · `job` → `groups` ·
`item` → `items` · `canInteract` keeps its name but the signature is
`(entity, distance, coords, name, bone)`.

ox_target's `addBoxZone` takes `size` as a `vec3`, where qb-target took separate length and
width and an inconsistent height. Re-measure zones rather than converting arithmetically —
this is the most common visual regression in a qb-target migration.

---

## Player

| ESX | QBCore | ox |
|---|---|---|
| `ESX.GetPlayerFromId(src)` | `QBCore.Functions.GetPlayer(src)` | `Ox.GetPlayer(src)` |
| `xPlayer.getIdentifier()` | `Player.PlayerData.citizenid` | `player.identifier` / `player.userId` |
| `xPlayer.getCoords()` | `GetEntityCoords(GetPlayerPed(src))` | `player:getCoords()` |
| `xPlayer.getJob().name` | `Player.PlayerData.job.name` | `player:getGroupByType('job')` |
| `xPlayer.getJob().grade` | `Player.PlayerData.job.grade.level` | `player:getGroup('police')` → grade |
| `xPlayer.setJob(name, grade)` | `Player.Functions.SetJob(name, grade)` | `player:set('job', name)` + group |
| `xPlayer.getMoney()` | `Player.Functions.GetMoney('cash')` | `player:getAccount().balance` |
| `xPlayer.addMoney(n)` | `Player.Functions.AddMoney('cash', n)` | `account:deposit(n)` |
| `xPlayer.removeMoney(n)` | `Player.Functions.RemoveMoney('cash', n)` | `account:withdraw(n)` |

### Jobs vs groups — the conceptual gap

ESX and QBCore model a player as having **one job with a grade**. ox models **groups**: a
player can hold several, each with a grade, and "job" is just one group type.

That means a straight port loses nothing, but the reverse does. When migrating:

- `xPlayer.getJob().name == 'police'` → `player:getGroup('police')` returns a grade or nil.
  Check `if player:getGroup('police') then`, not `== 'police'`.
- Grade comparisons flip shape: ESX/QB compare `grade >= 2`; ox gives you the grade
  directly from `getGroup`.
- Duty state (`job.onduty` in QB) has no direct ox equivalent — model it yourself, usually
  as a separate group or a statebag value.

### Money — the migration that loses data if rushed

- ESX: multiple named accounts (`money`, `bank`, `black_money`), each an integer column.
- QBCore: `PlayerData.money` table keyed `cash` / `bank` / `crypto`.
- ox: `OxAccount` objects, with shared and group accounts as first-class things.

There is no automatic mapping. Decide explicitly which legacy account becomes which ox
account, write the SQL migration by hand, and **back up the database first**. Cash and bank
being silently merged is the failure people notice a week later.

---

## Inventory

| From | To |
|---|---|
| `xPlayer.addInventoryItem(item, count)` | `exports.ox_inventory:AddItem(src, item, count)` |
| `xPlayer.removeInventoryItem(item, count)` | `exports.ox_inventory:RemoveItem(src, item, count)` |
| `xPlayer.getInventoryItem(item).count` | `exports.ox_inventory:GetItemCount(src, item)` |
| `Player.Functions.AddItem(item, count, slot, info)` | `exports.ox_inventory:AddItem(src, item, count, metadata, slot)` |
| `Player.Functions.RemoveItem(item, count, slot)` | `exports.ox_inventory:RemoveItem(src, item, count, metadata, slot)` |
| `Player.Functions.HasItem(item)` | `exports.ox_inventory:GetItemCount(src, item) > 0` |
| QB `info` table | ox `metadata` table |

Traps:

- **Item definitions move** from `qb-core/shared/items.lua` or `esx` SQL into
  `ox_inventory/data/items.lua`, with different field names and real weights.
- **QB `info` → ox `metadata`** is a rename *and* a semantic change: ox uses metadata for
  durability, serials and stacking identity. Items that stacked before may stop stacking.
- **Weight becomes real.** ESX/QB servers often ship nominal weights; ox enforces them.
  Expect players to be over capacity on first load unless you audit the item data.
- `AddItem` can fail on weight or slots. Always check the return before taking payment.

---

## Post-migration checklist

- [ ] every `MySQL.Async` / `ghmattimysql` call replaced, `@oxmysql/lib/MySQL.lua` imported
- [ ] every callback converted to return-style, no orphaned `cb(...)` parameters
- [ ] `job.grade.level` / `getJob().grade` comparisons rewritten for groups
- [ ] target zones re-measured, `event` → `onSelect`, `job` → `groups`, `item` → `items`
- [ ] item definitions ported with real weights; metadata vs info reviewed
- [ ] every `AddItem` return value checked
- [ ] database backed up before the inventory and money migrations
- [ ] full security re-audit — porting is exactly when validation gets dropped
      (see the `fivem-security` skill)
