-- `if source ~= 0` is a genuine permission gate: the command is server-console only.
-- Pattern taken from ox_inventory. Must produce ZERO findings.

RegisterCommand('clearActiveIdentifier', function(source, args)
    -- server console only
    if source ~= 0 then return end

    local activePlayer = activeIdentifiers[args[1]]
    if not activePlayer then return end

    DropPlayer(activePlayer, 'Kicked')
end)

RegisterCommand('reloadconfig', function(src)
    if src ~= 0 and not IsPlayerAceAllowed(src, 'command.reloadconfig') then return end
    loadConfig()
end)
