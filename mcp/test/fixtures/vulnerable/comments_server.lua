-- Rules must not fire on commented-out or quoted text, but must still fire on real code
-- further down the file.

-- MySQL.single.await('SELECT * FROM x WHERE y = "' .. z .. '"')
-- local fn = loadstring(userInput)

local docs = "call loadstring(x) to evaluate, or MySQL.Async.fetchAll for legacy code"

--[[
    RegisterCommand('nothing', function() end)
    TriggerClientEvent('leak', -1, identifiers)
]]

-- real defect, must be found
local q = MySQL.query.await('SELECT * FROM bans WHERE license = "' .. license .. '"')
