---
description: Audit FiveM resources for exploitable security flaws
argument-hint: [resource path, or blank for the whole server]
allowed-tools: Bash, Read, Glob, Grep
---

Security-audit FiveM Lua: **$ARGUMENTS**

Load the `fivem-security` skill — it holds the full ruleset (SEC-1 … SEC-15 plus the
performance and compatibility rules). Audit against it.

## 1. Scope

If `$ARGUMENTS` names a resource or path, audit that. If it's empty, detect the server and
audit the resources that are actually started:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" --json
```

Skip the framework and library resources themselves (`ox_*`, `qb-core`, `es_extended`,
`oxmysql`) unless explicitly asked — audit the server's own resources, which is where the
exploitable code lives.

## 2. Run the mechanical pass

For each `.lua` file, run the static analyser — it catches SQL injection, dynamic code
execution, unguarded commands, `source` used after a yield, committed secrets, sensitive
broadcasts, `while true` without `Wait`, and legacy MySQL APIs:

If the `fivem-kit` MCP server is connected, call its `fivemAudit` tool per file. Otherwise
read the files and apply the ruleset by hand.

## 3. Then do the part a regex cannot

The mechanical pass cannot decide the most important rules. For **every**
`RegisterNetEvent`, `lib.callback.register`, `ESX.RegisterServerCallback`,
`QBCore.Functions.CreateCallback` and `RegisterNUICallback` on the server, read the handler
and answer:

- **SEC-1** Is every parameter validated against server-side config before it is used?
- **SEC-2** Does any price, amount, reward or quantity come from the caller?
- **SEC-4** Is the action location-bound, and if so is there a distance check?
- **SEC-9** Is job/group/item permission re-checked server-side, not just in the UI?
- **SEC-6** Are balance checks and deductions atomic? Is the item added before payment?
- **SEC-11** Can this be spammed? Is there a cooldown on anything that mints value?

Trace the data: client call site → server handler → state mutation. A finding is real only
if you can name the exploit.

## 4. Report

Order strictly by severity, most severe first:

```
[SEC-2 · CRITICAL] server/shop.lua:41
Price is taken from the client.
  TriggerServerEvent('shop:buy', item, price)
  → Any player can send their own price and buy a rifle for $1.
Fix: look the price up from Config.shops[shopId].items[item] server-side.
```

Rules:

- State the concrete exploit, not the abstract rule. "An attacker could X" with real values.
- **Omit rules that don't genuinely apply.** A padded report gets ignored and the real
  CRITICAL is lost with it. Say "no findings" when there are none.
- Group by file, but sort files by their worst finding.
- Close with a one-line count by severity.

Report only. Do not modify files unless asked — an audit that silently rewrites code
destroys the reviewer's ability to check it.
