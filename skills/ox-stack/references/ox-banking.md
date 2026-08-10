# ox_banking

Bank and ATM UI on top of ox_core's accounts. The resource is written in **TypeScript**
(`src/client`, `src/server`, `src/web`), not Lua, which is worth knowing before you go looking
for `.lua` files to read.

```lua
exports.ox_banking:openBank()   -- client: open the bank interface
exports.ox_banking:openAtm()    -- client: open the ATM interface
```

That is the whole scripting surface — it is a **front end**. The money itself is ox_core's:
accounts, balances, transfers and permissions all live there, so anything programmatic
(paying a wage, charging a fine, moving money between a player and a company) goes through
ox_core's account API, not through this resource.

See `ox-core.md` for `Ox.GetAccount`, `Ox.GetCharacterAccount`, `Ox.GetGroupAccount` and the
account methods.
