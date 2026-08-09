---
description: Look up FiveM natives and the ox wrapper to prefer
argument-hint: <native name or what you want to do>
allowed-tools: Read, Grep, WebFetch
---

Look up: **$ARGUMENTS**

1. **If the `fivem-kit` MCP server is connected, use its `fivemNatives` tool.** It searches
   the complete database — every GTA V native plus the CFX/FiveM namespace, about 7,300 in
   total — by name, hash, or task description, and returns the authoritative signature.
   Pass `side: "server"` or `side: "client"` when it matters; many natives exist on both
   with different hashes.

2. Otherwise search `${CLAUDE_PLUGIN_ROOT}/skills/fivem-core/references/natives.md` — the
   curated set, ranked by real usage, naming the ox_lib wrapper to prefer.

3. If it is in neither, fetch `https://docs.fivem.net/natives/` rather than recalling a
   signature from memory — argument order and return values are easy to get subtly wrong,
   and a plausible-looking wrong signature is worse than admitting you need to check.

Report:

- the exact signature, and whether it is **client**, **server**, or both
- a one-line usage example
- **the ox_lib / ox_core equivalent if one exists**, and a recommendation to use it — the
  wrappers exist because the raw native needs a wait loop, cleanup, or a timeout that
  hand-written code usually omits
- any adjacent native the caller will need (e.g. `RequestModel` also needs
  `HasModelLoaded` and `SetModelAsNoLongerNeeded`)

If the request describes a task rather than naming a native ("make an NPC walk over"),
give the natives for it in call order, plus the ox wrapper if there is one.
