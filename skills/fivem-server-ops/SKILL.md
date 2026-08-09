---
name: fivem-server-ops
description: Run and debug a FiveM server — server.cfg syntax and its semicolon trap, resource load order, txAdmin, FXServer artifacts, OneSync, convars and ACE permissions, and reading server console errors. Use when a resource will not start, the server errors on boot, load order is wrong, a dependency is missing, or when configuring server.cfg or diagnosing a crash.
---

# FiveM server operations

## server.cfg

### The semicolon trap

FiveM's cfg parser **splits every line on `;` and runs each half as a separate command.**
A semicolon is not a comment and does not end a statement.

```cfg
# WRONG — this silently starts a resource called "chat"
setr something "value" ; chat is fine

# comments are '#' only, on their own
# this is a comment
setr something "value"
```

This bites hardest with values that legitimately contain a semicolon (connection strings,
Discord tokens, locale strings). Quote them, and keep them off shared lines.

```cfg
set mysql_connection_string "mysql://user:pass@localhost/db?charset=utf8mb4"
```

### Structure that works

```cfg
# ---- endpoints
endpoint_add_tcp "0.0.0.0:30120"
endpoint_add_udp "0.0.0.0:30120"

# ---- core convars
sv_hostname "My Server"
sv_maxclients 48
sv_licenseKey "yourkey"
set steam_webApiKey "none"
sv_enforceGameBuild 3095

# ---- onesync
set onesync on              # on | legacy | off
set onesync_population true

# ---- database (before anything that queries)
set mysql_connection_string "mysql://user:pass@localhost/db?charset=utf8mb4"

# ---- load order matters from here down
ensure oxmysql
ensure ox_lib
ensure ox_core
ensure ox_target
ensure ox_inventory

# ---- your resources
ensure my_resource

# ---- permissions
add_ace group.admin command allow
add_principal identifier.license:XXXX group.admin
```

`ensure` = start, restarting it if already running. Prefer it over `start`. `stop` disables.

### Load order

A resource that depends on another must be `ensure`d **after** it. The dependency chain
that matters:

```
oxmysql → ox_lib → ox_core → ox_target / ox_inventory → your resources
```

Declaring `dependencies { 'ox_lib' }` in the fxmanifest makes the server refuse to start
the resource when the dependency is missing — a clear error instead of a nil-index at
runtime. Declare them; it turns load-order mistakes into readable messages.

Category folders (`resources/[core]/...`) affect nothing at runtime — `ensure` takes the
resource name, never the path.

## ACE permissions

```cfg
add_ace group.admin command allow          # group may run any command
add_ace group.admin command.givemoney allow
add_ace resource.my_resource command.tp allow

add_principal identifier.license:abc123 group.admin
add_principal group.moderator group.user   # inheritance
```

Check in code with `IsPlayerAceAllowed(source, 'command.givemoney')`, or declaratively via
`restricted = 'group.admin'` on `lib.addCommand`.

Use the `license:` identifier for principals. Never `ip:`.

## Convars

```cfg
set   my_key "value"      # server-side only
setr  my_key "value"      # replicated to clients — never put a secret here
sets  my_key "value"      # shown in the server browser
```

```lua
local key = GetConvar('my_key', 'default')
local n   = GetConvarInt('my_number', 0)
```

`setr` is the one to watch: replicated convars are readable by every client. API keys and
connection strings must use `set`.

## Artifacts (FXServer builds)

- Windows and Linux builds: https://runtime.fivem.net/artifacts/fivem/
- **Recommended** builds are marked; do not chase latest for a production server.
- A manifest can require a minimum via `dependencies { '/server:7290' }`.
- `sv_enforceGameBuild` pins the *game* build (client DLC level), separate from the server
  artifact. Mismatches show up as missing vehicles, props or natives.

## txAdmin

Ships with FXServer. Handles process supervision, scheduled restarts, live console, player
management and backups.

- Recipes deploy a whole server template — convenient, and worth reading before running,
  since a recipe pulls arbitrary resources.
- Scheduled restarts are the standard fix for slow memory growth.
- Its console is where the errors below appear.

## Reading server console errors

| Message | Meaning |
|---|---|
| `Could not find dependency X for resource Y` | X isn't started, or is started after Y |
| `attempt to index a nil value (global 'lib')` | `@ox_lib/init.lua` missing from `shared_scripts` |
| `attempt to index a nil value (global 'MySQL')` | `@oxmysql/lib/MySQL.lua` missing from `server_scripts` |
| `attempt to index a nil value (field 'PlayerData')` | player object fetched before the player loaded, or a dropped player |
| `No such export X in resource Y` | Y isn't started, or the export name is wrong/renamed |
| `Failed to load script @res/file.lua` | path in the manifest doesn't match disk (case matters on Linux) |
| `Creating script environments for X … failed` | syntax error — the line follows |
| `SCRIPT ERROR: … attempt to call a nil value` | typo'd function, or a resource-order problem |
| `Warning: Resource X has an invalid fxmanifest` | missing `fx_version` / `game`, or a syntax error in the manifest |
| server hangs on start | a `while true do` with no `Wait` at file scope |

**Case sensitivity:** Linux servers are case-sensitive, Windows is not. A resource that
works locally on Windows and fails on a Linux host is almost always a filename case
mismatch in the manifest.

## Diagnosing a resource that won't start

1. `ensure <resource>` in the live console — read the error it prints immediately.
2. `refresh` after adding files to disk, then `ensure` again.
3. Check the fxmanifest: `fx_version`, `game`, and every script path actually existing.
4. Check load order against the dependency chain above.
5. `GetResourceState('other_resource')` to confirm a dependency is really running.
6. Run the plugin's detector to see what's installed versus what the cfg starts:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" <serverPath>`

## Performance

- `resmon 1` (client console, F8) — per-resource CPU. Anything sustained above ~0.5ms
  deserves attention; above 2ms is a problem.
- `txAdmin` → performance charts for server-side tick time.
- The usual culprits: per-frame loops that should be zones, `DrawMarker` running when the
  player is nowhere near, distance checks over large tables every tick, and NUI kept
  focused when hidden.
