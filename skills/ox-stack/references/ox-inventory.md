# ox_inventory reference

Verified against ox_inventory v2.44.1. Depends on ox_lib and oxmysql.

`inv` throughout is either a player server id (number) or an inventory id (string).

## Server exports — items

```lua
exports.ox_inventory:AddItem(inv, item, count, metadata, slot, cb)
exports.ox_inventory:RemoveItem(inv, item, count, metadata, slot)
exports.ox_inventory:GetItem(inv, item, metadata, returnCount)
exports.ox_inventory:Search(inv, search, item, metadata)   -- search: 'slots' | 'count'
exports.ox_inventory:GetItemCount(inv, item, metadata, strict)
exports.ox_inventory:SetItem(inv, item, count, metadata)
```

`AddItem` can fail (weight/slots). Check the result before treating the give as done,
and take payment only after the item is confirmed added.

## Server exports — slots

```lua
exports.ox_inventory:GetSlot(inv, slot)
exports.ox_inventory:GetEmptySlot(inv)
exports.ox_inventory:GetSlotWithItem(inv, item, metadata, strict)
exports.ox_inventory:GetSlotIdWithItem(inv, item, metadata, strict)
exports.ox_inventory:GetSlotsWithItem(inv, item, metadata, strict)
exports.ox_inventory:GetSlotIdsWithItem(inv, item, metadata, strict)
exports.ox_inventory:GetSlotForItem(inv, item, metadata)
exports.ox_inventory:SwapSlots(inv, fromSlot, toSlot)
```

## Server exports — inventories

```lua
exports.ox_inventory:GetInventory(inv, owner)
exports.ox_inventory:GetInventoryItems(inv, owner)
exports.ox_inventory:GetContainerFromSlot(inv, slot)
exports.ox_inventory:RemoveInventory(inv)
exports.ox_inventory:ClearInventory(inv, keep)
exports.ox_inventory:ConfiscateInventory(source)
exports.ox_inventory:ReturnInventory(source)
exports.ox_inventory:InspectInventory(source, inv)
```

Capacity:

```lua
exports.ox_inventory:SetSlotCount(inv, slots)
exports.ox_inventory:SetMaxWeight(inv, weight)
exports.ox_inventory:CanCarryItem(inv, item, count, metadata)
exports.ox_inventory:CanCarryAmount(inv, item, count, metadata)
exports.ox_inventory:CanCarryWeight(inv, weight)
exports.ox_inventory:CanSwapItem(inv, firstItem, firstCount, secondItem, secondCount)
```

## Item properties

```lua
exports.ox_inventory:SetDurability(inv, slot, durability)
exports.ox_inventory:SetMetadata(inv, slot, metadata)
exports.ox_inventory:GetCurrentWeapon(source)
```

## Stashes

```lua
exports.ox_inventory:RegisterStash(stashId, label, slots, maxWeight, owner, groups, coords)
exports.ox_inventory:CreateTemporaryStash(data)   -- dropped when the resource stops
```

`owner` and `groups` are the access control. A stash registered with `owner = false` is
open to everyone — that is almost never what a job stash wants.

## Drops

```lua
exports.ox_inventory:CustomDrop(prefix, items, coords, slots, maxWeight, instance, model)
exports.ox_inventory:CreateDropFromPlayer(playerId)
```

## Vehicles and shops

```lua
exports.ox_inventory:UpdateVehicle(vehicle, data)
exports.ox_inventory:RegisterShop(shopType, shopDetails)
```

## Item definitions

```lua
exports.ox_inventory:Items(item)      -- definition(s)
exports.ox_inventory:ItemList(item)   -- alias
```

## Hooks (server)

Intercept inventory actions. Return `false` to block.

```lua
local hookId = exports.ox_inventory:registerHook('swapItems', function(payload)
    return true
end, { itemFilter = { water = true } })

exports.ox_inventory:removeHooks(hookId)
```

Events include `swapItems`, `buyItem`, `openInventory`.

## Client exports

```lua
exports.ox_inventory:Search(search, item, metadata)
exports.ox_inventory:GetPlayerItems()
exports.ox_inventory:GetPlayerWeight()
exports.ox_inventory:GetPlayerMaxWeight()
exports.ox_inventory:GetSlotWithItem(item, metadata, strict)
exports.ox_inventory:GetSlotIdWithItem(item, metadata, strict)
exports.ox_inventory:GetSlotsWithItem(item, metadata, strict)
exports.ox_inventory:GetItemCount(item, metadata)
exports.ox_inventory:Items(item)
exports.ox_inventory:ItemList(item)
exports.ox_inventory:displayMetadata(metadata, value)
exports.ox_inventory:weaponWheel(state)
```

> Client inventory reads are for **display only**. A client reporting it holds an item is
> not evidence it does. Any server action gated on an item must call the server-side
> `GetItemCount` / `Search` itself.
