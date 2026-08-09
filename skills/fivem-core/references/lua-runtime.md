# FiveM Lua runtime reference

Source: https://docs.fivem.net/docs/scripting-reference/runtimes/lua/
These are runtime functions, distinct from GTA V natives (see `natives.md`).

---

## Shared (client + server)

### AddEventHandler / RegisterNetEvent

```lua
RegisterNetEvent('eventName')
AddEventHandler('eventName', function(text)
    print(('received %s from %i'):format(text, source))
end)

-- preferred, one call
RegisterNetEvent('eventName', function(text) end)
```

`RegisterNetEvent` marks an event as network-callable. On the server, `source` inside the
handler is the triggering player's server id.

> Registering a net event is the act of opening a door. Only do it for events that must
> be callable across the network, and validate everything they receive.

### RemoveEventHandler

```lua
local handler = AddEventHandler('someEvent', function() end)
RemoveEventHandler(handler)
```

### TriggerEvent

```lua
TriggerEvent('myCustomEvent', 'JohnDoe', 100)
```

Local only — client-to-client or server-to-server. It cannot cross the boundary.

### Threads and timing

```lua
CreateThread(function() end)          -- alias of Citizen.CreateThread
Wait(ms)                               -- alias of Citizen.Wait
Citizen.SetTimeout(5000, function() end)
Citizen.Await(promise)
Citizen.Trace("message\n")             -- no automatic newline
```

`Wait(0)` = next game tick (~16.6ms at 60fps, ~5.5ms at 180fps). A loop without a `Wait`
crashes the client.

Performance notes: don't call expensive natives per tick; cache `PlayerPedId()` in a
slower thread (or use ox_lib's `cache.ped`).

### Vectors

```lua
vec(x)              -- number
vec(x, y)           -- vector2
vec(x, y, z)        -- vector3
vec(x, y, z, w)     -- vector4
vector3(x, y, z)    -- explicit
quat(x, y, z, w)
```

First-class types — `type(vector3(1,2,3))` is `"vector3"`.

- comparison `==`, `~=`
- arithmetic `+ - * /` with scalars and vectors
- negation `-v`
- **length `#v`** — this is how distance checks are written: `#(a - b) < 5.0`
- normalise `norm(v)`
- components `v.x`, `v.y`, `v.z`
- unpack `local x, y, z = table.unpack(v)`
- swizzling `v.yx`, `v.zx`, `v.xyx`

```lua
local vehicle = GetVehiclePedIsIn(PlayerPedId())
local _, forwardVector, _, position = GetEntityMatrix(vehicle)
SetEntityCoords(vehicle, (forwardVector * 5) + position)   -- 5m forward
```

---

## Client only

### TriggerServerEvent

```lua
TriggerServerEvent('myCustomServerEvent', playerName, playerScore)
```

Keep payloads small — everything is msgpack-serialised. Put logic on the server.

### NUI

```lua
SendNUIMessage({ action = 'showMessage', hello = 'world' })

RegisterNUICallback('buyItem', function(data, cb)
    -- data is fully player-controlled
    cb({ ok = true })
end)
```

```js
// NUI side
window.addEventListener('message', (event) => {
    const data = event.data
    if (data.action === 'showMessage') console.log(`Hello ${data.hello}!`)
})
```

`SetNuiFocus(hasFocus, hasCursor)` toggles input capture. Always restore it —
`SetNuiFocus(false, false)` — or the player is stuck with a cursor and no controls.

---

## Server only

### TriggerClientEvent

```lua
TriggerClientEvent('eventName', playerId, 'Hello')
TriggerClientEvent('eventName', -1, 'Hello everyone')   -- broadcast
```

`-1` reaches every connected player. Don't broadcast identifiers, balances or positions.

### GetPlayers

```lua
for _, playerId in ipairs(GetPlayers()) do
    print(GetPlayerName(playerId), playerId)
end
```

### GetPlayerIdentifiers

```lua
local identifiers = {}
for _, ident in ipairs(GetPlayerIdentifiers(source)) do
    local sep = string.find(ident, ':') - 1
    identifiers[string.sub(ident, 1, sep)] = ident
end
print(identifiers['fivem'])
```

| Type | Provider | Format |
|---|---|---|
| `steam` | Steam | hex Steam ID |
| `discord` | Discord | integer user id |
| `xbl` | Xbox Live | integer |
| `live` | Microsoft PUID | integer |
| `license` | Rockstar Online Services | hex hash |
| `license2` | ROS (Steam users) | hex hash |
| `fivem` | Cfx.re | integer user id |
| `ip` | connection | IPv4 string |

For one identifier, prefer the native `GetPlayerIdentifierByType(source, 'discord')`.

> Never index identifiers positionally — order is not guaranteed. Never authorise on
> `ip:`. `license:` is the usual stable key.

### HTTP

```lua
PerformHttpRequest(url, function(status, body, headers, errorData) end,
                   method, data, headers, options)
-- defaults: method 'GET', data '', headers {}, options { followLocation = true }

-- synchronous wrapper, requires server build 9515+
local status, body, headers, err = PerformHttpRequestAwait(url, method, data, headers, options)
```

Server-side only. Never build the URL or body from unvalidated client input, and keep API
keys in convars rather than in the script.
