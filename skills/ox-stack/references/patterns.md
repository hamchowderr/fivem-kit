# Worked ox resource patterns

Complete, copyable examples. Each one is written the way it should ship — including the
server-side validation that tutorial code usually leaves out.

---

## 1. Job centre — target zone + context menu + server authorisation

```lua
-- fxmanifest.lua
fx_version 'cerulean'
game 'gta5'
lua54 'yes'

shared_scripts { '@ox_lib/init.lua' }
client_scripts { 'client/main.lua' }
server_scripts { 'server/main.lua' }

dependency 'ox_lib'
dependencies { 'ox_core', 'ox_target' }
```

```lua
-- client/main.lua
lib.load('@ox_core.lib.init')
local config = require 'config'

for _, location in pairs(config.locations) do
    local blip = AddBlipForCoord(location.coords.x, location.coords.y, location.coords.z)
    SetBlipSprite(blip, 408)
    SetBlipDisplay(blip, 4)
    SetBlipScale(blip, 0.8)
    SetBlipColour(blip, 2)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName('Job Center')
    EndTextCommandSetBlipName(blip)

    exports.ox_target:addSphereZone({
        coords = location.coords,
        radius = 2.0,
        options = { {
            name = 'jobcenter',
            label = 'Job Center',
            icon = 'fas fa-briefcase',
            onSelect = function() openJobMenu(location) end,
        } },
    })
end

function openJobMenu(location)
    local options = {}
    for _, job in pairs(location.jobs) do
        options[#options + 1] = {
            title = job.label,
            description = job.description,
            icon = job.icon,
            onSelect = function()
                TriggerServerEvent('jobcenter:selectJob', location.id, job.name)
            end,
        }
    end
    lib.registerContext({ id = 'job_menu', title = 'Available Jobs', options = options })
    lib.showContext('job_menu')
end
```

```lua
-- server/main.lua
lib.load('@ox_core.lib.init')
local config = require 'config'

RegisterNetEvent('jobcenter:selectJob', function(locationId, jobName)
    local src = source
    local player = Ox.GetPlayer(src)
    if not player then return end

    -- 1. the location must exist
    local location = config.locations[locationId]
    if not location then return end

    -- 2. the job must be offered AT THAT LOCATION — not just any job name
    local offered = false
    for _, job in pairs(location.jobs) do
        if job.name == jobName then offered = true break end
    end
    if not offered then return end

    -- 3. the player must actually be standing there
    if #(player:getCoords() - location.coords) > 5.0 then return end

    player:set('job', jobName)
    lib.notify(src, { description = 'Job set to ' .. jobName, type = 'success' })
end)
```

> **The three checks above are the whole point.** The naive version of this handler is
> `player:set('job', jobName)` with no validation — which lets any client run
> `TriggerServerEvent('jobcenter:selectJob', 'police')` from anywhere on the map and
> become police. This exact bug ships in a large share of public FiveM job scripts.

---

## 2. Shop purchase — callback with server-side pricing

```lua
-- server
lib.callback.register('shop:buy', function(source, shopId, itemName, count)
    local player = Ox.GetPlayer(source)
    if not player then return false, 'no player' end

    count = tonumber(count)
    if not count or count < 1 or count > 100 or count % 1 ~= 0 then
        return false, 'bad quantity'
    end

    local shop = Config.shops[shopId]
    if not shop then return false, 'bad shop' end

    -- price comes from server config, NEVER from the client
    local price = shop.items[itemName]
    if not price then return false, 'not sold here' end

    if #(player:getCoords() - shop.coords) > 5.0 then return false, 'too far' end

    local total = price * count
    local account = player:getAccount()
    if account.balance < total then return false, 'insufficient funds' end

    if not exports.ox_inventory:CanCarryItem(source, itemName, count) then
        return false, 'no room'
    end

    -- add first, charge second: if the add fails you have not taken their money
    if not exports.ox_inventory:AddItem(source, itemName, count) then
        return false, 'could not add item'
    end
    account:withdraw(total)

    return true
end)
```

```lua
-- client
local ok, reason = lib.callback.await('shop:buy', false, shopId, 'water', 2)
lib.notify({
    description = ok and 'Purchased!' or ('Failed: ' .. tostring(reason)),
    type = ok and 'success' or 'error',
})
```

Note what the client sends: **which** shop and **which** item, never the price. Sending a
price from the client is the second-most-common FiveM economy exploit.

---

## 3. Lockpick — progress circle, skill check, then server verification

```lua
-- client
local ok = lib.progressCircle({
    duration = 10000,
    label = 'Lockpicking...',
    canCancel = true,
    disable = { move = true, combat = true },
    anim = {
        dict = 'anim@amb@clubhouse@tutorial@bkr_tut_ig3@',
        clip = 'machinic_loop_mechandphone',
        flag = 49,
    },
    prop = { model = 'prop_lockpick', bone = 28422 },
})

if ok and lib.skillCheck({ 'medium', 'medium', 'hard' }, { 'w', 'a', 's', 'd' }) then
    TriggerServerEvent('doors:unlock', doorId)
end
```

```lua
-- server
RegisterNetEvent('doors:unlock', function(doorId)
    local src = source
    local player = Ox.GetPlayer(src)
    if not player then return end

    local door = Config.doors[doorId]
    if not door then return end
    if #(player:getCoords() - door.coords) > 2.0 then return end

    -- the client can skip the progress bar and the skill check entirely,
    -- so the server enforces the real requirements: tool + cooldown
    if exports.ox_inventory:GetItemCount(src, 'lockpick') < 1 then return end
    if not Cooldown.ready(src, 'lockpick', 10000) then return end

    Doors.unlock(doorId)
end)
```

The progress bar and skill check are **game feel**, not security. A modified client fires
`doors:unlock` instantly. The server owns the item requirement and the cooldown.

---

## 4. oxmysql — parameterised queries only

The global `MySQL` only exists if you import it in the manifest:

```lua
-- fxmanifest.lua
server_scripts {
    '@oxmysql/lib/MySQL.lua',   -- must come first
    'server/*.lua',
}
dependency 'oxmysql'
```

```lua
-- await variants yield the current thread; use inside a thread or callback
local row = MySQL.single.await(
    'SELECT firstName, lastName FROM characters WHERE charId = ?',
    { charId }
)

local rows = MySQL.query.await('SELECT * FROM vehicles WHERE owner = ?', { userId })

local count = MySQL.scalar.await('SELECT COUNT(*) FROM characters WHERE userId = ?', { userId })

local insertId = MySQL.insert.await(
    'INSERT INTO garage (owner, plate) VALUES (?, ?)',
    { userId, plate }
)

local affected = MySQL.update.await(
    'UPDATE characters SET cash = cash - ? WHERE charId = ? AND cash >= ?',
    { amount, charId, amount }
)
```

Never build SQL by concatenation:

```lua
-- WRONG — injectable, and `plate` came from a client
MySQL.query.await('SELECT * FROM vehicles WHERE plate = "' .. plate .. '"')
```

The `UPDATE ... AND cash >= ?` shape above is worth copying: it makes the balance check
and the deduction a single atomic statement, so two simultaneous requests cannot both
pass a separate "do they have enough?" read.
