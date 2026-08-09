-- Every line below is deliberately wrong. Expected rules are asserted in audit.test.mjs.
local webhook = "https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz012345"

RegisterNetEvent('shop:buy', function(item, price)
    local player = Ox.GetPlayer(source)
    local row = MySQL.single.await('SELECT * FROM items WHERE name = "' .. item .. '"')
    exports.ox_inventory:AddItem(source, item, 1)
    player:getAccount():withdraw(price)
end)

RegisterCommand('givecash', function(src, args)
    Ox.GetPlayer(tonumber(args[1])):getAccount():deposit(tonumber(args[2]))
end)

-- no `restricted`, and it teleports anyone anywhere
lib.addCommand('tp', { help = 'teleport' }, function(source, args)
    SetEntityCoords(GetPlayerPed(args.target), args.x, args.y, args.z)
end)

CreateThread(function()
    while true do
        DrawMarker(1, 0.0, 0.0, 0.0)
    end
end)

MySQL.Async.fetchAll('SELECT * FROM users', {}, function(r) end)
TriggerClientEvent('notify', -1, GetPlayerIdentifiers(source))
local fn = loadstring(userInput)
