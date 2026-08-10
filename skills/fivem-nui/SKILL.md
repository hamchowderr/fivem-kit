---
name: fivem-nui
description: Build the HTML/CSS/JS interface layer of a FiveM resource — the Lua↔browser bridge (SendNUIMessage, RegisterNUICallback, fetch), SetNuiFocus and the stuck-cursor failure, ui_page and files{} manifest requirements, cfx-nui asset paths, CEF devtools, and bundling a React or Vue build into a resource. Use when writing or debugging any in-game menu, HUD, inventory or phone UI, when the cursor will not release, when the NUI page is blank or 404s, or when wiring a web build into fxmanifest.lua. Not for visual design craft (impeccable) or component scaffolding (shadcn).
---

# FiveM NUI

NUI is a Chromium (CEF) browser rendered over the game. The interface is ordinary web code;
what is not ordinary is the bridge to Lua, the focus model, and the fact that **every file
must be declared in the manifest** or it silently 404s.

## The manifest is half the bug reports

```lua
ui_page 'web/build/index.html'

files {
    'web/build/index.html',
    'web/build/**/*',        -- globs work; the entry file still needs listing
}
```

Files not in `files{}` are not in the resource packfile and will not load. The failure looks
like a blank screen or a broken stylesheet, with **no Lua error at all** — check the CEF
console before suspecting your code.

A page can also be hosted externally, which is worth knowing but rarely what you want:

```lua
ui_page 'https://ui.example.com/b20260810/index.html'
```

Reference assets across resources through the registered protocol scope:

```html
<script src="https://cfx-nui-my-resource/build/main.js"></script>
```

`cfx-nui-` replaced the old `nui://` scheme, which is no longer a secure context in current
Chromium. Anything still using `nui://` is stale.

Case matters on Linux servers and not on Windows, so a UI that works locally and 404s in
production is usually a capitalisation mismatch between `files{}` and disk.

## The bridge

Two directions, two different mechanisms.

### Lua → browser: `SendNUIMessage`

```lua
SendNUIMessage({ action = 'open', items = items })   -- Lua encodes the JSON for you
```

```js
window.addEventListener('message', (event) => {
  const data = event.data
  if (data.action === 'open') open(data.items)
})
```

The payload must be JSON-encodable. `SendNUIMessage` is the Lua convenience wrapper; the raw
native `SendNuiMessage` takes an already-encoded string.

### Browser → Lua: `RegisterNUICallback` + `fetch`

```lua
RegisterNUICallback('buyItem', function(data, cb)
    local ok = doPurchase(data.item, data.count)
    cb({ ok = ok })          -- ALWAYS call cb
end)
```

```js
const res = await fetch(`https://${GetParentResourceName()}/buyItem`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  body: JSON.stringify({ item: 'water', count: 2 }),
}).then((r) => r.json())
```

**Always call `cb`**, even with `{}`. A callback that returns nothing leaves the `fetch`
hanging until it times out, and the error surfaces in the browser rather than in Lua — far
from the actual mistake. `GetParentResourceName()` is a browser-side function the NUI runtime
injects; it is not a native, and hardcoding the resource name breaks the moment the folder is
renamed.

**A NUI callback is a client→client hop, not a security boundary.** Anything with a
server-side consequence must still go over a validated `TriggerServerEvent`. Treating
`RegisterNUICallback` data as trusted is the same class of mistake as trusting a net event —
see `fivem-security`.

## Focus, and the stuck cursor

```lua
SetNuiFocus(hasFocus, hasCursor)      -- keyboard focus, mouse cursor
SetNuiFocusKeepInput(keepInput)       -- let game input through while focused
```

`SetNuiFocus(true, true)` while a menu is open, `SetNuiFocus(false, false)` when it closes.
The stuck-cursor bug — mouse captured, player unable to move, only a rejoin fixes it — is
almost always one of:

- the close path returns early (an error, or a `return` before the reset)
- focus is set from Lua but cleared only in JS, or vice versa
- the resource is stopped or restarted while focused

Make the reset unconditional and own it in one place:

```lua
local open = false

local function setOpen(state)
    open = state
    SetNuiFocus(state, state)
    SendNUIMessage({ action = state and 'open' or 'close' })
end

-- focus survives a resource restart, so release it explicitly
AddEventHandler('onResourceStop', function(resource)
    if resource == GetCurrentResourceName() and open then
        SetNuiFocus(false, false)
    end
end)
```

Give the player an escape hatch that does not depend on the UI rendering correctly — a
keybind that calls `setOpen(false)` — because a JS exception in the close handler otherwise
leaves them stuck.

Focus is a **stack across resources**, and NUI pages are full-screen iframes: there is no
click-through between resources, so two resources focused at once fight over the cursor.

## Debugging

- `nui_devTools` in the F8 console opens CEF devtools for the focused page.
- The same devtools are served at `http://localhost:13172/` while the game runs — open it in
  any Chromium browser.
- `restart <resource>` reloads the page; a hard-cached asset may need a rebuild.
- Blank page → check `files{}` first, then the devtools console for a 404.

## Build tooling

Vite or webpack output into a folder inside the resource, and the manifest points at the
built entry:

```
my_resource/
  fxmanifest.lua
  client/main.lua
  web/               ← source
  web/build/         ← output, this is what ui_page and files{} reference
```

Use **relative** asset paths in the build config (Vite: `base: './'`). An absolute `/assets/…`
resolves against the NUI origin root and 404s.

Keep the bundle small. NUI runs alongside the game on the same machine; a multi-megabyte
bundle costs real frame time on load.

## Choosing a UI stack

Match the resource you are extending rather than importing a second framework:

- **ox_lib**'s own interface is React 18 + **Mantine** with Framer Motion.
- **ox_inventory** is React 19 + Redux with hand-written SCSS — no component library at all.

Those two ship in the same ecosystem and do not share a UI stack, which is the point: there
is no single "ox way" to copy. Read the host resource's `web/package.json` before choosing.

If you only need standard prompts — a context menu, an input dialog, a progress bar, a
notification — **do not build NUI at all**. `lib.registerContext`, `lib.inputDialog`,
`lib.progressBar` and `lib.notify` already exist, look consistent with the rest of the
server, and cost nothing to maintain. See `ox-stack`.

## Boundaries

- Visual craft — typography, colour, motion, layout quality → the `impeccable` skill.
- React component scaffolding → the official `shadcn` skill. Note that shadcn assumes a
  Tailwind/React app; dropping it into a resource whose UI is Mantine or plain SCSS means
  shipping two design systems in one bundle.
- Validating what the UI sends → `fivem-security`.
- Loading screens and DUI (rendering a browser onto a texture) are separate NUI features
  from full-screen pages; they use `SendLoadingScreenMessage` / `ShutdownLoadingScreenNui`
  and the DUI natives respectively.
