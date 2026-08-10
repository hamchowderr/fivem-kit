# Changelog

All notable changes to fivem-kit — both the Claude Code plugin and the `fivem-mcp` npm
package, which are versioned together.

This project follows [Semantic Versioning](https://semver.org): given `MAJOR.MINOR.PATCH`,
MAJOR is for breaking changes, MINOR for backwards-compatible new functionality, and PATCH
for backwards-compatible fixes. While the MAJOR is `0` the public API is still settling, so
expect MINOR to move faster than it would after 1.0.0.

## [0.2.0] — 2026-08-10

Two additive MCP capabilities. No breaking changes, and no change to what any existing
client already sees — hence MINOR rather than MAJOR, and MINOR rather than PATCH because
both are new functionality rather than fixes.

### Added

- **Tool annotations.** All five tools declare `readOnlyHint`, `destructiveHint` and
  `idempotentHint`, so a client can auto-approve them instead of prompting on every call.
  `openWorldHint` marks the two that reach outside the bundle — `fivemNatives` fetches the
  CitizenFX database, `fivemDetectStack` reads whatever is on disk.
- **Structured tool output** (MCP 2025-06-18) on `fivemAudit` and `fivemDetectStack`. Both
  declare an `outputSchema` and return `structuredContent` alongside the existing text, so a
  client receives typed findings and a typed stack report rather than parsing prose. The text
  block is unchanged, so a client that ignores structured output is unaffected — which is
  what makes this backwards compatible.

## [0.1.0] — 2026-08-09

Initial public release.

### Plugin (Claude Code)

- **11 skills** — `/fivem:init`, `/fivem:resource`, `/fivem:audit`, `/fivem:doctor`,
  `/fivem:convert`, `/fivem:natives`, plus the `ox-stack`, `fivem-core`, `fivem-frameworks`,
  `fivem-security` and `fivem-server-ops` knowledge skills.
- **Seven subagents** — `fivem-security-auditor`, `fivem-resource-scout`, `fivem-ox-migrator`,
  `fivem-manifest-doctor`, `fivem-native-researcher`, `fivem-perf-auditor`, `fivem-nui-builder`.
  Each takes one resource, so `/fivem:audit` and `/fivem:convert` fan out across a whole
  server and merge the results.
- **16 hook events** through one dispatcher in exec form. Injects the detected dialect at
  session start, blocks writes containing live credentials, lints Lua after it is written,
  explains FiveM console errors, masks secrets on screen, and re-establishes context exactly
  once after a compaction. Silent and free in projects that are not FiveM projects.
- **`/fivem:init`** detects the server stack once and records it in `.claude/fivem.local.md`,
  so every later command speaks the right dialect. Machine-wide preferences are prompted for
  at install time.
- **Stack detection** for ox_core, ESX Legacy, QBCore and Qbox, plus the library layer —
  ox_lib, oxmysql, ox_target, ox_inventory and their alternatives.

### MCP server (`fivem-mcp`, any MCP-capable editor)

- Five tools: `fivemDocs`, `fivemSearch`, `fivemNatives`, `fivemAudit`, `fivemDetectStack`.
- The **complete native database** — ~6,400 GTA V natives plus ~940 CFX/FiveM natives, with
  parameter names, types and official descriptions, resolvable by Lua name, snake name, hash
  or a description of the task. Fetched from the official CitizenFX endpoint on first use and
  cached; not bundled, because those repositories publish no license.
- A **15-rule security analyser** tuned for precision against 931 real resource files drawn
  from ox, ESX, QBCore, Qbox and the qb-scripts collection.

### Security

- `.claude/fivem.local.md` is parsed as untrusted input. It lives in the workspace, so a
  cloned repository can ship one and the hooks read it every session. Values are validated
  against allow-lists, `server_path` must resolve to a real directory containing `resources/`,
  unknown keys are dropped, parsing is bounded, and nothing from the file is ever interpolated
  into a shell command.
