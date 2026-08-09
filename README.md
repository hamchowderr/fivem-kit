# fivem-kit

**FiveM development tooling for AI editors.** Stop getting invented `ox_lib` functions and
QBCore APIs that don't exist.

fivem-kit gives Claude Code — and Cursor, Windsurf, Claude Desktop, VS Code, Zed, or
anything else that speaks MCP — real FiveM knowledge: the Lua runtime, `fxmanifest.lua`,
GTA V natives, the full **ox (Overextended)** stack, plus **ESX Legacy**, **QBCore** and
**Qbox**. Every API in it is verified against actual resource sources, not recalled from
training data.

It also does two things a docs bundle can't:

- **Detects your server's real stack** and writes in that dialect. ox server gets ox code.
  ESX server gets `xPlayer` with dot syntax. QBCore gets `job.grade.level`, not `job.grade`.
- **Audits your Lua for exploits** — SQL injection, unguarded admin commands, `source` used
  after a yield, secrets committed into client scripts, and the client-trust flaws that
  drain FiveM economies.

---

## Install

### Claude Code (full plugin — skills, commands, and the MCP server)

```
/plugin marketplace add hamchowderr/fivem-kit
/plugin install fivem-kit
```

### Any other MCP editor (docs + audit + detection)

```bash
npx -y fivem-kit-mcp
```

Cursor, Windsurf, Claude Desktop, VS Code — add to your MCP config:

```json
{
  "mcpServers": {
    "fivem-kit": {
      "command": "npx",
      "args": ["-y", "fivem-kit-mcp@latest"]
    }
  }
}
```

---

## What you get

### Commands (Claude Code)

| Command | Does |
|---|---|
| `/fivem:resource <name>` | Scaffold a resource matched to your server's framework — manifest, client, server, config, with server-side validation written in from the start |
| `/fivem:audit [path]` | Security audit against a 15-rule FiveM-specific ruleset |
| `/fivem:doctor [path]` | Server health check — stack, load order, dependencies, manifests, cfg traps |
| `/fivem:convert <path>` | Migrate an ESX or QBCore resource to ox |
| `/fivem:natives <query>` | Look up a native, and the ox wrapper you should use instead |

### Skills (load automatically when relevant)

| Skill | Covers |
|---|---|
| `ox-stack` | ox_lib, ox_core, ox_target, ox_inventory, oxmysql — callbacks, zones, UI, targeting, inventory, worked resources |
| `fivem-core` | Lua runtime, fxmanifest directives, the natives that actually come up |
| `fivem-frameworks` | ESX / QBCore / Qbox dialects and the full migration map |
| `fivem-security` | 15 exploit rules with detection patterns and fixes |
| `fivem-server-ops` | server.cfg, load order, ACE, artifacts, txAdmin, reading console errors |

### MCP tools (any editor)

`fivemDocs` · `fivemSearch` · `fivemNatives` · `fivemAudit` · `fivemDetectStack`

---

## Why it exists

Generic AI writes FiveM code that looks right and isn't. It invents `ox_lib` functions,
mixes ESX and QBCore idioms in one file, compares `job.grade` against a number when QBCore
makes it a table, and — most expensively — writes server handlers that trust whatever the
client sent.

That last one isn't a style problem. This is the single most common shape of FiveM exploit:

```lua
-- what tutorials and AI both produce
RegisterNetEvent('shop:buy', function(item, price)
    exports.ox_inventory:AddItem(source, item, 1)
    player:getAccount():withdraw(price)     -- price came from the player
end)
```

Any player sends their own price. fivem-kit knows this, writes the validated version by
default, and flags it when it finds it in yours.

---

## The security ruleset

15 rules covering the flaws that actually get servers wiped:

| | |
|---|---|
| SEC-1 | Unvalidated net event handler |
| SEC-2 | Client-supplied price, amount or reward |
| SEC-3 | `source` lost across a yield |
| SEC-4 | Missing distance check |
| SEC-5 | SQL injection |
| SEC-6 | Check-then-act race (money duplication) |
| SEC-7 | Unrestricted admin command |
| SEC-8 | Secret in a client script |
| SEC-9 | Server permission missing behind client-side gating |
| SEC-10 | Code execution from client input |
| SEC-11 | No rate limiting on a valuable action |
| SEC-12 | Sensitive data broadcast to every player |
| SEC-13 | Internal event exposed to the network |
| SEC-14 | Identifier trusted for authorisation |
| SEC-15 | NUI callback trusted |

The analyser decides the mechanical ones itself and returns targeted review prompts for
the ones that need judgement — it does not pad the report with guesses.

**Tuned for precision against real code.** Sweeping 809 resource files from ox, ESX,
QBCore, Qbox and the qb-scripts collection took the finding count from 79 to 16 by
eliminating six classes of false positive — `lib.load()` read as `load()`, nested tables
truncating a command config, an inner `end` cutting a loop scan short, `if source ~= 0`
console guards, framework command wrappers with their own permission model, and SQL that
interpolates a *column or table identifier* while still binding its values. What survives
is genuine: qb-scripts really do still call the deprecated `MySQL.Async` API.

An ungated command is only reported when its handler actually grants value or control —
`/job` printing your own job is not a vulnerability, and reporting it would bury the ones
that are. 29 regression tests lock every one of those distinctions in place.

---

## Requirements

Node.js 18+. No FiveM server required for the docs; the detector and doctor need a server
folder to look at.

---

## Built by

[**myRP.build**](https://myrp.build) — describe a resource in plain English and an
ox-native agent generates it with full awareness of your server, then deploys it. fivem-kit
is the free, local, terminal-side slice of that work.

## Credits

Built for the **ox_overextended** ecosystem — ox_core, ox_lib, ox_inventory, ox_target and
oxmysql — created and maintained by the Overextended team and its contributors. fivem-kit
is an independent project, is not affiliated with or endorsed by Overextended or Cfx.re,
and bundles no ox source; it documents public APIs and generates code that calls them at
arm's length.

## License

MIT © [Otaku Solutions](https://otakusolutions.io)

## Contributing

Corrections to the API references are especially welcome — ox moves fast, and a wrong
signature in here is worse than a missing one. Open an issue or a PR with the resource
version you verified against.
