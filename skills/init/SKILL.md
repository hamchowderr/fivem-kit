---
name: init
description: >
  Detect which FiveM stack this project runs — ox, ESX, QBCore or Qbox — and record it in
  `.claude/fivem.local.md` so every later command speaks the right dialect instead of
  re-deriving it. Use when the user says "set up fivem-kit", "init", "configure the plugin",
  "point this at my server", or when any other fivem command reports that no server was
  detected. Run once per project; re-run after changing framework or moving the server.
argument-hint: "[path to the folder containing resources/]"
allowed-tools: Bash, Read, Glob
---

Set up fivem-kit for this project: **$ARGUMENTS**

## 1. Detect and write

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fivem-init.mjs" $ARGUMENTS --json
```

The script does the whole job — detect, write, verify — so do not hand-write the config
file. It round-trips its own output through the hardened reader, which is what guarantees
the hooks will actually read what it wrote.

Read the `status` field:

| `status` | What it means | Do this |
|---|---|---|
| `written` | config created and verified | report the summary (§2) |
| `exists` | a config is already there | show `current` vs `detected`; re-run with `--force` only if the user confirms, or if `detected` differs materially from `current` |
| `not-found` | no folder containing `resources/` | ask for the server path, then re-run with it as the argument |
| `invalid` | written but failed validation | this is a bug in the plugin, not user error — report the warnings verbatim |

If the user gave no path and detection fails, do **not** guess. Ask where the server lives —
the folder containing `resources/`, typically `server-data` next to the FXServer artifacts.

## 2. Report what was detected

Keep it to a few lines: server path, dialect, framework, lib, resource count.

Then flag anything that will bite:

- **`mixedFrameworks: true`** — more than one framework is installed. Say so loudly. This
  causes duplicate player state and money desync, and it means generated code could target
  the wrong one. Ask which is authoritative.
- **`dialect: "standalone"`** — no framework found. Confirm that is intentional before
  scaffolding anything; it usually means the path points at the wrong folder.
- **`gitignore.status: "absent"`** — tell the user to add `.claude/*.local.md` to their
  ignore file. The config records a path on their machine.

## 3. What the file controls

`.claude/fivem.local.md` is per-project state, not user preference. It holds `server_path`,
`dialect`, `framework`, `lib`, and the per-project switches: `audit_on_write`,
`remind_on_stop`, `redact_secrets`, `lsp`, `beads`.

Machine-wide preferences live in the plugin's own settings instead (`default_dialect`,
`default_server_path`, `audit_on_write`, `beads`) — reachable via `/plugin`. The project file
wins wherever both set the same thing, because it describes *this* server.

Setting `enabled: false` makes every hook stand down for this project without uninstalling
anything. That is the right answer for someone who wants the skills but not the automation.

## 4. Security note — worth stating once

Everything in `.claude/fivem.local.md` is treated as untrusted input. It lives in the
workspace, so a cloned FiveM repository can ship one, and the plugin's hooks read it on
every session. Values are validated against allow-lists, `server_path` must resolve to a
real directory containing `resources/`, unknown keys are dropped, and nothing from the file
is ever interpolated into a shell command.

So: a committed config cannot do harm, but it also will not work on anyone else's machine —
the path check will simply drop it. Per-developer, gitignored, is the intended shape.

Do not edit `.claude/fivem.local.md` by hand when the script can write it. Hand-editing is
fine for the switches; `/fivem:init --force` is the way to refresh the detected fields.
