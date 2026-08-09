---
description: Look up FiveM natives and the ox wrapper to prefer
argument-hint: <native name or what you want to do>
allowed-tools: Read, Grep, WebFetch
---

Look up: **$ARGUMENTS**

1. Search `${CLAUDE_PLUGIN_ROOT}/skills/fivem-core/references/natives.md` first — it is the
   curated set, ranked by real usage, and it names the ox_lib wrapper to prefer where one
   exists. If the `fivem-kit` MCP server is connected, its `fivemNatives` tool does the same
   lookup.

2. If it isn't there, fetch the authoritative reference at
   `https://docs.fivem.net/natives/` rather than recalling a signature from memory —
   argument order and return values are easy to get subtly wrong.

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
