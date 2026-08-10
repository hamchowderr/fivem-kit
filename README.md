<div align="center">

# 🚗 fivem-kit

### Turn your AI editor into a FiveM developer.

AI coding tools are general-purpose out of the box — they know a little Lua and nothing about
your server. fivem-kit gives them the whole domain: the natives, the frameworks, the manifest
rules, the exploit patterns, and a working picture of the server you actually run.

<p align="center">
  <a href="#-two-things"><strong>Two things</strong></a> ·
  <a href="#-install"><strong>Install</strong></a> ·
  <a href="#-works-with-your-stack"><strong>Your stack</strong></a> ·
  <a href="#-what-you-get"><strong>What you get</strong></a> ·
  <a href="#-official-documentation"><strong>Official docs</strong></a> ·
  <a href="#-the-security-ruleset"><strong>Security</strong></a> ·
  <a href="#-community"><strong>Discord</strong></a>
</p>

[![CI](https://github.com/hamchowderr/fivem-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/hamchowderr/fivem-kit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/fivem-mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/fivem-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node: 18+](https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white)](#-requirements)
[![MCP: 2025-11-25](https://img.shields.io/badge/MCP-2025--11--25-000)](https://modelcontextprotocol.io)
[![Frameworks: ESX · QBCore · Qbox · ox](https://img.shields.io/badge/ESX%20·%20QBCore%20·%20Qbox%20·%20ox-supported-4c8bf5)](#-works-with-your-stack)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/FVwPAsZZJ)

</div>

---

## 🧩 Two things

fivem-kit ships as **two separate products**. Take whichever fits your editor — or both.

| | **The Claude Code plugin** | **The MCP server** (`fivem-mcp`) |
|---|---|---|
| **For** | Claude Code — CLI, the Desktop app's Code tab, web, and IDE extensions | Any MCP client — Cursor, Windsurf, Claude Desktop, VS Code, Zed, Cline, and anything else that speaks the protocol |
| **Gives you** | Commands, knowledge skills, 7 subagents, 16 hooks — **plus the MCP server**, wired up automatically | 5 tools: documentation, natives, security audit, stack detection |
| **Install** | `/plugin install fivem` | `npx -y fivem-mcp` |

The plugin is a **superset**: installing it gives you the MCP server too, already connected.
The MCP server on its own is the portable half — it carries the knowledge and the analysis,
but skills, subagents and hooks are Claude Code features and don't travel.

If your tool speaks MCP, the server works there. If it doesn't, neither half will.

> **Using the Claude Desktop app?** Its **Code** tab is regular Claude Code — install the
> plugin with the marketplace commands below. The **Cowork** tab is different: it loads skills
> and plugins from **Customize** in the sidebar, synced through your claude.ai account rather
> than from the CLI's `~/.claude` directory, so enable fivem-kit there instead. Cowork also
> takes MCP servers as connectors.

### Requirements

**Node.js 18+** — tested on 18, 20 and 22 in CI. That's the whole list.

No FiveM server is needed to use the documentation or the natives; the stack detector and
`/fivem:doctor` need a server folder to look at. The natives database and the official
documentation corpora fetch on first use and then work from cache, so after one online run
everything works offline.

### It runs on your machine

Everything is local. Your editor spawns the MCP server as a child process and talks to it over
a pipe — nothing listens on a port, there's no account, and your code is never uploaded
anywhere. The only network traffic is fetching public documentation from CitizenFX and the
framework projects, and that's cached after the first run.

---

## 🎯 What changes

A general AI assistant treats FiveM as "Lua, roughly". It doesn't know that `job.grade` is a
table in QBCore and a number in ESX, that a resource silently never starts without
`fx_version`, that `source` is nil after a yield, or which of ~7,300 natives is the one you
want and whether it exists on the side you're calling from.

Give it those, and the same model stops guessing. Concretely, it gains:

- **A picture of your server.** It reads your `resources/` folder and `server.cfg` once, then
  writes in the dialect you actually run instead of a generic blend.
- **Real APIs.** Every symbol in the bundled reference is verified against actual resource
  source — 220 of them, checked in CI on every push — and the official documentation for all
  five frameworks is searchable in-editor.
- **A security reviewer.** 15 FiveM-specific exploit rules, tuned against 931 real resource
  files, applied to code as it's written rather than after a server gets drained.
- **Specialists it can delegate to.** Seven subagents, each taking one resource, so auditing or
  migrating a whole server fans out instead of flooding one conversation.
- **Reflexes.** [16 hooks](docs/hooks.md) that inject your stack at session start, block a
  committed credential before it lands, and translate FiveM console errors into causes.

The most expensive thing a general model gets wrong isn't style — it's trusting the client.
This is the single most common shape of FiveM exploit, and it looks the same in every
framework:

```lua
-- ESX
RegisterNetEvent('shop:buy', function(item, price)
    local xPlayer = ESX.GetPlayerFromId(source)
    xPlayer.removeAccountMoney('bank', price)      -- price came from the player
end)

-- QBCore
RegisterNetEvent('shop:buy', function(item, price)
    local Player = QBCore.Functions.GetPlayer(source)
    Player.Functions.RemoveMoney('bank', price)    -- price came from the player
end)

-- ox
RegisterNetEvent('shop:buy', function(item, price)
    player:getAccount():withdraw(price)            -- price came from the player
end)
```

Any player sends their own price and buys a rifle for $1. fivem-kit flags all three, and writes
the validated version in whichever dialect your server speaks.

---

## 🚀 Install

### Claude Code — the full plugin

```
/plugin marketplace add hamchowderr/fivem-kit
/plugin install fivem
```

Then `/fivem:init` once per project, so everything speaks your server's dialect.

### Any MCP client — the server on its own

```bash
npx -y fivem-mcp
```

Add to your MCP config — Cursor, Windsurf, Claude Desktop, VS Code, Zed, Cline:

```json
{
  "mcpServers": {
    "fivem": {
      "command": "npx",
      "args": ["-y", "fivem-mcp@latest"]
    }
  }
}
```

---

## 🧭 Works with your stack

Run `/fivem:init` once (or call `fivemDetectStack` from any MCP client). It reads your
`resources/` folder and `server.cfg`, works out what you run, and everything after that speaks
it.

| Detected | What you get |
|---|---|
| **ESX Legacy** | `ESX.GetPlayerFromId`, `xPlayer` with dot syntax, named accounts, `esx_*` event conventions |
| **QBCore** | `QBCore.Functions.GetCoreObject`, `Player.Functions.*`, and `job.grade` treated as the **table** it is — not the number everyone assumes |
| **Qbox** | `qbx_core` for players, ox_lib and ox_target for everything else — the hybrid it actually is |
| **ox** | `Ox.GetPlayer`, `lib.callback`, ox_target / ox_inventory exports |
| **standalone** | No framework assumed; plain natives and your own state |

It flags a **mixed install** loudly — more than one framework running at once causes duplicate
player state and money desync, and it changes what generated code should target.

The parts that don't care what you run — the security audit, the native database, server health
checks, console-error explanations, manifest repair — work identically on all of them.

> **Where ox gets more attention, stated plainly:** the bundled hand-written reference is
> deepest on ox, and `/fivem:convert` migrates *toward* ox rather than between arbitrary pairs.
> If you run ESX or QBCore and have no interest in migrating, everything else still applies —
> and the **official documentation for all five** is searchable at equal depth. Thickening the
> ESX and QBCore references is the top open item.

---

## 📦 What you get

### Commands · Claude Code

| Command | Does |
|---|---|
| `/fivem:init [path]` | Detect your stack once and record it, so every other command speaks the right dialect |
| `/fivem:resource <name>` | Scaffold a resource in your framework — manifest, client, server, config, with server-side validation written in from the start |
| `/fivem:audit [path]` | Security audit against a 15-rule FiveM-specific ruleset |
| `/fivem:doctor [path]` | Server health check — stack, load order, dependencies, manifests, cfg traps |
| `/fivem:natives <query>` | Look up any of ~7,300 natives, and the wrapper to use instead |
| `/fivem:convert <path>` | Migrate an ESX or QBCore resource to ox |

### Knowledge skills · Claude Code — load automatically when relevant

| Skill | Covers |
|---|---|
| `fivem-core` | Lua runtime, fxmanifest directives, the natives that actually come up |
| `fivem-security` | 15 exploit rules with detection patterns and fixes |
| `fivem-server-ops` | server.cfg, load order, ACE, artifacts, txAdmin, reading console errors |
| `fivem-frameworks` | ESX / QBCore / Qbox dialects and the full migration map |
| `ox-stack` | ox_lib, ox_core, ox_target, ox_inventory, oxmysql, plus doorlock, fuel, banking and commands |

### Subagents · Claude Code

Each takes **one resource**, so a whole-server job fans out across them concurrently and none
of their file reading lands in your main conversation.

| Agent | Does |
|---|---|
| `fivem-security-auditor` | Audits one resource against SEC-1…15 — deterministic pass, then reads every client-reachable handler for the rules a regex can't decide |
| `fivem-resource-scout` | Read-only recon: exports, events, callbacks, dependencies, dialect, NUI surface |
| `fivem-manifest-doctor` | Validates and repairs one `fxmanifest.lua` against the files on disk — including case mismatches that only break on Linux |
| `fivem-native-researcher` | Exact natives and wrappers with verified signatures, never recalled |
| `fivem-perf-auditor` | Per-frame loops, uncached natives, entity iteration, stuck NUI focus — with cost estimates |
| `fivem-nui-builder` | The NUI layer for one resource: web assets, Lua bridge, `files{}`, focus lifecycle |
| `fivem-ox-migrator` | Converts one resource ESX/QBCore → ox, in an isolated git worktree so migrators run in parallel |

`/fivem:audit` and `/fivem:convert` act as supervisors, batching specialists ~8 per message and
merging the results.

### Hooks · Claude Code

**16 events** — session context injection, credential blocking before a write, lint-on-write
reported once per batch, console-error translation, on-screen secret masking, and context
restoration after compaction.

Every one quick-exits when the project isn't a FiveM project, so an unrelated repo pays
nothing, and `enabled: false` stands them all down without uninstalling anything.

**→ [Full reference: docs/hooks.md](docs/hooks.md)**

### MCP tools · any client

| Tool | Does |
|---|---|
| `fivemDocs` | Read documentation pages, bundled or official |
| `fivemSearch` | Keyword search across the bundled reference or any framework's official docs |
| `fivemNatives` | Resolve a native by name, hash, or a description of the task |
| `fivemAudit` | Run the 15-rule security analyser over Lua source or a file |
| `fivemDetectStack` | Work out which framework and libraries a server folder runs |

All five declare `readOnlyHint`, so a well-behaved client can call them without prompting.
`fivemAudit` and `fivemDetectStack` also return **structured output** (MCP 2025-06-18) — typed
findings and a typed stack report, not prose to parse.

---

## 📚 Official documentation

Search the bundled reference, or your framework's **own official docs**, from the same tool:

```jsonc
fivemSearch { "query": "job grade", "source": "qbcore" }
```

| `source` | What it is | Size |
|---|---|---|
| `kit` *(default)* | The bundled reference, verified against real resource sources. Works offline | — |
| `esx` | ESX Legacy documentation | 269 KB · 158 pages |
| `qbcore` | docs.qbcore.org | 413 KB · 100 pages |
| `qbox` | Qbox documentation | 152 KB · 102 pages |
| `ox` | overextended.dev | 376 KB · 133 pages |
| `fivem` | Cfx.re server manual + scripting reference — convars, `server.cfg`, OneSync, routing buckets, streaming | 437 KB · 212 pages |

**Every fetch validates on content, never on status.** ESX's documentation site answers HTTP
200 for *any* path and returns its HTML homepage — 100 KB of it, containing the word `xPlayer`
once. A fetcher trusting the status code would cache a website's navigation as API reference.
Validation requires non-HTML, a plausible size, and the marker term appearing often enough to
be real reference material. A source that fails is never cached and never served.

Corpora are fetched onto your machine and cached for 7 days; none are redistributed, because
none of the upstream repositories publish a license.

---

## 🔒 The security ruleset

15 rules covering the flaws that actually get servers wiped — none of them framework-specific:

| | | | |
|---|---|---|---|
| SEC-1 | Unvalidated net event handler | SEC-9 | Server permission missing behind client-side gating |
| SEC-2 | Client-supplied price, amount or reward | SEC-10 | Code execution from client input |
| SEC-3 | `source` lost across a yield | SEC-11 | No rate limiting on a valuable action |
| SEC-4 | Missing distance check | SEC-12 | Sensitive data broadcast to every player |
| SEC-5 | SQL injection | SEC-13 | Internal event exposed to the network |
| SEC-6 | Check-then-act race (money duplication) | SEC-14 | Identifier trusted for authorisation |
| SEC-7 | Unrestricted admin command | SEC-15 | NUI callback trusted |
| SEC-8 | Secret in a client script | | |

The analyser decides the mechanical rules itself and returns targeted review prompts for the
ones that need judgement — it doesn't pad the report with guesses.

**Tuned for precision against real code.** Sweeping 931 resource files from ESX, QBCore, Qbox,
ox and the qb-scripts collection took the finding count from 79 to 16 by eliminating six
classes of false positive — `lib.load()` read as `load()`, nested tables truncating a command
config, an inner `end` cutting a loop scan short, `if source ~= 0` console guards, framework
command wrappers with their own permission model, and SQL that interpolates a *column or table
identifier* while still binding its values. What survives is genuine: qb-scripts really do
still call the deprecated `MySQL.Async` API.

It knows each framework's spelling of the same dangerous action — ESX's `addAccountMoney`,
QBCore's `AddMoney`, ox's `:deposit` all count as granting value — so an ungated admin command
is caught whichever one you use. And a command is only reported when its handler actually
grants value or control: `/job` printing your own job is not a vulnerability, and reporting it
would bury the ones that are.

### Findings don't have to scroll away

An audit of a real server turns up more than you'll fix in one sitting, and a list in a chat
window is gone by tomorrow. So `/fivem:audit` can hand its CRITICAL and HIGH findings to an
issue tracker instead, one issue each, with the exploit and the fix written out.

Run it again next week and it recognises what it already reported: nothing is duplicated,
anything you've fixed gets closed, and anything that comes back reopens. You can audit the
same server every morning and the tracker stays honest.

This uses [beads](https://github.com/steveyegge/beads) if it's installed. It isn't a
requirement and there's no setup — without it, `/fivem:audit` simply reports as normal.

---

## 🗂 The native database

`fivemNatives` (and `/fivem:natives`) searches every native FiveM exposes — framework-agnostic
by definition, since natives are the layer underneath all of them:

| | |
|---|---|
| GTA V natives | ~6,416 across 44 namespaces |
| CFX / FiveM natives | ~943, mostly server-side |
| Resolvable by | Lua name (`SetEntityCoords`), snake name (`SET_ENTITY_COORDS`), hash (`0x06843DA7060A026B`), or a description of the task |

It knows many natives exist on **both sides** — `SetEntityCoords` is a client native *and* a
server RPC equivalent with a different hash — and returns the right one for the script you're
writing. Where a library wraps a native, it says so, because the wrapper handles the waiting
and cleanup that hand-written calls skip.

Fetched from the official CitizenFX endpoint on first use and cached for 30 days, not bundled:
the CitizenFX natives repositories publish no license, and the database tracks game builds so a
bundled copy goes stale. Set `FIVEM_CACHE_DIR` to control the cache location.

---

## ⚙️ Configuration

`/fivem:init` writes `.claude/fivem.local.md` — detected server path, dialect, framework and
lib, plus per-project switches (`audit_on_write`, `remind_on_stop`, `redact_secrets`, `lsp`,
`beads`). Add `.claude/*.local.md` to your `.gitignore`; init offers to do it.

Machine-wide preferences — preferred dialect for greenfield work, a default server folder,
audit-on-write, beads filing — are prompted for when you enable the plugin and live in your
user settings. Where both set the same thing, the project file wins, because it describes
*that* server.

> **The project file is treated as untrusted input.** It lives in the workspace, so a cloned
> FiveM repo can ship one and the hooks read it every session. Every value is validated against
> an allow-list, `server_path` must resolve to a real directory containing `resources/`, unknown
> keys are dropped, parsing is bounded, and nothing from it is ever interpolated into a shell
> command. A committed config can't do harm — and won't work on anyone else's machine either,
> which is the intended outcome.

---

## 💬 Community

**[Join the Discord →](https://discord.gg/FVwPAsZZJ)**

A community for **AI-assisted FiveM development** — building servers and resources with AI in
the loop, and getting good at it.

What that looks like in practice: which setups hold up against a live server and which fall
apart, where the models still get FiveM wrong, migrations and architecture decisions worth
copying, and what's coming next in fivem-kit. Come to get it running, to say what it got
wrong, or to show what you built.

Bug reports and API corrections are welcome here or in
[Issues](https://github.com/hamchowderr/fivem-kit/issues) — whichever you'll actually do.

---

## 🏗 Built by

[**myRP.build**](https://myrp.build) — describe a resource in plain English and an agent
generates it with full awareness of your server, then deploys it. fivem-kit is the free, local,
terminal-side slice of that work.

## Credits

Built for the FiveM community and the framework teams whose public APIs it documents — **ESX
Legacy**, **QBCore**, **Qbox**, and **ox (Overextended)** — along with **Cfx.re**, whose
natives and server documentation underpin all of it. fivem-kit is an independent project, is
not affiliated with or endorsed by any of them, and bundles no framework source; it documents
public APIs and generates code that calls them at arm's length.

## Contributing

Corrections to the API references are especially welcome — these frameworks move fast, and a
wrong signature in here is worse than a missing one. The most valuable area right now is
**ESX and QBCore depth**: the bundled reference is thinner there than on ox, and most live
servers run one of them.

Open an issue or PR with the resource version you verified against. CI runs the full suite on
Node 18/20/22, validates both plugin manifests, and checks all 220 documented ox symbols
against freshly cloned upstream sources.

## License

MIT © [Otaku Solutions](https://otakusolutions.io)
