-- `restricted = false` is an explicit opt-out of the permission gate, not an omission.
-- Must still be reported.

lib.addCommand('setjob', {
    help = 'Set a job',
    params = {
        { name = 'target', type = 'playerId' },
        { name = 'job', type = 'string' },
    },
    restricted = false,
}, function(source, args)
    local player = Ox.GetPlayer(args.target)
    player:set('job', args.job)
end)
