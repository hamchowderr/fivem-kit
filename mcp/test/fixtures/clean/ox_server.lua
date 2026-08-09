-- Correctly written ox server code. Must produce ZERO findings.
lib.load('@ox_core.lib.init')
local config = require 'config'

RegisterNetEvent('jobcenter:selectJob', function(locationId, jobName)
    local src = source
    local player = Ox.GetPlayer(src)
    if not player then return end

    local location = config.locations[locationId]
    if not location then return end
    if #(player:getCoords() - location.coords) > 5.0 then return end

    player:set('job', jobName)
    lib.notify(src, { description = 'Job set', type = 'success' })
end)

-- nested table inside the config must not truncate the restricted lookup
lib.addCommand('givemoney', {
    help = 'Give money to a player',
    params = {
        { name = 'target', type = 'playerId', help = 'Target' },
        { name = 'amount', type = 'number', help = 'Amount' },
    },
    restricted = 'group.admin',
}, function(source, args, raw)
    local player = Ox.GetPlayer(args.target)
    if not player then return end
end)

-- an inner `if ... end` before the Wait must not end the loop scan early
CreateThread(function()
    while true do
        if somethingIsTrue() then
            doWork()
        end
        Wait(500)
    end
end)

local row = MySQL.single.await('SELECT * FROM characters WHERE charId = ?', { charId })
local n = MySQL.scalar.await('SELECT COUNT(*) FROM vehicles WHERE owner = ?', { userId })
