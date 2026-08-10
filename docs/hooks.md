# Hooks

fivem-kit registers **16 Claude Code events**, all routed through one dispatcher
(`hooks/fivem-hook.mjs`) that switches on a handler name.

Two properties hold for every one of them, and both are enforced by test:

- **Silent when the project isn't a FiveM project.** Activation is project-scoped — it
  requires a `.claude/fivem.local.md` that parses and is enabled. A machine-wide preference can
  supply a *value* but can never switch the plugin *on*, so an unrelated repository pays
  nothing.
- **Never crashes.** Malformed input, a missing file, an unknown handler, a hostile config —
  all exit 0 silently. A hook that throws interrupts work that has nothing to do with this
  plugin.

Every hook is registered in **exec form** (`command: "node"`, `args: [...]`), never shell form.
That is load-bearing: nothing from the untrusted project config and nothing from a tool input
is ever concatenated into a shell string.

---

## What each event does

| Event | Matcher | What it does |
|---|---|---|
| `SessionStart` | `startup`, `resume`, `clear`, `compact`, `fork` | Injects your detected stack, so the dialect is never re-derived. Adds the QBCore `job.grade`-is-a-table warning when relevant |
| `Setup` | — | Pre-fetches the natives database for CI and `--init-only` runs, so a headless job isn't downloading mid-task |
| `UserPromptSubmit` | — | Re-injects the stack **exactly once** after an in-session compaction, then clears the marker. Not a per-prompt tax |
| `PostCompact` | `auto`, `manual` | Drops the marker the above consumes |
| `PreToolUse` | `Write`/`Edit`/`MultiEdit` on `**/*.lua` | Refuses a write containing a live credential — Discord webhook, MySQL connection string, licence key, private key |
| `PreToolUse` | `Write`/`Edit`/`MultiEdit` on `**/*.cfg` | Same, for `server.cfg` — where the credentials actually live |
| `PostToolUse` | `Write`/`Edit`/`MultiEdit` on `**/*.lua` | Audits the file that was just written and **queues** any CRITICAL/HIGH finding |
| `PostToolBatch` | — | Reports the whole batch's findings **once, aggregated**. Six files written at once produce one report, not six interruptions |
| `PostToolUse` | `Bash` | Recognises FiveM console errors in command output and explains the fix |
| `PostToolUseFailure` | `Bash` | Same catalogue on the failure path — a server that won't boot exits non-zero |
| `SubagentStart` | — | Briefs each `fivem-*` specialist with the detected stack, so the dialect isn't repeated in every prompt |
| `Stop` | — | Backstop: reports findings the batch hook never drained, plus one nudge if three or more Lua files were written |
| `CwdChanged` | — | Invalidates cached detection when you move to a different server folder |
| `DirectoryAdded` | — | Same, for `/add-dir` |
| `FileChanged` | `server.cfg`, `fxmanifest.lua` | Invalidates detection when the stack changes on disk |
| `MessageDisplay` | — | Masks secrets **on screen** without touching the transcript or what the model sees |
| `Notification` | `agent_completed` | Desktop notification when a long parallel audit finishes |
| `SessionEnd` | — | Persists which Lua files were written, so the next session knows what is already clean |

---

## The console-error catalogue

The `Bash` hooks match these signatures and explain the actual cause:

| Signature | What it usually means |
|---|---|
| `Could not find dependency X for resource Y` | `ensure X` must come **before** `ensure Y` in server.cfg — load order is the order of the ensure lines |
| `attempt to index a nil value (global 'lib')` | ox_lib was never imported. `shared_scripts { '@ox_lib/init.lua' }` is missing from fxmanifest.lua |
| `attempt to index a nil value (global 'ESX'/'QBCore')` | The framework object isn't available — check start order and the import line |
| `Failed to load script X` | Path is wrong, or the case doesn't match the file on disk. Linux hosts are case-sensitive and Windows isn't, so this often appears only in production |
| `No such export X in resource Y` | Y failed to start, or the export name changed. A resource that errored during load exports nothing |
| `couldn't start resource X` | Read the lines **above** it — this is the consequence, not the cause |

---

## Turning them off

Per-project, in `.claude/fivem.local.md`:

```yaml
enabled: false          # stand every hook down for this project
audit_on_write: false   # keep the rest, stop linting on write
remind_on_stop: false   # stop the end-of-turn nudge
redact_secrets: false   # stop the write-blocking and on-screen masking
```

`enabled: false` is the right answer if you want the skills and the MCP server but none of the
automation.

---

## Why one dispatcher rather than sixteen scripts

The quick-exit guard, the JSON output contract, and the never-crash policy are written once and
tested in one place. Every entry in `hooks.json` has the same shape, so an event added later
can't accidentally get a different contract.

One detail worth knowing if you write hooks yourself: a **deny decision goes to stdout with
exit 0**, not exit 2. Exit 2 discards stdout entirely and hard-blocks with whatever is on
stderr, losing the structured reason. Several published examples get this backwards, so there
is an explicit test asserting the exit code is 0 on a denial.
