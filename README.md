<div align="center">

# 🚗 fivem-kit

### Turn your AI editor into a FiveM developer.

AI coding tools know a little Lua and nothing about your server. fivem-kit gives them the rest:
the natives, the frameworks, the manifest rules, the exploit patterns, and a picture of the
server you actually run.

<p align="center">
  <a href="#-two-things"><strong>Two things</strong></a> ·
  <a href="#-install"><strong>Install</strong></a> ·
  <a href="#-works-with-your-stack"><strong>Your stack</strong></a> ·
  <a href="#-what-you-get"><strong>What you get</strong></a> ·
  <a href="#-official-documentation"><strong>Official docs</strong></a> ·
  <a href="#-the-security-ruleset"><strong>Security</strong></a> ·
  <a href="#-serving-a-team"><strong>Serving a team</strong></a> ·
  <a href="#-contributing"><strong>Contributing</strong></a>
</p>

[![CI](https://github.com/hamchowderr/fivem-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/hamchowderr/fivem-kit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/fivem-mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/fivem-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node: 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](#requirements)
[![MCP: 2025-11-25](https://img.shields.io/badge/MCP-2025--11--25-000)](https://modelcontextprotocol.io)
[![Frameworks: ESX · QBCore · Qbox · ox](https://img.shields.io/badge/ESX%20·%20QBCore%20·%20Qbox%20·%20ox-supported-4c8bf5)](#-works-with-your-stack)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/FVwPAsZZJ)

</div>

---

## 💬 Come build with us

**[Join the Discord →](https://discord.gg/FVwPAsZZJ)**

A Discord for AI-assisted FiveM development — which setups hold up on a live server and which
fall apart, where models still get FiveM wrong, and migrations worth copying. It's also where we
post what's coming next, here and on [myRP.build](https://myrp.build).

Bug reports and API corrections are welcome there or in
[Issues](https://github.com/hamchowderr/fivem-kit/issues).

---

## 🧩 Two things

fivem-kit is two products. Take either, or both.

| | **The Claude Code plugin** | **The MCP server** (`fivem-mcp`) |
|---|---|---|
| **For** | Claude Code — CLI, the Desktop app's Code tab, web, and IDE extensions | Any MCP client — Cursor, Windsurf, Claude Desktop, VS Code, Zed, Cline |
| **Gives you** | Commands, knowledge skills, 7 subagents, 16 hooks, plus the MCP server, wired up for you | 5 tools: documentation, natives, security audit, stack detection |
| **Install** | `/plugin install fivem` | `npx -y fivem-mcp` |

The plugin includes the MCP server, already connected. The server on its own works anywhere, but
skills, subagents and hooks are Claude Code features and don't travel.

Both halves need a tool that speaks MCP.

> **Using the Claude Desktop app?** The **Code** tab is regular Claude Code — install the plugin
> with the marketplace commands below. The **Cowork** tab loads skills and plugins from
> **Customize** in the sidebar instead, so enable fivem-kit there. Cowork also takes MCP servers
> as connectors.

### Requirements

Node.js 20 or newer.

You don't need a FiveM server for the docs or the natives. Only `/fivem:doctor` and stack
detection need one. The natives and framework docs download the first time you use them, then
work offline.

### It runs on your machine

Your editor runs the MCP server as a child process. Nothing listens on a port, there's no
account, and your code is never uploaded. It only goes online to download docs from CitizenFX
and the framework projects.

You can share one instance with a team if you want — see [Serving a team](#-serving-a-team) — but
it's off by default.

---

## 🎯 What changes

A general AI assistant treats FiveM as Lua with extra steps. It doesn't know that `job.grade` is
a table in QBCore and a number in ESX, that a resource never starts without `fx_version`, that
`source` is nil after a yield, or which of ~7,300 natives you want.

fivem-kit gives it:

- **A picture of your server.** It reads your `resources/` folder and `server.cfg` once, then
  writes in the dialect you run.
- **Real APIs.** Every symbol in the bundled reference is checked against actual resource source
  — 497 of them, re-checked in CI on every push. The official docs for all five frameworks are
  searchable in your editor.
- **A security reviewer.** 15 FiveM exploit rules, applied while the code is written.
- **Specialists to hand work to.** Seven subagents, each taking one resource, so auditing or
  migrating a server runs in parallel instead of filling one conversation.
- **Reflexes.** [16 hooks](docs/hooks.md) that load your stack at session start, block a
  committed credential, and explain FiveM console errors.

The most common FiveM exploit is a server handler that trusts the client. It looks the same in
every framework:

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

Any player can send their own price and buy a rifle for $1. fivem-kit catches all three and
writes the fixed version in your framework's dialect.

---

## 🚀 Install

### Claude Code — the full plugin

```
/plugin marketplace add hamchowderr/fivem-kit
/plugin install fivem
```

Then run `/fivem:init` once per project so everything uses your server's dialect.

### Any MCP client — the server on its own

**Claude Code**

```bash
claude mcp add fivem -- npx -y fivem-mcp@latest
```

Add `--scope user` to make it available in every project.

**Codex**

```bash
codex mcp add fivem -- npx -y fivem-mcp@latest
```

**Cursor** — no CLI for this. Write `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json`
for all of them:

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

Windsurf, Zed, Cline, VS Code and Claude Desktop use the same JSON. Only the file location
differs, and each one's docs say where.

To check it worked, ask for something only this server knows: *"what does
`exports.ox_inventory:CanCarryItem` take?"*

---

## 🧭 Works with your stack

Run `/fivem:init` once, or call `fivemDetectStack` from any MCP client. It reads your
`resources/` folder and `server.cfg` and works out what you run.

| Detected | What you get |
|---|---|
| **ESX Legacy** | `ESX.GetPlayerFromId`, `xPlayer` with dot syntax, named accounts, `esx_*` event conventions |
| **QBCore** | `QBCore.Functions.GetCoreObject`, `Player.Functions.*`, and `job.grade` treated as a **table**, not a number |
| **Qbox** | `qbx_core` for players, ox_lib and ox_target for everything else |
| **ox** | `Ox.GetPlayer`, `lib.callback`, ox_target / ox_inventory exports |
| **standalone** | No framework assumed. Plain natives and your own state |

It flags a **mixed install**, because two frameworks running at once cause duplicate player state
and money desync.

The security audit, native database, server health checks, console-error explanations and
manifest repair work the same way on all of them.

> **On ox:** `/fivem:convert` migrates *toward* ox rather than between arbitrary pairs. Everything
> else treats the frameworks equally — the bundled ESX and QBCore references are as deep as the ox
> ones, and the official docs for all five are searchable.

---

## 📦 What you get

### Commands · Claude Code

| Command | Does |
|---|---|
| `/fivem:init [path]` | Detect your stack once and record it, so every other command uses the right dialect |
| `/fivem:resource <name>` | Scaffold a resource in your framework — manifest, client, server, config, with server-side validation already written in |
| `/fivem:audit [path]` | Security audit against 15 FiveM rules |
| `/fivem:doctor [path]` | Server health check — stack, load order, dependencies, manifests, cfg traps |
| `/fivem:natives <query>` | Look up any of ~7,300 natives, and the wrapper to use instead |
| `/fivem:convert <path>` | Migrate an ESX or QBCore resource to ox |
| `/fivem:lsp [path]` | Wire up lua-language-server so Lua edits get real diagnostics |

### Real diagnostics, not just rules · Claude Code

The automatic security checks read the text of a file. They cannot know that `SetEntityCoodrs`
is a typo, or that a native takes four arguments and got three.

`/fivem:lsp` installs [Overextended's FiveM type definitions](https://github.com/overextended/fivem-lls-addon)
and points [lua-language-server](https://luals.github.io/) at them. After that, every Lua edit is
checked against the real signatures of all ~7,300 natives, automatically.

It needs `lua-language-server` on your PATH. Without it the language server never starts and
everything else works as before.

### Knowledge skills · Claude Code

These load on their own when they're relevant.

| Skill | Covers |
|---|---|
| `fivem-core` | Lua runtime, fxmanifest directives, the natives that actually come up |
| `fivem-security` | 15 exploit rules with detection patterns and fixes |
| `fivem-server-ops` | server.cfg, load order, ACE, artifacts, txAdmin, reading console errors |
| `fivem-frameworks` | ESX / QBCore / Qbox dialects and the full migration map |
| `ox-stack` | ox_lib, ox_core, ox_target, ox_inventory, oxmysql, plus doorlock, fuel, banking and commands |
| `fivem-networking` | Entity ownership, network IDs, state bags, routing buckets, OneSync scoping |
| `fivem-nui` | The Lua↔browser bridge, focus and the stuck cursor, `files{}`, build tooling |
| `fivem-mariadb` | oxmysql, placeholders, schema and indexing, and the atomic update that stops duplication |

### Subagents · Claude Code

Each one takes a single resource, so a whole-server job runs across them at once and their file
reading stays out of your main conversation.

| Agent | Does |
|---|---|
| `fivem-security-auditor` | Audits one resource against SEC-1…15 — automated pass first, then reads every client-reachable handler for the rules a check can't decide |
| `fivem-resource-scout` | Read-only recon: exports, events, callbacks, dependencies, dialect, NUI surface |
| `fivem-manifest-doctor` | Checks and repairs one `fxmanifest.lua` against the files on disk, including case mismatches that only break on Linux |
| `fivem-native-researcher` | Exact natives and wrappers with verified signatures, never from memory |
| `fivem-perf-auditor` | Per-frame loops, uncached natives, entity iteration, stuck NUI focus, with cost estimates |
| `fivem-nui-builder` | The NUI layer for one resource: web assets, Lua bridge, `files{}`, focus lifecycle |
| `fivem-ox-migrator` | Converts one resource from ESX/QBCore to ox, in its own git worktree so migrators can run in parallel |

`/fivem:audit` and `/fivem:convert` run as supervisors, sending specialists out about 8 at a time
and merging what comes back.

For a whole-server audit you'll repeat — before a launch, on a schedule, in CI — the
`fivem-audit-server` workflow does the same job with fixed steps, so two runs over the same
server do the same work. Findings get a second pass that tries to disprove them, and anything it
couldn't cover is named in the report.

### Hooks · Claude Code

**16 events:** session context, credential blocking before a write, lint-on-write reported once
per batch, console-error translation, on-screen secret masking, and context restored after
compaction.

Each one exits immediately when the project isn't a FiveM project, and `enabled: false` turns
them all off without uninstalling anything.

**→ [Full reference: docs/hooks.md](docs/hooks.md)**

### MCP tools · any client

| Tool | Does |
|---|---|
| `fivemDocs` | Read documentation pages, bundled or official |
| `fivemSearch` | Keyword search across the bundled reference or any framework's official docs |
| `fivemNatives` | Resolve a native by name, hash, or a description of the task |
| `fivemAudit` | Run the security checks over Lua source or a file |
| `fivemDetectStack` | Work out which framework and libraries a server folder runs |

All five are read-only, so your editor can use them without asking permission every time.

---

## 📚 Official documentation

Search the bundled reference, or your framework's own docs, from the same tool:

```jsonc
fivemSearch { "query": "job grade", "source": "qbcore" }
```

| `source` | What it is | Size |
|---|---|---|
| `kit` *(default)* | The bundled reference, checked against real resource sources. Works offline | — |
| `esx` | ESX Legacy documentation | 269 KB · 158 pages |
| `qbcore` | docs.qbcore.org | 413 KB · 100 pages |
| `qbox` | Qbox documentation | 152 KB · 102 pages |
| `ox` | overextended.dev | 376 KB · 133 pages |
| `fivem` | Cfx.re server manual and scripting reference — convars, `server.cfg`, OneSync, routing buckets, streaming | 437 KB · 212 pages |

These are the projects' own docs, downloaded to your machine on first use and cached. Nothing is
redistributed and nothing is summarised.

---

## 🔒 The security ruleset

15 rules covering the flaws that get servers wiped. None of them are framework-specific.

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

They aren't all the same kind of check:

| How it's checked | Which rules |
|---|---|
| **Automatically** | SQL injection, dynamic code execution, ungated commands, sensitive broadcasts, `source` after a yield, secrets in source — SEC-3, 5, 7, 8, 10, 12 |
| **Read by the model** | The analyser finds the entry points and says what to check on each: unvalidated parameters, client-supplied price, missing distance check, money races, permission trusted from the UI — SEC-1, 2, 4, 6, 9 |
| **Applied from knowledge** | Rate limiting, internal events exposed to the network, identifier trusted for authorisation, trusted NUI callback — SEC-11, 13, 14, 15 |

`/fivem:audit` and the security-auditor subagent apply all 15, by reading every client-reachable
handler. The write-time hook runs the automatic checks only, on the file you just saved — same
rules, same finding, so the two never disagree.

The analyser also checks two things that aren't security: a `while true` with no `Wait`, and
legacy MySQL APIs.

The rules were tuned against real servers until what's left is what you'd actually fix. Where a
rule needs human judgement it says so instead of guessing.

It knows each framework's spelling of the same dangerous action — ESX's `addAccountMoney`,
QBCore's `AddMoney`, ox's `:deposit` all count as granting value — so an ungated admin command is
caught whichever one you use. A command is only reported when its handler grants value or
control — `/job` printing your own job is not.

---

## 🗂 The native database

`fivemNatives` and `/fivem:natives` search every native FiveM exposes.

| | |
|---|---|
| GTA V natives | ~6,416 across 44 namespaces |
| CFX / FiveM natives | ~943, mostly server-side |
| Resolvable by | Lua name (`SetEntityCoords`), snake name (`SET_ENTITY_COORDS`), hash (`0x06843DA7060A026B`), or a description of the task |

Many natives exist on **both sides** — `SetEntityCoords` is a client native and a server RPC with
a different hash — and it returns the right one for the script you're writing. Where a library
wraps a native, it tells you.

Downloaded from the official CitizenFX endpoint on first use and cached, so it follows game
builds instead of going stale. `FIVEM_CACHE_DIR` sets where.

---

## 🌐 Serving a team

By default everyone runs their own copy. To run one instance your team connects to, it speaks
Streamable HTTP:

```bash
# this machine only, no token needed
npx fivem-mcp --http

# reachable from your network — a token is required
FIVEM_MCP_TOKEN="$(openssl rand -hex 32)" \
FIVEM_SERVER_ROOT=/srv/fivem \
  npx fivem-mcp --http --host 0.0.0.0 --port 3111
```

```json
{
  "mcpServers": {
    "fivem": {
      "url": "http://your-host:3111",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

**It won't listen on a network address without a token — it exits rather than warning.**
`fivemDetectStack` reads a folder the caller names, which is fine when your own editor asks and
not fine when a stranger does, because `server.cfg` holds the database password and the license
key.

`FIVEM_SERVER_ROOT` limits that reading to one folder. The server tells you at startup if you
haven't set it.

---

## ⚙️ Configuration

`/fivem:init` writes `.claude/fivem.local.md`: the detected server path, dialect, framework and
lib, plus per-project switches (`audit_on_write`, `remind_on_stop`, `redact_secrets`, `lsp`,
`beads`). Add `.claude/*.local.md` to your `.gitignore`; init offers to do it.

Machine-wide preferences — preferred dialect for new work, a default server folder,
audit-on-write — are asked for when you enable the plugin and live in your user settings. Where
both set the same thing, the project file wins.

> **The project file is treated as untrusted input.** It lives in the workspace, so a cloned
> FiveM repo can ship one and the hooks read it every session. Every value is checked against an
> allow-list, `server_path` must be a real directory containing `resources/`, unknown keys are
> dropped, parsing is bounded, and nothing from it reaches a shell command.

---

## 🤝 Contributing

Corrections to the API references are the most useful thing you can send — a wrong signature gets
repeated confidently by every model that reads it.

- **Found a bug?** Open a bug report with a minimal resource — the one event that misbehaves,
  plus the full `fxmanifest.lua`.
- **Found a wrong API?** Open an API correction, or go straight to a PR. Either way, say which
  upstream commit you read it in.
- **Want to build something?** Open a feature request and wait for a reply before writing it.

[CONTRIBUTING.md](CONTRIBUTING.md) has the guidelines, including how to prove a correction and
where a new security rule belongs. [DEVELOPMENT.md](DEVELOPMENT.md) has setup and the five
commands CI runs. Working on this repo with an agent? Point it at [AGENTS.md](AGENTS.md) first.

One rule matters more than the rest: **never document an API from memory.** CI checks all **497
documented symbols** against freshly cloned upstream sources, so it will find out.

Maintainers ship directly to `main`. Outside contributions come as PRs from a fork.

---

## 🏗 Built by

[**myRP.build**](https://myrp.build) — describe a resource in plain English and an agent builds it
with full knowledge of your server, then deploys it.

fivem-kit is the free slice of that work, and it lives in your editor: Claude Code, or any client
that speaks MCP. myRP.build is the whole thing — building, testing and deploying to a running
server, without an editor in the loop.

## Credits

Built for the FiveM community and the framework teams whose public APIs it documents — **ESX
Legacy**, **QBCore**, **Qbox**, and **ox (Overextended)** — along with **Cfx.re**, whose natives
and server documentation underpin all of it. fivem-kit is an independent project, is not
affiliated with or endorsed by any of them, and bundles no framework source.

## License

MIT © [Otaku Solutions](https://otakusolutions.io)
