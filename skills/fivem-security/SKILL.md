---
name: fivem-security
description: Audit FiveM Lua resources for exploitable server-side flaws — unvalidated net events, client-supplied prices and quantities, missing distance and permission checks, SQL injection, leaked API keys in client scripts, unrestricted admin commands, and money duplication races. Use when reviewing, auditing, or hardening any FiveM resource, or when writing a server-side event handler or callback.
---

# FiveM resource security

Nearly every serious FiveM exploit reduces to one sentence: **the server believed
something a client told it.** A player running a modified client or an executor can fire
any registered net event, with any arguments, from anywhere on the map, at any rate.

Audit against the rules below. Each has a detection pattern and a fix.

## The threat model, stated once

| The client controls | The server owns |
|---|---|
| which events fire, when, how often | whether the action is allowed |
| every argument passed | price, quantity limits, cooldowns |
| its reported position, job, items | actual position, group, inventory |
| whether progress bars / skill checks / `canInteract` ever ran | the real requirements |

Client-side UI gating (`canInteract`, `groups`, `items`, a progress bar, a disabled
button) is **presentation**. It never enforces anything.

---

## Rules

### SEC-1 — Unvalidated net event handler · CRITICAL

A `RegisterNetEvent` / `AddEventHandler` server handler that acts on its parameters
without checking them.

**Detect:** server-side `RegisterNetEvent` whose callback reaches a state mutation
(`:set(`, `AddItem`, `withdraw`, `MySQL.update`, `SetEntityCoords`, job/group assignment)
with no guard between entry and mutation.

**Fix:** validate every parameter against server-side config, then re-check the player's
right to do it:

```lua
RegisterNetEvent('shop:buy', function(shopId, itemName)
    local src = source
    local player = Ox.GetPlayer(src)
    if not player then return end
    local shop = Config.shops[shopId]           -- must exist
    if not shop or not shop.items[itemName] then return end
    if #(player:getCoords() - shop.coords) > 5.0 then return end
    -- only now act
end)
```

### SEC-2 — Client-supplied price, amount, or reward · CRITICAL

**Detect:** a numeric parameter named `price`, `amount`, `cost`, `reward`, `value`,
`count`, `qty` flowing from a net event / NUI callback into an account or inventory
mutation.

**Fix:** the client names *what*, the server looks up *how much*. Bound and integer-check
any genuine quantity:

```lua
count = tonumber(count)
if not count or count % 1 ~= 0 or count < 1 or count > 100 then return end
local price = Config.items[itemName].price      -- server-side
```

### SEC-3 — `source` lost across a yield · HIGH

`source` is a magic global valid at handler entry. After any `await`, `Wait`, or callback
boundary it may be a different player or `nil`.

**Detect:** use of `source` after `.await(`, `Citizen.Wait`, `MySQL.*.await`, or inside a
nested closure.

**Fix:** `local src = source` as the first line, then use `src` throughout.

### SEC-4 — Missing distance check · HIGH

Interaction events that never confirm the player is near the thing.

**Detect:** a handler for a location-bound action (shop, ATM, door, stash, job point)
with no `#(playerCoords - targetCoords)` comparison.

**Fix:** `if #(player:getCoords() - target.coords) > 5.0 then return end`. Allow a little
slack for latency; 2–5 units is typical.

### SEC-5 — SQL injection · CRITICAL

**Detect:** `MySQL.` or `exports.oxmysql` query strings built with `..` concatenation or
`string.format`/`('%s'):format` interpolation of a runtime value.

**Fix:** `?` placeholders with a parameter table, always:

```lua
MySQL.single.await('SELECT * FROM vehicles WHERE plate = ?', { plate })
```

### SEC-6 — Check-then-act race (money/item duplication) · HIGH

Reading a balance, then deducting it in a separate statement, lets two concurrent
requests both pass the read.

**Detect:** a balance/count read followed by a separate write of the same field, with a
yield between them.

**Fix:** make it one conditional statement, and confirm rows were affected:

```lua
local affected = MySQL.update.await(
    'UPDATE characters SET cash = cash - ? WHERE charId = ? AND cash >= ?',
    { amount, charId, amount })
if affected == 0 then return end     -- they did not have it
```

Order matters too: add the item *first*, take payment only once the add succeeded.

### SEC-7 — Unrestricted admin command · CRITICAL

**Detect:** `RegisterCommand` with no ACE check, or `lib.addCommand` with
`restricted = false` / the field absent, on anything that grants money, items, or
teleports.

**Fix:** `restricted = 'group.admin'` on `lib.addCommand`, or
`IsPlayerAceAllowed(src, 'command.x')` inside a raw `RegisterCommand`.

### SEC-8 — Secret in a client script · CRITICAL

API keys, webhook URLs, and database credentials in `client_scripts` (or in
`shared_scripts`) are shipped to every player and trivially dumped.

**Detect:** a long opaque string literal, `discord.com/api/webhooks`, `Bearer `, `sk-`,
`api_key`, `token`, or a connection string in a file listed under `client_scripts` or
`shared_scripts` in the fxmanifest.

**Fix:** move to `server_scripts`; read from a convar (`GetConvar('my_key', '')`) set in
`server.cfg`, and keep that cfg out of version control. A Discord webhook posted from a
client script is a permanent spam relay.

### SEC-9 — Server-side permission missing behind client-side gating · HIGH

**Detect:** an `ox_target` option with `groups` / `items` / `canInteract`, or a menu only
shown to some players, whose `onSelect` triggers a server event that does not re-check.

**Fix:** repeat the check server-side — `player:getGroup('police')`,
`exports.ox_inventory:GetItemCount(src, item)`.

### SEC-10 — Code execution from client input · CRITICAL

**Detect:** `load(`, `loadstring(`, `assert(load`, `ExecuteCommand(`, or
`PerformHttpRequest` with a URL or body assembled from event parameters.

**Fix:** never evaluate client input. Allow-list commands and URLs rather than
constructing them.

### SEC-11 — No rate limiting on an expensive or valuable action · MEDIUM

**Detect:** an event that mints items/money, writes to the database, or makes an HTTP
request, with no per-player cooldown.

**Fix:** a timestamp table keyed by player, checked at handler entry.

### SEC-12 — Overbroad broadcast · MEDIUM

**Detect:** `TriggerClientEvent(..., -1, ...)` carrying identifiers, positions, balances,
or admin state.

**Fix:** send to the players who need it. `-1` broadcasts to everyone, including whoever
is logging your events.

### SEC-13 — Internal event exposed to the network · MEDIUM

**Detect:** `RegisterNetEvent` on an event only ever triggered by the resource itself
(`TriggerEvent`, not `TriggerServerEvent`).

**Fix:** drop the `RegisterNetEvent`. Registering it makes a purely internal event
callable by every client.

### SEC-14 — Identifier trusted for authorisation · MEDIUM

**Detect:** authorisation decided from `GetPlayerIdentifiers` indexed positionally
(`identifiers[1]`), or from an `ip:` identifier.

**Fix:** search for the `license:` prefix explicitly; never trust `ip:`, and never assume
identifier ordering is stable.

### SEC-15 — NUI callback trusted · HIGH

**Detect:** `RegisterNUICallback` whose data is forwarded to the server unvalidated.

**Fix:** treat NUI data exactly like net-event data — the browser context is fully under
player control.

---

## Non-security defects worth flagging in the same pass

| Rule | Issue | Fix |
|---|---|---|
| PERF-1 | `while true do` with no `Citizen.Wait` | freezes the client's game — add `Wait(0)` minimum |
| PERF-2 | expensive natives called every frame | cache in a slower thread; use ox_lib `cache.*` |
| PERF-3 | per-frame distance loops over many points | use `lib.zones.*` |
| COMPAT-1 | `__resource.lua` | rename to `fxmanifest.lua`, add `fx_version 'cerulean'` |
| COMPAT-2 | `MySQL.Async.*`, `ghmattimysql` | migrate to oxmysql `await` API |

---

## Reporting format

When auditing, report findings **most severe first**, each as:

```
[SEC-2 · CRITICAL] server/shop.lua:41
Price is taken from the client.
  → `TriggerServerEvent('shop:buy', item, price)` lets any player set their own price.
Fix: look the price up from Config.shops[shopId].items[item] server-side.
```

State the concrete exploit, not the abstract rule. If a rule does not genuinely apply,
leave it out — a report padded with theoretical findings gets ignored, and the real
CRITICAL gets lost with it.
