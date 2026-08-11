---@meta
--- FiveM resource manifest directives, for lua-language-server.
---
--- WHY THIS FILE EXISTS
---
--- `fxmanifest.lua` is Lua syntax evaluated by the server in its own global environment, so
--- without declarations every directive reads as an undefined global — three or more warnings
--- on a file that every single resource has. That is how people end up switching diagnostics
--- off altogether.
---
--- The tempting fix is to exclude manifests from analysis. That throws away the check most
--- worth having: a typo'd `client_scripts` does not error, it just means the script never
--- loads, and the resource fails in a way that looks like anything else. Declaring the
--- directives instead means the typo is caught and the real ones get hover and completion.
---
--- PROVENANCE — two sources, no invention:
---   1. citizenfx/fivem-docs, scripting-reference/resource-manifest — the documented set.
---   2. Every directive observed across 75 real fxmanifest.lua files in the ox stack, ESX,
---      QBCore, Qbox and qb-scripts. This is what catches the ones the docs omit: the plural
---      script forms (`client_scripts` in 58 of 75) appear nowhere in the reference, and
---      `legacyversion` is used by 33 resources.
---
--- A manifest may still declare ARBITRARY metadata, readable at runtime through
--- `GetResourceMetadata`. Anything bespoke and unlisted will be reported as an undefined
--- global; add it to `Lua.diagnostics.globals` in your `.luarc.json`. See docs/lsp.md.

---@alias FilePattern string A path or glob relative to the resource root.

--- The manifest format version. Required — a resource without it never starts.
---@param version string
function fx_version(version) end

--- Which game(s) this resource supports: `'gta5'`, `'rdr3'`, or `'common'`.
---@param name string
function game(name) end

--- Multiple supported games.
---@param names string[]
function games(names) end

--- The pre-fxmanifest manifest version. Legacy; `fx_version` replaces it.
---@param version string
function resource_manifest_version(version) end

---@param file FilePattern
function client_script(file) end

---@param files FilePattern[]
function client_scripts(files) end

---@param file FilePattern
function server_script(file) end

---@param files FilePattern[]
function server_scripts(files) end

--- Runs on BOTH sides. Never put a secret in one.
---@param file FilePattern
function shared_script(file) end

--- Runs on BOTH sides. Never put a secret in one.
---@param files FilePattern[]
function shared_scripts(files) end

--- Files packed into the resource and downloadable by clients. NUI assets must be listed
--- here or they 404 with no Lua error at all.
---@param patterns FilePattern[]
function files(patterns) end

--- A single packed file.
---@param pattern FilePattern
function file(pattern) end

--- The NUI page, relative to the resource, or an absolute URL.
---@param page string
function ui_page(page) end

--- Export a client-side function by name.
---@param name string
function export(name) end

---@param names string[]
function exports(names) end

--- Export a server-side function by name.
---@param name string
function server_export(name) end

---@param names string[]
function server_exports(names) end

--- Resources that must be started BEFORE this one. Declaring these turns a load-order
--- mistake into a readable startup error instead of a nil-index at runtime.
---@param name string
function dependency(name) end

---@param names string[]
function dependencies(names) end

--- Register a game data file, e.g. `data_file 'DLC_ITYP_REQUEST' 'stream/props.ytyp'`.
---@param kind string
function data_file(kind) end

--- Declare that this resource provides another resource's name, for drop-in replacements.
---@param name string
function provide(name) end

---@param names string[]
function provides(names) end

--- Use this resource as the loading screen.
---@param page string
function loadscreen(page) end

--- Keep the loading screen up until the resource shuts it down itself.
---@param enabled boolean
function loadscreen_manual_shutdown(enabled) end

--- Marks the resource as a map.
---@param value boolean
function this_is_a_map(value) end

--- Marks the resource as server-only; it is never sent to clients.
---@param value boolean
function server_only(value) end

--- Use Lua 5.4 rather than the default 5.3.
---@param value string
function lua54(value) end

--- Opt into the experimental fxv2 object-argument loader.
---@param value string
function use_experimental_fxv2_oal(value) end

---@param value string
function use_fxv2_oal(value) end

--- Node version for server-side JS.
---@param version string
function node_version(version) end

--- Paths excluded from escrow protection.
---@param patterns FilePattern[]
function escrow_ignore(patterns) end

--- Suppress the RedM compatibility warning.
---@param value string
function rdr3_warning(value) end

--- Require NUI callbacks to be registered before use.
---@param value boolean
function nui_callback_strict_mode(value) end

--- Group this resource's convars in the server UI.
---@param name string
function convar_category(name) end

---@param value boolean
function clr_disable_task_scheduler(value) end

function before_level_meta(...) end
function after_level_meta(...) end
function replace_level_meta(...) end

--- Descriptive metadata. Not required, but conventional, and read by tooling.
---@param value string
function name(value) end

---@param value string
function version(value) end

---@param value string
function author(value) end

---@param value string
function description(value) end

---@param value string
function repository(value) end

---@param value string
function license(value) end

--- ox convention: the version string of the last non-semver release. Used by 33 of the 75
--- manifests surveyed, and documented nowhere upstream.
---@param value string
function legacyversion(value) end

--- ox convention: ox_lib modules to load for this resource.
---@param modules string[]
function ox_libs(modules) end

---@param value any
function ox_lib(value) end

--- Theme metadata read by chat resources.
---@param name string
---@param definition table
function chat_theme(name, definition) end
