-- Client-side file. A client RegisterCommand has no ACE implication and a client
-- cannot broadcast, so the server-only rules must not fire here.
-- Pattern taken from ox_lib's progress module. Must produce ZERO findings.

local progress = nil

RegisterCommand('cancelprogress', function()
    if progress?.canCancel then progress = false end
end)

RegisterKeyMapping('cancelprogress', 'Cancel progress', 'keyboard', 'x')

RegisterNUICallback('progressComplete', function(data, cb)
    progress = nil
    cb(1)
end)

CreateThread(function()
    while true do
        Wait(0)
        if progress then
            DrawMarker(1, 0.0, 0.0, 0.0)
        end
    end
end)

lib.load('@ox_core.lib.init')
local ped = cache.ped
TriggerServerEvent('resource:action', 'someId')
