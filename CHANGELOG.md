# Changelog

All notable changes to fivem-kit — both the Claude Code plugin and the `fivem-mcp` npm
package, which are versioned together.

This project follows [Semantic Versioning](https://semver.org): given `MAJOR.MINOR.PATCH`,
MAJOR is for breaking changes, MINOR for backwards-compatible new functionality, and PATCH
for backwards-compatible fixes. While the MAJOR is `0` the public API is still settling, so
expect MINOR to move faster than it would after 1.0.0.

## [0.2.0] — 2026-08-10

Additive throughout. Nothing breaks and no existing client sees a different response, which
is why this is MINOR rather than MAJOR — and MINOR rather than PATCH because it is new
functionality rather than fixes.

### Added

- **Official documentation for every supported framework.** `fivemSearch` takes a `source` of
  `kit` (the bundled, source-verified reference), `ox`, `qbcore`, `esx`, `qbox` or `fivem`.
  Measured: ox 376KB/133 pages, QBCore 413KB/100, ESX 269KB/158, Qbox 152KB/102, FiveM
  437KB/212. The FiveM source covers the server manual and scripting reference — convars,
  `server.cfg`, OneSync, routing buckets, streaming — which had almost no coverage before.

  Every fetch validates on **content, never status**. ESX's documentation site answers HTTP
  200 for any path and returns its HTML homepage; a fetcher trusting the status code would
  cache a website's navigation as API reference. Validation requires non-HTML, a plausible
  size, and the marker term appearing often enough to be reference material. A source that
  fails is never cached and never served. ESX, Qbox and FiveM are assembled from the markdown
  in their documentation repositories, since none of the three publishes a usable corpus from
  its site. None publish a license either, so nothing is redistributed — the corpus is
  fetched onto the user's own machine, the same reasoning that keeps the natives database out
  of the npm package.

- **Audit findings become tracked issues.** `/fivem:audit` files CRITICAL and HIGH findings
  into beads, identified by `[RULE] relative/path.lua:LINE`. Re-auditing an unfixed resource
  files and changes nothing; a finding that disappears closes its issue, bounded to files
  that audit actually covered; a finding that returns reopens rather than duplicating. It
  detects rather than requires — no beads, no problem, the audit is unchanged.

- **Tool annotations.** All five tools declare `readOnlyHint`, `destructiveHint` and
  `idempotentHint`, so a client can auto-approve them instead of prompting on every call.
  `openWorldHint` marks the two that reach outside the bundle — `fivemNatives` fetches the
  CitizenFX database, `fivemDetectStack` reads whatever is on disk.

- **Structured tool output** (MCP 2025-06-18) on `fivemAudit` and `fivemDetectStack`. Both
  declare an `outputSchema` and return `structuredContent` alongside the existing text, so a
  client receives typed findings and a typed stack report rather than parsing prose. The text
  block is unchanged, so a client that ignores structured output is unaffected — which is
  what makes this backwards compatible.

- **CI and a release gate.** Every push runs the full suite on Node 20, 22 and 24 (the
  `engines` range was previously a promise nothing checked), plus `claude plugin validate`,
  the ox API verification against freshly cloned upstream sources, tarball inspection and an
  MCP smoke test over stdio. Publishing happens only from a `v*` tag, and only when the three
  manifests agree with each other, agree with the tag, and the changelog documents that
  version.

- **Four more ox resources documented** — `ox_doorlock` (12 exports across both sides, its
  events, and why `registerHook` beats scattering permission checks), `ox_fuel`
  (`setPaymentMethod` / `setMoneyCheck` as the integration surface for a custom economy),
  `ox_banking` (a front end; the money lives in ox_core's accounts) and `ox_commands` (a
  two-command pack, not a library — documented as a pattern to copy). Verification gained a
  TypeScript walker along the way, because ox_banking is written in TS rather than Lua.

- **Three new knowledge skills.** `fivem-networking` (entity ownership and control requests,
  network IDs, state bags and their asymmetric replication, routing buckets, OneSync scoping
  and culling — the mechanics behind "works for me, not for other players", previously at
  zero coverage), `fivem-nui` (the Lua↔browser bridge, `SetNuiFocus` and the stuck-cursor
  failure, the `files{}` requirement behind most blank pages, `cfx-nui-` asset paths, build
  tooling) and `fivem-mariadb` (oxmysql's full API, positional vs deprecated named
  placeholders, `MySQL.prepare`'s stricter rules, schema and indexing for
  characters/vehicles/inventory, JSON columns versus normalised tables, and the
  single-statement atomic `UPDATE … AND cash >= ?` that closes the duplication race).

- **Every native name is now verified too.** Natives were the largest unverified surface in
  the project: the references are mostly native calls, and nothing checked them. A new
  verifier target resolves each one against the official CitizenFX natives database. Runtime
  functions that legitimately are not natives (`TriggerServerEvent`, `Entity`, `GetPlayers`,
  the NUI-side `GetParentResourceName`) are listed explicitly with their provenance rather
  than being waved through by a loose pattern.

  It also refuses to guess: distinguishing a native from a framework method requires the ox
  and framework sources to be loaded, so without them the target reports SKIPPED — which
  `--strict` treats as a failure — instead of flagging every documented framework method as
  invented.

- **`oxmysql` is now a verified source.** It was the one ox resource the documentation
  referenced without ever checking, which is precisely the gap `fivem-mariadb` would have
  been written into.

- **`node scripts/update-sources.mjs`** clones or updates every upstream source the
  references are written from, and reports what moved. Documentation here is written by
  reading real source, so a stale checkout means a stale first draft — the QBCore reference
  was written against a seven-month-old clone and documented a compatibility shim as the
  primary API. The prose documentation repositories are included (they are where the
  networking and NUI concepts come from, and both were three months behind); CI passes
  `--no-docs` since it verifies symbols against code, never prose.

- **`docs/hooks.md`** — all 16 hook events with their matchers, the FiveM console-error
  catalogue and what each signature actually means, and how to switch any of them off. They
  were previously documented nowhere.

### Changed

- **The supported Node range moved to `>=20`**, tested on 20, 22 and 24. Node 18 went EOL on
  2025-04-30 and was still both the `engines` floor and a CI job, which is a support claim for
  a runtime that receives no security patches — and a green tick asserting it. 20 stays as the
  floor rather than 22 because installed editors still ship it; 24 is LTS to 2028 and is where
  people are moving. This is stricter than the MCP SDK's own `>=18`, deliberately.

  A raised `engines` floor is a compatibility change for anyone still on 18. It lands here
  rather than in a later release precisely because 0.2.0 has not shipped yet.

- **GitHub Actions pinned to v7** (`actions/checkout`, `actions/setup-node`), three majors on
  from v4. v4 declares `runs.using: node20`, which GitHub is retiring — the runner was already
  force-running them on node24 and warning about it. Unrelated to the range above: that
  version governs the runtime the actions' own JavaScript executes on, not our package.

### Fixed

- **The test command only worked on the author's machine.** `node --test "test/*.test.mjs"`
  relies on node expanding the glob itself, which older releases do not do — so the suite
  found zero tests on Linux while passing locally.
- **The ox API verification reported success after verifying nothing.** An empty or failed
  clone produced "All documented ox APIs verified present" and exit 0 having checked zero
  symbols. Verifying nothing is now a failure, and `--strict` additionally requires every
  resource to be present.
- **The secret scanner refused legitimate documentation.** `mysql://user:pass@localhost/db`
  was treated as a live credential on the blocking path, so the plugin would not write its
  own docs. Real-looking passwords are still caught.
- **The verification count overstated itself by 136 symbols.** Three targets spread the same
  extraction twice, which deduplicated nothing and simply counted every ox_lib, ox_core and
  ox_inventory symbol a second time. The honest figure is 497 including natives, not 488.
  A count that flatters itself is the same failure as a check that passes without checking,
  just quieter.

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
