---
name: audit
description: >
  Security-audit FiveM Lua for exploitable server-side defects — unvalidated net events,
  client-supplied prices, missing distance checks, SQL injection, unguarded admin commands,
  secrets committed into client scripts, and money-duplication races. Use when the user says
  "audit this", "is this secure", "check my resource", "review this script", and proactively
  after writing or modifying any server-side handler. Not for performance review (use the
  perf lens) or for non-FiveM Lua.
argument-hint: "[resource path, or blank for the whole server]"
allowed-tools: Bash, Read, Glob, Grep, Agent
---

Security-audit FiveM Lua: **$ARGUMENTS**

You are the supervisor. For anything larger than a single resource, your job is to scope the
work, fan out specialists, and merge what comes back — not to read every file yourself.

## 1. Scope

If `$ARGUMENTS` names a file or one resource, audit it directly (§2) — spawning an agent for
one small resource costs more than it saves.

Otherwise detect the server and enumerate the resources that are actually started:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" --json
```

Framework and library resources (`ox_*`, `qb-core`, `es_extended`, `oxmysql`) are skipped
automatically by the analyser. They are audited upstream, and nobody running this is planning
to patch ox_inventory.

## 2. The mechanical pass is one command

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fivem-audit.mjs" <path> --json
```

It decides **SEC-3, SEC-5, SEC-7, SEC-8, SEC-10, SEC-12, PERF-1 and COMPAT-2** on its own,
with the false-positive classes already tuned out. Take its output as given; the suppressions
are deliberate and regression-tested.

Each finding carries a `key` of `rule:relative/path.lua:line`. Keep it — that key is how a
re-audit recognises a finding it has already reported.

The `reviewRequired` array lists client-reachable handlers the analyser cannot judge. That is
the reading list for §3.

## 3. Fan out for the part a regex cannot decide

**Spawn one `fivem-security-auditor` per resource, batched around 8 per message so they run
concurrently.** Each returns findings for its own resource; none of their file reading lands
in this conversation. That is the entire point — a 40-resource server is otherwise
unauditable in one context.

Give each agent the resource path and the detected dialect. Do not paste file contents into
the prompt; the agent reads what it needs.

For a single resource, do this work yourself instead of spawning:

- **SEC-1** Is every parameter validated against server-side config before use?
- **SEC-2** Does any price, amount, reward or quantity come from the caller?
- **SEC-4** Is the action location-bound, and if so is there a distance check?
- **SEC-6** Are the balance check and the deduction atomic?
- **SEC-9** Is permission re-checked server-side, not only in the UI?
- **SEC-11** Can this be spammed? Is there a server-enforced cooldown?
- **SEC-13/14/15** Internal event exposed to the net? Identifier used for authorisation?
  NUI callback trusted?

Trace the data: client call site → server handler → state mutation. A finding is real only
when you can name the exploit.

## 4. Merge and report

Merge every agent's findings into one report. Deduplicate on `key` — two agents can reach the
same shared file.

Order strictly by severity, most severe first:

```
[SEC-2 · CRITICAL] myshop/server/shop.lua:41
Price is taken from the client.
  TriggerServerEvent('shop:buy', item, price)
  → Any player can send their own price and buy a rifle for $1.
Fix: look the price up from Config.shops[shopId].items[item] server-side.
```

Rules:

- State the concrete exploit with real values, not the abstract rule.
- **Omit rules that do not genuinely apply.** A padded report gets ignored and the real
  CRITICAL goes with it. Say "no findings" when there are none.
- Group by resource, and sort resources by their worst finding.
- Close with a count by severity and the single highest-value fix.
- If you spawned agents, say how many resources were audited. A report that silently covered
  12 of 40 resources reads exactly like one that covered all 40.

## 5. File the findings

CRITICAL and HIGH findings are work, and work belongs in a tracker rather than in a message
that scrolls away.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/beads-sync.mjs" <path> --json
```

Run it after reporting, not instead of reporting. It:

- **Detects rather than requires.** If `bd` is not installed or no database answers, it says
  so and does nothing. Most FiveM developers have never heard of beads; the audit must work
  identically without it.
- **Is idempotent.** Issues are identified by `[RULE] relative/path.lua:LINE`, so re-auditing
  an unfixed resource updates nothing and files nothing. This is the property that matters —
  an audit that spams duplicates gets switched off the same day.
- **Closes what was fixed.** A finding that no longer appears, in a file this audit covered,
  closes its issue. Files outside the audited path are never touched.
- **Files CRITICAL and HIGH only** by default. Pass `--min-severity medium` to widen, or set
  `beads_min_severity` in `.claude/fivem.local.md`.

Honour the project's `beads` setting (`auto` | `on` | `off`) by passing `--mode`. Report what
was filed, reopened and closed in one line — do not paste the issue bodies back into the
conversation, since the whole point is that they now live somewhere durable.

Report only. Do not modify files unless asked — an audit that silently rewrites code destroys
the reviewer's ability to check it.
