---
description: Convert an ESX or QBCore resource to the ox stack
argument-hint: <resource path>
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

Convert to ox: **$ARGUMENTS**

Load the `fivem-frameworks` skill and read `references/migration-map.md` — it is the
line-by-line translation table. Load `ox-stack` for the target APIs.

## 1. Establish what you're converting

Read the whole resource before changing anything. Identify:

- source framework (ESX / QBCore / Qbox / mixed)
- which subsystems it touches: SQL, callbacks, UI, targeting, inventory, money, jobs
- whether it has a `.sql` file or item definitions (those are data migrations, not code)

Run the detector on the destination server so the conversion targets what's actually
installed — converting to `ox_inventory` on a server that doesn't run it is not useful.

## 2. Convert in this order, and stop between stages

1. **SQL** → oxmysql `await` API, `?` placeholders, `@oxmysql/lib/MySQL.lua` in the manifest.
2. **Callbacks** → `lib.callback`. Note the shape change: ox callbacks **return** a value
   instead of calling `cb(...)`.
3. **UI** → `lib.notify`, `lib.progressBar`, `lib.registerContext`, `lib.inputDialog`,
   `lib.showTextUI`.
4. **Targeting** → `exports.ox_target`. Rename `event`/`action` → `onSelect`, `job` →
   `groups`, `item` → `items`. **Re-measure zones** rather than converting the numbers
   arithmetically — qb-target's box dimensions do not map cleanly onto ox_target's `size`
   vec3, and this is the most common visual regression.
5. **Inventory** → `exports.ox_inventory`. `info` becomes `metadata`. Check every
   `AddItem` return value.
6. **Player/money/jobs** → ox_core. This is the one that changes semantics: jobs become
   groups, and `xPlayer.getJob().name == 'police'` becomes
   `player:getGroup('police')` returning a grade or nil.

## 3. Call out what you cannot safely do

State these plainly rather than attempting them:

- **Item definitions and weights** move to `ox_inventory/data/items.lua` with different
  fields and real enforced weights. Write the new definitions, but say clearly that
  players may be over capacity on first load.
- **Money migration** has no automatic mapping — ESX named accounts and QBCore
  `cash`/`bank`/`crypto` do not map onto ox accounts without a decision. Ask which becomes
  which. Write the SQL, do not run it.
- **Database changes require a backup first.** Say so, every time.

## 4. Finish

- Update `fxmanifest.lua`: dependencies, the ox_lib and oxmysql imports, `ox_libs` if used.
- Note every behaviour change the server owner will notice, not just the code changes.
- Run `/fivem:audit` over the result — a port is exactly when validation gets dropped, and
  converted code frequently loses checks the original had.
- Never run migrations or touch a live server. Produce the files and the runbook.
