---
name: doctor
description: >
  Health-check a FiveM server — detected framework, resource load order against declared
  dependencies, fxmanifest defects, and server.cfg traps such as the semicolon FiveM splits
  on. Use when the user says "check my server", "why won't this resource start", "something
  is broken", "health check", or reports a resource failing to load. Read-only; it reports
  and never edits the cfg or restarts anything.
argument-hint: "[server path]"
allowed-tools: Bash, Read, Glob, Grep
---

Health-check a FiveM server: **$ARGUMENTS**

Load the `fivem-server-ops` skill for the error catalogue and cfg rules.

## 1. Detect

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" $ARGUMENTS --json
```

If nothing is found, ask for the path to the folder containing `resources/`.

## 2. Check each of these and report only what is actually wrong

**Stack**
- More than one framework installed (`mixedFrameworks`) — flag loudly; this causes
  duplicate player state and money desync.
- Legacy components: `mysql-async` / `ghmattimysql` instead of oxmysql, `qtarget` /
  `bt-target` instead of ox_target.

**server.cfg**
- Lines containing `;` — FiveM splits on it and runs each half as its own command. Report
  every one with its line number; this silently mis-starts resources.
- Resources started in the cfg that don't exist on disk (`warnings.startedNotOnDisk`).
- Resources on disk that are never started — informational, not an error; many are
  intentionally disabled. Summarise the count, list them only if asked.
- Secrets set with `setr` (replicated to every client) rather than `set`.

**Load order**
- Verify against the real dependency chain: `oxmysql → ox_lib → ox_core → ox_target /
  ox_inventory → everything else`.
- Cross-check each resource's declared `dependencies` (the detector reports them) against
  the cfg order. Anything ensured before a dependency it declares is a defect.

**Manifests**
- `__resource.lua` still in use (deprecated).
- Missing `fx_version` / `game`.
- Uses `lib.*` but has no `@ox_lib/init.lua` in `shared_scripts`.
- Uses `MySQL.*` but has no `@oxmysql/lib/MySQL.lua` in `server_scripts`.
- `ui_page` set but its assets are not listed in `files`.
- Script paths in the manifest that don't exist on disk — and flag case mismatches
  explicitly, since Linux hosts are case-sensitive and Windows is not.

## 3. Report

Group as **Errors** (will break at runtime) → **Warnings** (will bite later) →
**Notes** (informational). Give the file and line for anything actionable, and the fix in
one line each. If a section is clean, say so in one line rather than padding it.

Finish with the single highest-value fix to make first.

Read-only. Do not edit the cfg, restart the server, or change any resource.
