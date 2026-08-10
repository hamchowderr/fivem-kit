# Changelog

All notable changes to fivem-kit — both the Claude Code plugin and the `fivem-mcp` npm
package, which are versioned together.

This project follows [Semantic Versioning](https://semver.org). While on `0.x`, MINOR covers
added functionality and PATCH covers fixes; nothing here has required a breaking change yet.

## [0.2.0] — 2026-08-10

### Added

- **MCP tool annotations.** All five tools now declare `readOnlyHint`, `destructiveHint` and
  `idempotentHint`, so a client can auto-approve them instead of prompting. `openWorldHint`
  marks the two that reach outside the bundle — `fivemNatives` fetches the CitizenFX database,
  `fivemDetectStack` reads whatever is on disk.
- **Structured tool output** (MCP 2025-06-18) on `fivemAudit` and `fivemDetectStack`. Both
  declare an `outputSchema` and return `structuredContent` alongside the existing text, so a
  client gets typed findings and a typed stack report rather than parsing prose. The text
  block is unchanged, so older clients are unaffected.
- **`/fivem:init`** — detects the server stack once and records it in `.claude/fivem.local.md`
  so every later command speaks the right dialect. Four user-level preferences are prompted
  for at install time.
- **Seven subagents** — `fivem-security-auditor`, `fivem-resource-scout`, `fivem-ox-migrator`,
  `fivem-manifest-doctor`, `fivem-native-researcher`, `fivem-perf-auditor`, `fivem-nui-builder`.
  Each takes one resource, so `/fivem:audit` and `/fivem:convert` fan out across a whole server
  and merge the results.
- **16 hook events**, all through one dispatcher in exec form. Injects the detected dialect at
  session start, blocks writes containing live credentials, lints Lua after it is written,
  explains FiveM console errors, masks secrets on screen, and re-establishes context exactly
  once after a compaction.
- **`scripts/fivem-audit.mjs`** — audits a file, a resource or a whole server, with stable
  finding keys (`rule:relative/path.lua:line`) so re-auditing updates rather than duplicates.

### Fixed

- **SEC-7 missed the entire ESX money and inventory API.** The privileged-action pattern
  matched `AddMoney` and `AddItem` but not ESX Legacy's `addAccountMoney`, `addInventoryItem`
  or `addWeapon` — spellings that appear in the hundreds across real addon collections, so an
  ungated command granting money through ESX was invisible. A sweep of 931 real resource files
  is unchanged at 15 findings, so the fix adds no false positives.
- **The secret scanner passed every real Discord webhook.** Its placeholder filter matched
  `123456789` unanchored, which appears inside every 18-digit snowflake ID.
- **The secret scanner refused legitimate documentation.** `mysql://user:pass@localhost/db`
  was treated as a live credential on the blocking path, so the plugin would not write its own
  docs. Real-looking passwords are still caught.
- **Finding keys collapsed across files.** Auditing a single file made that file its own key
  root, so `path.relative` returned an empty string and every file shared one key.
- **Windows paths were written as invalid YAML.** `server_path: "C:\Users\..."` — a backslash
  starts an escape inside a double-quoted YAML scalar. Now single-quoted.

### Security

- `.claude/fivem.local.md` is parsed as untrusted input. It lives in the workspace, so a cloned
  repository can ship one and the hooks read it every session. Values are validated against
  allow-lists, `server_path` must resolve to a real directory containing `resources/`, unknown
  keys are dropped, parsing is bounded, and nothing from the file is ever interpolated into a
  shell command.

## [0.1.0] — 2026-08-09

Initial release: 11 skills, the ~7,300-native database, the security ruleset, stack detection,
and the `fivem-mcp` server for any MCP-capable editor.
