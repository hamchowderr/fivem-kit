# ox_commands — `0.0.0`

**Not a library.** It is a small pack of admin commands built on `lib.addCommand`, and at the
version here it ships very little — `/freeze` and `/thaw`. Treat it as an example of the
pattern rather than as infrastructure to build on, and check the current repository before
assuming a command exists.

The pattern it demonstrates is the useful part, and it is the right way to write any admin
command:

```lua
lib.addCommand('freeze', {
    help = 'Freeze the player',
    params = {
        { name = 'target', type = 'playerId', help = "Target player's server id" },
    },
    restricted = 'group.admin'      -- the permission gate, declared not coded
}, function(source, args, raw)
    -- args.target is already validated and typed as a player id
end)
```

Two things to copy from it:

- **`restricted` is the gate.** Declaring it means ox_lib refuses the command for anyone
  outside the group, so there is no hand-written permission check to forget. A command that
  grants value or control without `restricted` is SEC-7.
- **`params` with a `type` gets you validation for free.** `type = 'playerId'` means the
  handler receives a real player id or the command is rejected — the argument never arrives
  unvalidated.
