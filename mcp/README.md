# fivem-kit-mcp

An MCP server that gives any AI editor accurate FiveM knowledge — instead of a plausible
guess at an API that doesn't exist.

Serves documentation for the **FiveM Lua runtime**, **fxmanifest.lua**, **GTA V natives**,
the **ox (Overextended)** stack — ox_lib, ox_core, ox_target, ox_inventory — plus **ESX
Legacy**, **QBCore** and **Qbox**, all verified against real resource sources. It also
analyses your Lua for exploitable defects and detects which framework a server actually
runs.

Works in Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Zed, or anything else that
speaks MCP.

## Install

```bash
npx -y fivem-kit-mcp
```

### Claude Code

```bash
claude mcp add fivem-kit -- npx -y fivem-kit-mcp@latest
```

Or install the full plugin, which bundles this server plus skills and slash commands:

```
/plugin marketplace add hamchowderr/fivem-kit
/plugin install fivem-kit
```

### Cursor / Windsurf / Claude Desktop / VS Code

Add to the MCP config (`.cursor/mcp.json`, `claude_desktop_config.json`, `mcp.json` — the
shape is the same):

```json
{
  "mcpServers": {
    "fivem-kit": {
      "command": "npx",
      "args": ["-y", "fivem-kit-mcp@latest"]
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `fivemDocs` | List or read documentation pages. Call with no arguments for the index. |
| `fivemSearch` | Keyword search across every page, with matching excerpts. |
| `fivemNatives` | Find the GTA V native for a task, and the ox wrapper to prefer. |
| `fivemAudit` | Static analysis of Lua for exploitable defects, plus review prompts for what a regex cannot decide. |
| `fivemDetectStack` | Inspect a server folder: framework, libraries, resources, load order, cfg problems. |

### `fivemAudit`

Deterministic checks — SQL injection, `load`/`loadstring`, unguarded commands, `source`
used after a yield, committed secrets, sensitive broadcasts, `while true` with no `Wait`,
legacy MySQL APIs. It knows whether a file is client- or server-side and suppresses rules
that don't apply.

Rules that need semantic judgement (is this parameter validated? is there a distance
check?) are **not** guessed at — they come back as targeted review prompts naming the
entry points found. A report padded with false positives buries the real finding.

### `fivemDetectStack`

Reports the framework (ox_core / es_extended / qb-core / qbx_core), the libraries, every
installed resource with its declared dependencies, the `server.cfg` load order, resources
started but missing from disk, and cfg lines containing `;` — which FiveM splits on and
runs as separate commands rather than treating as a comment.

## Development

```bash
npm install
npm start                  # run over stdio
npm run inspect            # MCP Inspector
npm run build:corpus       # bundle docs into corpus/ (runs automatically on publish)
```

The corpus is the plugin's own markdown. From a repo checkout it is read directly from
`../skills` and `../docs`; on publish, `build-corpus.mjs` copies it into `corpus/` so the
npm package is self-contained.

## License

MIT © Otaku Solutions. Built by the team behind [myRP.build](https://myrp.build).

Not affiliated with or endorsed by Cfx.re or the Overextended team.
