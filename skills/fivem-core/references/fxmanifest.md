# fxmanifest.lua reference

Every resource needs one. `__resource.lua` is the deprecated predecessor — if you see it,
rename it and add `fx_version`.

## Minimum viable manifest

```lua
fx_version 'cerulean'
game 'gta5'
lua54 'yes'

client_scripts { 'client/*.lua' }
server_scripts { 'server/*.lua' }
```

## Full directive reference

### Required / near-required

| Directive | Notes |
|---|---|
| `fx_version 'cerulean'` | current. Older: `bodacious`, `adamant`. Always use `cerulean` for new work |
| `game 'gta5'` | or `games { 'gta5', 'rdr3' }` for both |
| `lua54 'yes'` | opt into Lua 5.4. Recommended — integer division, goto, better errors |

### Metadata

```lua
name 'my_resource'
author 'Your Name'
version '1.0.0'
description 'What it does'
license 'MIT'
repository 'https://github.com/you/my_resource'
```

### Scripts

```lua
shared_script  '@ox_lib/init.lua'       -- singular form, one file
shared_scripts { 'config.lua', 'shared/*.lua' }
client_scripts { 'client/*.lua', 'client/**/*.lua' }
server_scripts { '@oxmysql/lib/MySQL.lua', 'server/*.lua' }
```

- **Load order is the order you list them**, and `shared_*` loads before `client_*` /
  `server_*`. A config referenced at file scope must be listed before its consumer.
- `*` matches within one directory, `**` recurses.
- `@resource/file.lua` pulls a file **from another resource**. This is how ox_lib and
  oxmysql are imported:
  - `shared_script '@ox_lib/init.lua'` → gives you the global `lib`
  - `server_scripts { '@oxmysql/lib/MySQL.lua' }` → gives you the global `MySQL`
  - Missing either of these is the cause of "attempt to index a nil value (global 'lib')"
    and the same for `MySQL`.

### ox_lib module preloading

```lua
ox_libs { 'locale', 'table', 'math' }
```

Tells ox_lib which optional modules to import for this resource.

### NUI

```lua
ui_page 'web/build/index.html'

files {
    'web/build/index.html',
    'web/build/assets/*.js',
    'web/build/assets/*.css',
    'locales/*.json',
}
```

Anything the NUI page loads — and any file another resource imports from yours — must be
listed in `files`. A blank NUI panel is almost always a missing `files` entry.

`ui_page` can also point at a URL, but a local page is the norm.

### Dependencies

```lua
dependency 'ox_lib'

dependencies {
    'oxmysql',
    'ox_lib',
    '/server:7290',      -- minimum server build number
    '/onesync',          -- requires OneSync enabled
    '/gameBuild:2802',   -- minimum game build
}
```

The `/`-prefixed entries are special: server build, OneSync, and game build requirements.
The server refuses to start the resource if they are unmet, which is exactly what you want
— a clear startup error instead of a confusing runtime nil.

### Other directives

| Directive | Purpose |
|---|---|
| `provide 'other_resource'` | declare this resource as a drop-in replacement for another |
| `this_is_a_map 'yes'` | resource is a map |
| `server_only 'yes'` | never sent to clients |
| `use_experimental_fxv2_oal 'yes'` | newer object-attribute loader; ox resources use it |
| `data_file 'DLC_ITYP_REQUEST' 'stream/props.ytyp'` | register streamed assets |
| `escrow_ignore { 'config.lua', 'client/editable/*.lua' }` | files left readable under Cfx asset escrow |
| `dependency '/assetpacks'` | resource ships escrowed asset packs |
| `rdr3_warning '...'` | required acknowledgement string for RedM resources |

### Streaming

A `stream/` folder is picked up automatically — no directive needed. Use `data_file` only
for typed assets (ytyp, vehicle meta, etc.).

---

## Common failures

| Symptom | Cause |
|---|---|
| `attempt to index a nil value (global 'lib')` | `@ox_lib/init.lua` missing from `shared_scripts` |
| `attempt to index a nil value (global 'MySQL')` | `@oxmysql/lib/MySQL.lua` missing from `server_scripts` |
| NUI page blank | asset not listed in `files` |
| `Could not find dependency X` | dependency not started, or started after this resource in server.cfg |
| script loads but config is nil | config listed after the script that reads it |
| resource silently does nothing | `client_script` vs `client_scripts` typo, or a glob matching no files |
| works locally, breaks on the server | server build below a `/server:NNNN` requirement, or OneSync off |

## Checklist for a new resource

- [ ] `fx_version 'cerulean'`, `game 'gta5'`, `lua54 'yes'`
- [ ] `name`, `author`, `version`, `description`
- [ ] `shared_script '@ox_lib/init.lua'` if using ox_lib
- [ ] `'@oxmysql/lib/MySQL.lua'` first in `server_scripts` if using SQL
- [ ] every dependency declared in `dependencies`
- [ ] every NUI asset listed in `files`
- [ ] config listed before the scripts that read it
- [ ] no API keys anywhere in `client_scripts` or `shared_scripts`
