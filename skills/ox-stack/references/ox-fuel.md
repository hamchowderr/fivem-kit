# ox_fuel — `1.5.4`

Refuelling at pumps and with jerry cans. Almost entirely config-driven; the exports exist to
let another resource take over payment.

```lua
exports.ox_fuel:setPaymentMethod(fn)   -- replace how fuel is paid for
exports.ox_fuel:setMoneyCheck(fn)      -- replace the "can they afford it" check
```

Those two are the integration surface. If your server uses a custom economy — a bank resource,
a card system, a company account — override these rather than forking the resource.

### Config keys that matter

| Key | What it controls |
|---|---|
| `refillValue` / `refillTick` | Fuel added per tick, and how often — together they set refuel speed |
| `priceTick` | Cost charged per tick |
| `durabilityTick` | Pump wear per tick |
| `globalFuelConsumptionRate` | Multiplier over all vehicle classes; the single knob for "fuel drains too fast" |
| `petrolCan.enabled` / `.price` / `.refillPrice` / `.duration` | Jerry can behaviour |
| `pumpModels` | Which props count as pumps |
| `showBlips` | Station blips on the map |

Fuel level lives in the vehicle's statebag, so it survives ownership changes — read it there
rather than tracking it yourself.
